#!/usr/bin/env node
/**
 * Cloudflare Tunnel supervisor for PM2.
 *
 * Modes:
 *  - quick (default): `cloudflared tunnel --url http://127.0.0.1:4000`.
 *    Free, no account required, but the public URL changes on every restart.
 *  - token: `cloudflared tunnel run --token ...` for a named tunnel with a
 *    stable hostname. Requires TUNNEL_TOKEN and TUNNEL_PUBLIC_URL.
 *
 * The script waits for the local API, starts cloudflared, extracts the public
 * URL, and reports it to `POST /api/internal/tunnel` (loopback + shared
 * token). The server stores each session in SQLite and sends the notification
 * email. PM2 restarts this process automatically if cloudflared exits or the
 * public health check fails repeatedly.
 */

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const log = (message) => console.log(`[tunnel] ${message}`);
const fail = (message) => console.error(`[tunnel] ${message}`);

const enabled = process.env.TUNNEL_ENABLED === 'true';
if (!enabled) {
  log('TUNNEL_ENABLED is not true; tunnel supervisor exiting.');
  process.exit(0);
}

const mode = (process.env.TUNNEL_MODE || 'quick').toLowerCase();
const port = process.env.PORT || '4000';
const localBase =
  process.env.TUNNEL_INTERNAL_URL || `http://127.0.0.1:${port}`;
const appUrl = process.env.TUNNEL_APP_URL || `http://127.0.0.1:${port}`;
const binary = process.env.TUNNEL_CLOUDFLARED || 'cloudflared';
const token = process.env.TUNNEL_TOKEN || '';
const publicUrlOverride = (process.env.TUNNEL_PUBLIC_URL || '').replace(
  /\/$/,
  ''
);
const internalToken =
  (process.env.TUNNEL_INTERNAL_TOKEN || process.env.AUTH_SECRET || '').trim();
const startupTimeoutMs = Number(process.env.TUNNEL_STARTUP_TIMEOUT_MS || 60000);
const notifyTimeoutMs = Number(process.env.TUNNEL_NOTIFY_TIMEOUT_MS || 120000);
const healthIntervalMs = Number(
  process.env.TUNNEL_HEALTHCHECK_INTERVAL_MS || 60000
);
const healthFailuresBeforeRestart = Number(
  process.env.TUNNEL_HEALTHCHECK_FAILURES || 3
);

if (!internalToken) {
  fail(
    'TUNNEL_INTERNAL_TOKEN (or AUTH_SECRET) is required so the tunnel can report its URL.'
  );
  process.exit(1);
}

if (mode === 'token' && !token) {
  fail('TUNNEL_MODE=token requires TUNNEL_TOKEN.');
  process.exit(1);
}

if (mode === 'token' && !publicUrlOverride) {
  fail(
    'TUNNEL_MODE=token requires TUNNEL_PUBLIC_URL (the stable hostname of the named tunnel).'
  );
  process.exit(1);
}

let child = null;
let sessionId = '';
let registeredUrl = '';
let shuttingDown = false;
let restartRequested = false;
let healthTimer = null;
let healthFailures = 0;

function cloudflaredArgs() {
  if (mode === 'token') {
    const config = process.env.TUNNEL_CONFIG;
    const name = process.env.TUNNEL_NAME;
    if (config) {
      return [
        'tunnel',
        '--no-autoupdate',
        '--config',
        config,
        'run',
        ...(name ? [name] : []),
      ];
    }
    return ['tunnel', '--no-autoupdate', 'run', '--token', token];
  }
  return [
    'tunnel',
    '--no-autoupdate',
    '--loglevel',
    'info',
    '--url',
    appUrl,
  ];
}

async function waitForServer() {
  const deadline = Date.now() + startupTimeoutMs;
  const healthUrl = `${localBase}/api/health`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(5000),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.status === 'ok') {
        log(`API healthy at ${healthUrl}`);
        return;
      }
    } catch {
      // The server may still be booting; keep retrying until the deadline.
    }
    await delay(2000);
  }
  throw new Error(
    `API did not become healthy at ${healthUrl} within ${startupTimeoutMs}ms`
  );
}

async function postInternal(payload) {
  const response = await fetch(`${localBase}/api/internal/tunnel`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': internalToken,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `internal callback HTTP ${response.status}: ${
        body.error || response.statusText
      }`
    );
  }
  return body;
}

async function registerSession(publicUrl) {
  const deadline = Date.now() + notifyTimeoutMs;
  let lastError = '';
  while (!shuttingDown && Date.now() < deadline) {
    try {
      const result = await postInternal({
        provider: 'cloudflare',
        mode,
        publicUrl,
        apiUrl: `${publicUrl}/api`,
        pid: child?.pid,
        metadata: { localUrl: appUrl, binary, hostname: publicUrlOverride || null },
      });
      sessionId = result.session?.id || '';
      registeredUrl = publicUrl;
      log(`registered ${publicUrl} (session ${sessionId || 'unknown'})`);
      if (result.notification?.status === 'sent') {
        log(`notification email sent to ${result.notification.recipients.length} recipient(s)`);
      } else if (result.notification?.status) {
        log(
          `notification ${result.notification.status}${
            result.notification.reason ? ` (${result.notification.reason})` : ''
          }`
        );
      }
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      fail(`could not register tunnel URL: ${lastError}`);
      await delay(5000);
    }
  }
  fail(`tunnel URL registration gave up: ${lastError}`);
}

async function unregisterSession(status) {
  if (!sessionId) return;
  try {
    await postInternal({ sessionId, status });
    log(`session ${sessionId} marked as ${status}`);
    sessionId = '';
  } catch (error) {
    fail(
      `could not mark session ${sessionId} as ${status}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function stopChild(signal = 'SIGTERM') {
  if (!child || child.killed) return;
  child.kill(signal);
  setTimeout(() => {
    if (child && !child.killed) child.kill('SIGKILL');
  }, 5000).unref?.();
}

function startHealthMonitor() {
  if (!registeredUrl || healthIntervalMs <= 0) return;
  healthTimer = setInterval(async () => {
    try {
      const response = await fetch(registeredUrl, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      // Cloudflare Access may answer 302/403 when protection is enabled; any
      // HTTP response proves the tunnel is alive.
      healthFailures = 0;
      if (response.status >= 500) healthFailures += 1;
    } catch {
      healthFailures += 1;
      log(`public health check failed (${healthFailures}/${healthFailuresBeforeRestart})`);
    }
    if (healthFailures >= healthFailuresBeforeRestart) {
      fail('public tunnel is unreachable; restarting cloudflared via PM2');
      restartRequested = true;
      stopChild();
    }
  }, healthIntervalMs);
  healthTimer.unref?.();
}

function parseQuickTunnelUrl(chunk) {
  const match = chunk.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return match ? match[0] : '';
}

async function main() {
  log(
    `starting cloudflared (mode=${mode}, local=${appUrl}, binary=${binary})`
  );
  await waitForServer();

  child = spawn(binary, cloudflaredArgs(), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let outputBuffer = '';
  let reported = false;

  const onChunk = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(
      text
        .split('\n')
        .filter(Boolean)
        .map((line) => `[cloudflared] ${line}\n`)
        .join('')
    );

    if (reported || mode !== 'quick') return;
    outputBuffer = (outputBuffer + text).slice(-8192);
    const url = parseQuickTunnelUrl(outputBuffer);
    if (url) {
      reported = true;
      log(`public URL detected: ${url}`);
      reportTunnelRegistration(url).catch((error) => {
        fail(
          `tunnel registration failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }
  };

  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);

  if (mode === 'token') {
    reported = true;
    registerSession(publicUrlOverride).then(() => startHealthMonitor());
  }

  child.on('error', (error) => {
    fail(`failed to start ${binary}: ${error.message}`);
    fail('Install cloudflared or set TUNNEL_CLOUDFLARED to its absolute path.');
    process.exit(1);
  });

  child.on('exit', async (code, signal) => {
    child = null;
    if (healthTimer) clearInterval(healthTimer);
    if (shuttingDown) return;

    if (!reported) {
      fail(`cloudflared exited before publishing a URL (code=${code}, signal=${signal})`);
    } else {
      fail(`cloudflared exited (code=${code}, signal=${signal})`);
    }
    await unregisterSession(code === 0 ? 'detenido' : 'error');
    process.exit(restartRequested || code !== 0 ? 1 : 0);
  });
}

async function reportTunnelRegistration(url) {
  await registerSession(url);
  startHealthMonitor();
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received; stopping cloudflared`);
  if (healthTimer) clearInterval(healthTimer);

  // Stop cloudflared first: the session callback below can take a few seconds
  // and PM2 must not have to SIGKILL the supervisor while it waits.
  stopChild();
  const fallback = setTimeout(() => process.exit(0), 8000);
  fallback.unref?.();
  unregisterSession('detenido').finally(() => {
    clearTimeout(fallback);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch(async (error) => {
  fail(error instanceof Error ? error.message : String(error));
  await unregisterSession('error');
  process.exit(1);
});
