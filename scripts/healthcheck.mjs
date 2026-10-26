#!/usr/bin/env node
/**
 * Container/load-balancer health probe.
 *
 * Environment variables:
 *  - HEALTHCHECK_URL          Full URL (default: http://127.0.0.1:$PORT/api/health)
 *  - PORT                     Used when HEALTHCHECK_URL is not set (default: 4000)
 *  - HEALTHCHECK_TIMEOUT_MS   Request timeout (default: 5000)
 */
const port = process.env.PORT || 4000;
const url =
  process.env.HEALTHCHECK_URL || `http://127.0.0.1:${port}/api/health`;
const timeoutMs = Number(process.env.HEALTHCHECK_TIMEOUT_MS || 5000);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(url, {
    signal: controller.signal,
    headers: { accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({}));

  if (
    !response.ok ||
    body.status !== 'ok' ||
    body.database?.connected !== true
  ) {
    console.error(
      `[healthcheck] FAIL ${url} -> HTTP ${response.status} status=${body.status} database=${
        body.database?.connected
      }`
    );
    process.exit(1);
  }

  console.log(
    `[healthcheck] OK ${url} version=${body.version} uptime=${body.uptimeSeconds}s`
  );
} catch (error) {
  console.error(
    `[healthcheck] FAIL ${url} -> ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(1);
} finally {
  clearTimeout(timer);
}
