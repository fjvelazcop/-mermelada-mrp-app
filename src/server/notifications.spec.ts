import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, setDbPath } from './database/persistence.js';
import {
  closeTunnelSession,
  createNotificationRecipient,
  deleteNotificationRecipient,
  ensureSeedNotificationRecipients,
  getLatestTunnelSession,
  listNotificationLog,
  listNotificationRecipients,
  listTunnelSessions,
  parseEmailList,
  readSmtpConfig,
  recordTunnelSession,
  resendTunnelNotification,
  sendTunnelNotification,
  setMailTransportFactory,
  updateNotificationRecipient,
  type MailMessage,
  type MailTransport,
} from './notifications.js';
import { isLoopbackAddress } from './tunnel.js';

/**
 * Tests for the Cloudflare tunnel registry and deployment email notifications.
 *
 * SMTP is never contacted: a fake transport captures the message and can fail
 * on purpose to exercise retries.
 */

const workDir = mkdtempSync(join(tmpdir(), 'mermelada-notify-'));
const dbPath = join(workDir, 'notifications.db');
const internalToken = 'internal-test-token';
const seededRecipients = ['ops@example.com', 'jefa@example.com'];

let server: Server;
let baseUrl: string;

class FakeTransport implements MailTransport {
  messages: MailMessage[] = [];
  failures = 0;

  async sendMail(message: MailMessage): Promise<unknown> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('SMTP temporalmente no disponible');
    }
    this.messages.push(message);
    return { accepted: [message.to] };
  }
}

async function jsonRequest(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

function configureSmtp(overrides: Record<string, string> = {}): void {
  vi.stubEnv('SMTP_HOST', 'smtp.example.com');
  vi.stubEnv('SMTP_PORT', '587');
  vi.stubEnv('SMTP_SECURE', 'false');
  vi.stubEnv('SMTP_USER', 'mailer');
  vi.stubEnv('SMTP_PASSWORD', 'secret');
  vi.stubEnv('SMTP_FROM', 'erp@example.com');
  vi.stubEnv('SMTP_FROM_NAME', 'Mermelada ERP');
  vi.stubEnv('SMTP_BCC', 'auditoria@example.com');
  vi.stubEnv('SMTP_RETRY_DELAY_MS', '0');
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
}

beforeAll(async () => {
  process.env['AUTH_ENABLED'] = 'false';
  process.env['TUNNEL_INTERNAL_TOKEN'] = internalToken;
  process.env['SMTP_TO'] = seededRecipients.join(',');
  setDbPath(dbPath);

  const { createApiApp } = await import('./api.js');
  const app = createApiApp();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(() => {
  vi.unstubAllEnvs();
  setMailTransportFactory(null);
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  closeDb();
  delete process.env['AUTH_ENABLED'];
  delete process.env['TUNNEL_INTERNAL_TOKEN'];
  delete process.env['SMTP_TO'];
  rmSync(workDir, { recursive: true, force: true });
});

describe('email helpers', () => {
  it('normalises recipient lists and drops invalid addresses', () => {
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList(' A@Example.com, b@example.com;A@example.com ')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
    expect(parseEmailList('not-an-email, c@example.com')).toEqual([
      'c@example.com',
    ]);
  });

  it('reads a complete SMTP configuration and supports aliases', () => {
    expect(readSmtpConfig()).toBeNull();

    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('SMTP_FROM', 'erp@example.com');
    vi.stubEnv('SMTP_PORT', '465');
    vi.stubEnv('SMTP_USER', 'mailer');
    vi.stubEnv('SMTP_PASS', 'secret');
    vi.stubEnv('SMTP_BCC', 'audit@example.com;second@example.com');
    const config = readSmtpConfig();
    expect(config).not.toBeNull();
    expect(config?.port).toBe(465);
    expect(config?.secure).toBe(true);
    expect(config?.pass).toBe('secret');
    expect(config?.bcc).toEqual(['audit@example.com', 'second@example.com']);

    vi.stubEnv('SMTP_PORT', 'not-a-port');
    expect(readSmtpConfig()).toBeNull();
  });
});

describe('recipient seeding and CRUD', () => {
  it('seeds SMTP_TO only when the table is empty', () => {
    // createApiApp() already seeded from SMTP_TO during startup.
    expect(listNotificationRecipients().map((entry) => entry.email)).toEqual(
      expect.arrayContaining(seededRecipients)
    );
    expect(ensureSeedNotificationRecipients()).toBe(0);

    // A non-empty table is never re-seeded, so administrator deletions stick.
    getDb().prepare('DELETE FROM notification_recipients').run();
    expect(ensureSeedNotificationRecipients()).toBe(2);
    expect(ensureSeedNotificationRecipients()).toBe(0);

    getDb().prepare('DELETE FROM notification_recipients').run();
    expect(ensureSeedNotificationRecipients('only@example.com')).toBe(1);
    expect(ensureSeedNotificationRecipients('ignored@example.com')).toBe(0);
  });

  it('creates, updates and deletes recipients with validation', () => {
    expect(() =>
      createNotificationRecipient({ email: 'invalid' })
    ).toThrow(/no es válido/);

    const created = createNotificationRecipient({
      email: '  Nuevo@Example.COM ',
      name: '  Nuevo Destino  ',
    });
    expect(created.email).toBe('nuevo@example.com');
    expect(created.name).toBe('Nuevo Destino');
    expect(created.active).toBe(true);

    expect(() =>
      createNotificationRecipient({ email: 'nuevo@example.com' })
    ).toThrow(/ya está registrado/);

    expect(updateNotificationRecipient('missing-id', {})).toBeNull();

    const renamed = updateNotificationRecipient(created.id, {
      email: 'renombrado@example.com',
      name: '',
      active: false,
    });
    expect(renamed?.email).toBe('renombrado@example.com');
    expect(renamed?.name).toBeUndefined();
    expect(renamed?.active).toBe(false);

    const second = createNotificationRecipient({
      email: 'segundo@example.com',
    });
    expect(() =>
      updateNotificationRecipient(second.id, { email: 'renombrado@example.com' })
    ).toThrow(/ya está registrado/);

    expect(deleteNotificationRecipient('missing-id')).toBe(false);
    expect(deleteNotificationRecipient(created.id)).toBe(true);
    expect(deleteNotificationRecipient(second.id)).toBe(true);
  });
});

describe('tunnel session registry', () => {
  it('records new URLs and supersedes the previous active session', () => {
    const first = recordTunnelSession({
      publicUrl: 'https://first.trycloudflare.com/',
      pid: 123,
    });
    expect(first.publicUrl).toBe('https://first.trycloudflare.com');
    expect(first.apiUrl).toBe('https://first.trycloudflare.com/api');
    expect(getLatestTunnelSession()?.id).toBe(first.id);

    const second = recordTunnelSession({
      mode: 'token',
      publicUrl: 'https://erp.example.com',
      apiUrl: 'https://erp.example.com/api',
      metadata: { hostname: 'erp.example.com' },
    });
    expect(getLatestTunnelSession()?.id).toBe(second.id);

    const sessions = listTunnelSessions(10);
    expect(sessions[0].id).toBe(second.id);
    expect(sessions.find((entry) => entry.id === first.id)?.status).toBe(
      'reemplazado'
    );
    expect(sessions.find((entry) => entry.id === second.id)?.metadata).toEqual({
      hostname: 'erp.example.com',
    });

    expect(closeTunnelSession('missing-session')).toBeNull();
    expect(closeTunnelSession(second.id, 'detenido')?.status).toBe('detenido');
  });

  it('rejects malformed and non-http URLs', () => {
    expect(() => recordTunnelSession({ publicUrl: 'not-a-url' })).toThrow(
      /no es válida/
    );
    expect(() =>
      recordTunnelSession({ publicUrl: 'ftp://example.com' })
    ).toThrow(/http o https/);
  });
});

describe('sendTunnelNotification', () => {
  it('skips with a logged reason when SMTP is not configured', async () => {
    const transport = new FakeTransport();
    const result = await sendTunnelNotification({
      publicUrl: 'https://skip.trycloudflare.com',
      transport,
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('smtp_not_configured');
    expect(transport.messages).toHaveLength(0);
    expect(listNotificationLog(1)[0].status).toBe('omitido');
  });

  it('skips when there are no active recipients', async () => {
    configureSmtp();
    getDb().prepare('UPDATE notification_recipients SET active = 0').run();

    const transport = new FakeTransport();
    const result = await sendTunnelNotification({
      publicUrl: 'https://empty.trycloudflare.com',
      transport,
    });

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('no_recipients');

    getDb().prepare('UPDATE notification_recipients SET active = 1').run();
  });

  it('sends the URL email to DB recipients and the env BCC', async () => {
    configureSmtp();
    if (listNotificationRecipients().length === 0) {
      createNotificationRecipient({ email: 'fallback@example.com' });
    }
    const transport = new FakeTransport();
    const result = await sendTunnelNotification({
      publicUrl: 'https://send.trycloudflare.com',
      apiUrl: 'https://send.trycloudflare.com/api',
      transport,
      retryDelayMs: 0,
    });

    expect(result.status).toBe('sent');
    expect(result.attempts).toBe(1);
    expect(result.recipients.length).toBeGreaterThan(0);
    expect(result.bcc).toEqual(['auditoria@example.com']);
    expect(transport.messages).toHaveLength(1);

    const [message] = transport.messages;
    expect(message.to).toContain(result.recipients[0]);
    expect(message.bcc).toBe('auditoria@example.com');
    expect(message.from).toContain('Mermelada ERP');
    expect(message.subject).toContain('URLs públicas');
    expect(message.text).toContain('https://send.trycloudflare.com');
    expect(message.text).toContain('https://send.trycloudflare.com/api');
    expect(message.html).toContain('https://send.trycloudflare.com');
    expect(listNotificationLog(1)[0].status).toBe('enviado');
  });

  it('retries transient failures and records permanent failures', async () => {
    configureSmtp();

    const flaky = new FakeTransport();
    flaky.failures = 2;
    const retried = await sendTunnelNotification({
      publicUrl: 'https://retry.trycloudflare.com',
      transport: flaky,
      retryDelayMs: 0,
    });
    expect(retried.status).toBe('sent');
    expect(retried.attempts).toBe(3);

    const broken = new FakeTransport();
    broken.failures = 10;
    const failed = await sendTunnelNotification({
      publicUrl: 'https://fail.trycloudflare.com',
      transport: broken,
      retryDelayMs: 0,
    });
    expect(failed.status).toBe('failed');
    expect(failed.attempts).toBe(3);
    expect(failed.error).toMatch(/SMTP temporalmente/);
    expect(listNotificationLog(1)[0].status).toBe('fallido');
  });

  it('re-sends the latest stored tunnel session', async () => {
    configureSmtp();
    const transport = new FakeTransport();
    const result = await resendTunnelNotification(transport);
    expect(result.status).toBe('sent');
    expect(transport.messages[0].text).toContain(
      getLatestTunnelSession()?.publicUrl ?? 'missing'
    );
  });
});

describe('internal tunnel callback and notification API', () => {
  it('identifies loopback addresses', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.0.1.5')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('10.0.0.1')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  it('is disabled when no internal token can be derived', async () => {
    vi.stubEnv('TUNNEL_INTERNAL_TOKEN', '');
    vi.stubEnv('AUTH_SECRET', '');
    const disabled = await jsonRequest('/api/internal/tunnel', 'POST', {
      publicUrl: 'https://disabled.trycloudflare.com',
    });
    expect(disabled.status).toBe(503);
  });

  it('rejects requests proxied through the public tunnel', async () => {
    const proxied = await jsonRequest(
      '/api/internal/tunnel',
      'POST',
      { publicUrl: 'https://proxied.trycloudflare.com' },
      {
        'x-internal-token': internalToken,
        'cf-ray': '8a1b2c3d4e5f-MAD',
      }
    );
    expect(proxied.status).toBe(403);
  });

  it('rejects missing and invalid internal tokens', async () => {
    const anonymous = await jsonRequest('/api/internal/tunnel', 'POST', {
      publicUrl: 'https://blocked.trycloudflare.com',
    });
    expect(anonymous.status).toBe(401);

    const wrong = await jsonRequest(
      '/api/internal/tunnel',
      'POST',
      { publicUrl: 'https://blocked.trycloudflare.com' },
      { 'x-internal-token': 'wrong' }
    );
    expect(wrong.status).toBe(401);
  });

  it('validates the payload and registers a session', async () => {
    const missing = await jsonRequest(
      '/api/internal/tunnel',
      'POST',
      { mode: 'quick' },
      { 'x-internal-token': internalToken }
    );
    expect(missing.status).toBe(422);

    const invalidUrl = await jsonRequest(
      '/api/internal/tunnel',
      'POST',
      { publicUrl: 'nope' },
      { 'x-internal-token': internalToken }
    );
    expect(invalidUrl.status).toBe(422);

    const created = await jsonRequest(
      '/api/internal/tunnel',
      'POST',
      {
        mode: 'quick',
        publicUrl: 'https://callback.trycloudflare.com',
        pid: 4321,
        metadata: { source: 'test' },
      },
      { 'x-internal-token': internalToken }
    );
    expect(created.status).toBe(201);

    const session = created.body['session'] as { id: string; publicUrl: string };
    expect(session.publicUrl).toBe('https://callback.trycloudflare.com');
    expect(getLatestTunnelSession()?.id).toBe(session.id);

    const closed = await jsonRequest(
      '/api/internal/tunnel',
      'POST',
      { sessionId: session.id, status: 'error' },
      { 'x-internal-token': internalToken }
    );
    expect(closed.status).toBe(200);
    expect((closed.body['session'] as { status: string }).status).toBe('error');

    const unknown = await jsonRequest(
      '/api/internal/tunnel',
      'POST',
      { sessionId: 'missing', status: 'detenido' },
      { 'x-internal-token': internalToken }
    );
    expect(unknown.status).toBe(404);
  });

  it('exposes the latest URL and history to administrators', async () => {
    const result = await jsonRequest('/api/system/tunnel?limit=5');
    expect(result.status).toBe(200);
    expect(result.body['latest']).toBeTruthy();
    expect(Array.isArray(result.body['history'])).toBe(true);
    expect(typeof result.body['emailConfigured']).toBe('boolean');
  });

  it('manages recipients through the API and enforces admin access', async () => {
    const forbidden = await jsonRequest(
      '/api/notifications/recipients',
      'GET',
      undefined,
      { 'x-demo-role': 'operador' }
    );
    expect(forbidden.status).toBe(403);

    const created = await jsonRequest('/api/notifications/recipients', 'POST', {
      email: 'api-recipient@example.com',
      name: 'API Recipient',
    });
    expect(created.status).toBe(201);
    const id = created.body['id'] as string;

    const listed = await jsonRequest('/api/notifications/recipients');
    expect(listed.status).toBe(200);
    expect(
      (listed.body as unknown as { id: string }[]).some((entry) => entry.id === id)
    ).toBe(true);

    const updated = await jsonRequest(
      `/api/notifications/recipients/${id}`,
      'PUT',
      { active: false }
    );
    expect(updated.status).toBe(200);
    expect(updated.body['active']).toBe(false);

    const deleted = await jsonRequest(
      `/api/notifications/recipients/${id}`,
      'DELETE'
    );
    expect(deleted.status).toBe(200);

    const missing = await jsonRequest(
      '/api/notifications/recipients/missing',
      'DELETE'
    );
    expect(missing.status).toBe(404);
  });

  it('exposes the notification log and manual resend', async () => {
    const log = await jsonRequest('/api/notifications/log?limit=3');
    expect(log.status).toBe(200);
    expect(Array.isArray(log.body)).toBe(true);

    const resend = await jsonRequest('/api/notifications/tunnel/resend', 'POST');
    expect(resend.status).toBe(200);
    expect(['sent', 'skipped']).toContain(resend.body['status']);
  });
});
