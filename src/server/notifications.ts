import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import nodemailer from 'nodemailer';
import { getDb } from './database/persistence.js';

/**
 * Tunnel session registry and deployment email notifications.
 *
 * Cloudflare quick tunnels receive a new public URL every time they restart,
 * so each start is recorded in SQLite. The URL can be consumed later through
 * `GET /api/system/tunnel` and is included in the notification email.
 *
 * SMTP credentials come from the environment, while the recipients live in the
 * `notification_recipients` table so they can be managed without redeploying.
 * `SMTP_BCC` is always added as a hidden copy for auditing.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SEND_ATTEMPTS = 3;

export interface NotificationRecipient {
  id: string;
  email: string;
  name?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TunnelSession {
  id: string;
  provider: string;
  mode: string;
  publicUrl: string;
  apiUrl: string;
  status: string;
  pid?: number;
  startedAt: string;
  endedAt?: string;
  metadata?: unknown;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  fromName?: string;
  bcc: string[];
}

export interface MailMessage {
  from: string;
  to: string;
  bcc?: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

type MailTransportFactory = (config: SmtpConfig) => MailTransport;

let transportFactory: MailTransportFactory | null = null;

/** Override the SMTP transport factory. Intended for tests. */
export function setMailTransportFactory(factory: MailTransportFactory | null): void {
  transportFactory = factory;
}

function defaultTransportFactory(config: SmtpConfig): MailTransport {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth:
      config.user && config.pass
        ? { user: config.user, pass: config.pass }
        : undefined,
  }) as MailTransport;
}

function envValue(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

/** Normalise a comma/semicolon separated list of email addresses. */
export function parseEmailList(value: string | undefined | null): string[] {
  if (!value) return [];
  const unique = new Set<string>();
  for (const part of value.split(/[,;]/)) {
    const email = part.trim().toLowerCase();
    if (EMAIL_PATTERN.test(email)) unique.add(email);
  }
  return [...unique];
}

/** Read the SMTP configuration, or `null` when it is incomplete. */
export function readSmtpConfig(): SmtpConfig | null {
  const host = envValue('SMTP_HOST');
  const from = envValue('SMTP_FROM', 'SMTP_FROM_EMAIL');
  if (!host || !from) return null;

  const rawPort = Number(envValue('SMTP_PORT') || 587);
  if (!Number.isFinite(rawPort) || rawPort <= 0 || rawPort > 65535) {
    return null;
  }

  const secureValue = envValue('SMTP_SECURE');
  const secure = secureValue ? secureValue === 'true' : rawPort === 465;

  return {
    host,
    port: rawPort,
    secure,
    user: envValue('SMTP_USER') || undefined,
    pass: envValue('SMTP_PASSWORD', 'SMTP_PASS') || undefined,
    from,
    fromName: envValue('SMTP_FROM_NAME') || undefined,
    bcc: parseEmailList(process.env['SMTP_BCC']),
  };
}

export function isEmailConfigured(): boolean {
  return readSmtpConfig() !== null;
}

function rowToRecipient(row: Record<string, unknown>): NotificationRecipient {
  return {
    id: String(row['id']),
    email: String(row['email']),
    name: row['name'] ? String(row['name']) : undefined,
    active: Number(row['active']) === 1,
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

function rowToSession(row: Record<string, unknown>): TunnelSession {
  return {
    id: String(row['id']),
    provider: String(row['provider']),
    mode: String(row['mode']),
    publicUrl: String(row['public_url']),
    apiUrl: String(row['api_url']),
    status: String(row['status']),
    pid: row['pid'] === null || row['pid'] === undefined ? undefined : Number(row['pid']),
    startedAt: String(row['started_at']),
    endedAt: row['ended_at'] ? String(row['ended_at']) : undefined,
    metadata: row['metadata_json'] ? JSON.parse(String(row['metadata_json'])) : undefined,
  };
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new Error('El correo electrónico no es válido');
  }
  return normalized;
}

export function listNotificationRecipients(): NotificationRecipient[] {
  const rows = getDb()
    .prepare('SELECT * FROM notification_recipients ORDER BY email')
    .all() as Record<string, unknown>[];
  return rows.map(rowToRecipient);
}

/**
 * Seed recipients from `SMTP_TO` only when the table has never been populated.
 * This keeps administrator changes stable across restarts.
 */
export function ensureSeedNotificationRecipients(
  rawEmails = process.env['SMTP_TO']
): number {
  const db = getDb();
  const count = db
    .prepare('SELECT COUNT(*) AS count FROM notification_recipients')
    .get() as { count: number };
  if (count.count > 0) return 0;

  const emails = parseEmailList(rawEmails);
  if (emails.length === 0) return 0;

  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO notification_recipients
       (id, email, name, active, created_at, updated_at)
     VALUES (?, ?, NULL, 1, ?, ?)`
  );
  const seed = db.transaction(() => {
    for (const email of emails) {
      insert.run(`rcp-${randomBytes(8).toString('hex')}`, email, now, now);
    }
  });
  seed();
  return emails.length;
}

export interface NotificationRecipientInput {
  email: string;
  name?: string;
  active?: boolean;
}

export function createNotificationRecipient(
  input: NotificationRecipientInput
): NotificationRecipient {
  const db = getDb();
  const email = normalizeEmail(input.email);
  const existing = db
    .prepare('SELECT id FROM notification_recipients WHERE email = ?')
    .get(email);
  if (existing) {
    throw new Error('El correo ya está registrado como destinatario');
  }

  const now = new Date().toISOString();
  const id = `rcp-${randomBytes(8).toString('hex')}`;
  db.prepare(
    `INSERT INTO notification_recipients
       (id, email, name, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, email, input.name?.trim() || null, input.active === false ? 0 : 1, now, now);

  return {
    id,
    email,
    name: input.name?.trim() || undefined,
    active: input.active !== false,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateNotificationRecipient(
  id: string,
  patch: Partial<NotificationRecipientInput>
): NotificationRecipient | null {
  const db = getDb();
  const current = db
    .prepare('SELECT * FROM notification_recipients WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!current) return null;

  const email =
    patch.email === undefined ? String(current['email']) : normalizeEmail(patch.email);
  if (email !== String(current['email'])) {
    const duplicate = db
      .prepare('SELECT id FROM notification_recipients WHERE email = ? AND id <> ?')
      .get(email, id);
    if (duplicate) {
      throw new Error('El correo ya está registrado como destinatario');
    }
  }

  const name =
    patch.name === undefined
      ? current['name'] === null
        ? null
        : String(current['name'])
      : patch.name.trim() || null;
  const active =
    patch.active === undefined
      ? Number(current['active'])
      : patch.active
        ? 1
        : 0;
  const updatedAt = new Date().toISOString();

  db.prepare(
    `UPDATE notification_recipients
        SET email = ?, name = ?, active = ?, updated_at = ?
      WHERE id = ?`
  ).run(email, name, active, updatedAt, id);

  return {
    id,
    email,
    name: name ?? undefined,
    active: active === 1,
    createdAt: String(current['created_at']),
    updatedAt,
  };
}

export function deleteNotificationRecipient(id: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM notification_recipients WHERE id = ?')
    .run(id);
  return result.changes > 0;
}

export interface TunnelSessionInput {
  provider?: string;
  mode?: string;
  publicUrl: string;
  apiUrl?: string;
  status?: string;
  pid?: number;
  startedAt?: string;
  metadata?: unknown;
}

function normalizeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('La URL pública no es válida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('La URL pública debe usar http o https');
  }
  return url.toString().replace(/\/$/, '');
}

/** Record a new tunnel URL and mark the previous active session as replaced. */
export function recordTunnelSession(input: TunnelSessionInput): TunnelSession {
  const db = getDb();
  const publicUrl = normalizeUrl(input.publicUrl);
  const apiUrl = normalizeUrl(input.apiUrl || `${publicUrl}/api`);
  const startedAt = input.startedAt || new Date().toISOString();
  const status = input.status || 'activo';
  const id = `tun-${randomBytes(8).toString('hex')}`;
  const metadata =
    input.metadata === undefined ? null : JSON.stringify(input.metadata);

  const insert = db.transaction(() => {
    if (status === 'activo') {
      db.prepare(
        `UPDATE tunnel_sessions
            SET status = 'reemplazado', ended_at = COALESCE(ended_at, ?)
          WHERE status = 'activo'`
      ).run(startedAt);
    }
    db.prepare(
      `INSERT INTO tunnel_sessions
         (id, provider, mode, public_url, api_url, status, pid,
          started_at, ended_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      id,
      input.provider || 'cloudflare',
      input.mode || 'quick',
      publicUrl,
      apiUrl,
      status,
      input.pid ?? null,
      startedAt,
      metadata
    );
  });
  insert();

  return {
    id,
    provider: input.provider || 'cloudflare',
    mode: input.mode || 'quick',
    publicUrl,
    apiUrl,
    status,
    pid: input.pid,
    startedAt,
    metadata: input.metadata,
  };
}

export function closeTunnelSession(
  id: string,
  status = 'detenido'
): TunnelSession | null {
  const db = getDb();
  const endedAt = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE tunnel_sessions
          SET status = ?, ended_at = COALESCE(ended_at, ?)
        WHERE id = ?`
    )
    .run(status, endedAt, id);
  if (result.changes === 0) return null;

  const row = db
    .prepare('SELECT * FROM tunnel_sessions WHERE id = ?')
    .get(id) as Record<string, unknown>;
  return rowToSession(row);
}

export function getLatestTunnelSession(): TunnelSession | null {
  const row = getDb()
    .prepare(
      'SELECT * FROM tunnel_sessions ORDER BY started_at DESC, rowid DESC LIMIT 1'
    )
    .get() as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function listTunnelSessions(limit = 20): TunnelSession[] {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 20));
  const rows = getDb()
    .prepare(
      'SELECT * FROM tunnel_sessions ORDER BY started_at DESC, rowid DESC LIMIT ?'
    )
    .all(safeLimit) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export interface NotificationLogEntry {
  id: string;
  kind: string;
  recipients: string[];
  bcc: string[];
  subject: string;
  status: string;
  attempts: number;
  error?: string;
  createdAt: string;
  sentAt?: string;
}

function rowToLog(row: Record<string, unknown>): NotificationLogEntry {
  return {
    id: String(row['id']),
    kind: String(row['kind']),
    recipients: String(row['recipients'] || '')
      .split(',')
      .filter(Boolean),
    bcc: String(row['bcc'] || '')
      .split(',')
      .filter(Boolean),
    subject: String(row['subject']),
    status: String(row['status']),
    attempts: Number(row['attempts']),
    error: row['error'] ? String(row['error']) : undefined,
    createdAt: String(row['created_at']),
    sentAt: row['sent_at'] ? String(row['sent_at']) : undefined,
  };
}

export function listNotificationLog(limit = 20): NotificationLogEntry[] {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 20));
  const rows = getDb()
    .prepare(
      'SELECT * FROM notification_log ORDER BY created_at DESC, rowid DESC LIMIT ?'
    )
    .all(safeLimit) as Record<string, unknown>[];
  return rows.map(rowToLog);
}

function createLog(
  kind: string,
  recipients: string[],
  bcc: string[],
  subject: string,
  status: string,
  error?: string
): string {
  const id = `log-${randomBytes(8).toString('hex')}`;
  getDb()
    .prepare(
      `INSERT INTO notification_log
         (id, kind, recipients, bcc, subject, status, attempts, error, created_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)`
    )
    .run(
      id,
      kind,
      recipients.join(','),
      bcc.join(','),
      subject,
      status,
      error ?? null,
      new Date().toISOString()
    );
  return id;
}

function updateLog(
  id: string,
  status: string,
  attempts: number,
  error?: string
): void {
  getDb()
    .prepare(
      `UPDATE notification_log
          SET status = ?, attempts = ?, error = ?, sent_at = ?
        WHERE id = ?`
    )
    .run(
      status,
      attempts,
      error ?? null,
      status === 'enviado' ? new Date().toISOString() : null,
      id
    );
}

export interface NotificationResult {
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
  recipients: string[];
  bcc: string[];
  attempts: number;
  logId?: string;
  error?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatFrom(config: SmtpConfig): string {
  if (!config.fromName) return config.from;
  return `"${config.fromName.replace(/"/g, '\\"')}" <${config.from}>`;
}

function buildMessage(
  config: SmtpConfig,
  publicUrl: string,
  apiUrl: string,
  subject: string,
  recipients: string[],
  startedAt: string
): MailMessage {
  const generatedAt = new Date().toISOString();
  const text = [
    'Mermelada ERP - Nuevas URLs públicas',
    '',
    `Aplicación: ${publicUrl}`,
    `API:        ${apiUrl}`,
    `Túnel iniciado: ${startedAt}`,
    `Correo generado: ${generatedAt}`,
    '',
    'La URL de Cloudflare Quick Tunnel cambia cada vez que el túnel se reinicia.',
    'Consulte la última sesión guardada en GET /api/system/tunnel.',
    '',
    'Este mensaje se envió automáticamente por el sistema de notificaciones.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
    <h2 style="margin-bottom: 8px;">Mermelada ERP — Nuevas URLs públicas</h2>
    <p>El túnel de Cloudflare se inició correctamente.</p>
    <table cellpadding="8" cellspacing="0" style="border-collapse: collapse; border: 1px solid #d1d5db;">
      <tr>
        <th align="left" style="border-bottom: 1px solid #d1d5db; background: #f3f4f6;">Aplicación</th>
        <td style="border-bottom: 1px solid #d1d5db;"><a href="${escapeHtml(publicUrl)}">${escapeHtml(publicUrl)}</a></td>
      </tr>
      <tr>
        <th align="left" style="border-bottom: 1px solid #d1d5db; background: #f3f4f6;">API</th>
        <td style="border-bottom: 1px solid #d1d5db;"><a href="${escapeHtml(apiUrl)}">${escapeHtml(apiUrl)}</a></td>
      </tr>
      <tr>
        <th align="left" style="background: #f3f4f6;">Inicio del túnel</th>
        <td>${escapeHtml(startedAt)}</td>
      </tr>
    </table>
    <p style="color: #6b7280; font-size: 13px;">
      La URL de Cloudflare Quick Tunnel cambia cada vez que el túnel se reinicia.
      Consulte la última sesión guardada en <code>GET /api/system/tunnel</code>.
    </p>
  </body>
</html>`;

  return {
    from: formatFrom(config),
    to: recipients.join(', '),
    bcc: config.bcc.length > 0 ? config.bcc.join(', ') : undefined,
    subject,
    text,
    html,
  };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SendTunnelNotificationOptions {
  publicUrl: string;
  apiUrl?: string;
  startedAt?: string;
  transport?: MailTransport;
  retryDelayMs?: number;
}

/**
 * Send the deployment email to every active recipient (plus the configured
 * hidden copy). Failures are logged and retried; this function never throws so
 * a mail outage cannot take the tunnel down.
 */
export async function sendTunnelNotification(
  options: SendTunnelNotificationOptions
): Promise<NotificationResult> {
  const recipients = listNotificationRecipients()
    .filter((recipient) => recipient.active)
    .map((recipient) => recipient.email);
  const config = readSmtpConfig();
  const bcc = config?.bcc ?? [];
  const subject = `[Mermelada ERP] URLs públicas actualizadas (${new Date().toISOString()})`;
  const apiUrl =
    options.apiUrl || `${options.publicUrl.replace(/\/$/, '')}/api`;
  const startedAt = options.startedAt || new Date().toISOString();

  if (recipients.length === 0) {
    const logId = createLog(
      'tunnel-urls',
      recipients,
      bcc,
      subject,
      'omitido',
      'no_recipients'
    );
    return {
      status: 'skipped',
      reason: 'no_recipients',
      recipients,
      bcc,
      attempts: 0,
      logId,
    };
  }

  if (!config) {
    const logId = createLog(
      'tunnel-urls',
      recipients,
      bcc,
      subject,
      'omitido',
      'smtp_not_configured'
    );
    return {
      status: 'skipped',
      reason: 'smtp_not_configured',
      recipients,
      bcc,
      attempts: 0,
      logId,
    };
  }

  const logId = createLog('tunnel-urls', recipients, bcc, subject, 'pendiente');
  const message = buildMessage(
    config,
    options.publicUrl,
    apiUrl,
    subject,
    recipients,
    startedAt
  );

  const transport =
    options.transport ??
    (transportFactory ?? defaultTransportFactory)(config);
  const retryDelayMs =
    options.retryDelayMs ??
    Math.max(0, Number(process.env['SMTP_RETRY_DELAY_MS'] || 1000));
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
    try {
      await transport.sendMail(message);
      updateLog(logId, 'enviado', attempt);
      return {
        status: 'sent',
        recipients,
        bcc,
        attempts: attempt,
        logId,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      updateLog(logId, 'reintentando', attempt, lastError);
      if (attempt < MAX_SEND_ATTEMPTS) {
        await sleep(retryDelayMs * attempt);
      }
    }
  }

  updateLog(logId, 'fallido', MAX_SEND_ATTEMPTS, lastError);
  return {
    status: 'failed',
    recipients,
    bcc,
    attempts: MAX_SEND_ATTEMPTS,
    logId,
    error: lastError,
  };
}

/** Re-send the notification for the latest stored tunnel session. */
export async function resendTunnelNotification(
  transport?: MailTransport
): Promise<NotificationResult> {
  const latest = getLatestTunnelSession();
  if (!latest) {
    return {
      status: 'skipped',
      reason: 'no_tunnel_session',
      recipients: [],
      bcc: [],
      attempts: 0,
    };
  }
  return sendTunnelNotification({
    publicUrl: latest.publicUrl,
    apiUrl: latest.apiUrl,
    startedAt: latest.startedAt,
    transport,
  });
}

// --- Express handlers -------------------------------------------------------

export function listNotificationRecipientsHandler(
  _req: Request,
  res: Response
): void {
  res.json(listNotificationRecipients());
}

export function createNotificationRecipientHandler(
  req: Request,
  res: Response
): void {
  const recipient = createNotificationRecipient({
    email: String(req.body.email),
    name: req.body.name ? String(req.body.name) : undefined,
    active: req.body.active,
  });
  res.status(201).json(recipient);
}

export function updateNotificationRecipientHandler(
  req: Request,
  res: Response
): void {
  const recipient = updateNotificationRecipient(String(req.params['id']), {
    email: req.body.email ? String(req.body.email) : undefined,
    name: req.body.name === undefined ? undefined : String(req.body.name),
    active: req.body.active,
  });
  if (!recipient) {
    res.status(404).json({
      error: 'Destinatario no encontrado',
      code: 'NOT_FOUND',
    });
    return;
  }
  res.json(recipient);
}

export function deleteNotificationRecipientHandler(
  req: Request,
  res: Response
): void {
  if (!deleteNotificationRecipient(String(req.params['id']))) {
    res.status(404).json({
      error: 'Destinatario no encontrado',
      code: 'NOT_FOUND',
    });
    return;
  }
  res.json({ success: true });
}

export async function resendTunnelNotificationHandler(
  _req: Request,
  res: Response
): Promise<void> {
  const result = await resendTunnelNotification();
  res.status(result.status === 'failed' ? 502 : 200).json(result);
}

export function listNotificationLogHandler(req: Request, res: Response): void {
  const limit = Number(req.query['limit'] || 20);
  res.json(listNotificationLog(limit));
}
