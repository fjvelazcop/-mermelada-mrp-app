import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getDb } from './database/persistence.js';

/**
 * System license control.
 *
 * The ERP has a single global license (`system_license.id = 1`). It is renewed
 * with an Ed25519-signed token, so a database edit or shell access cannot
 * extend the validity without the private key, which never lives on the server.
 *
 * The license is independent from `activation_records`, the master-only ledger
 * of customer payments.
 */

export const LICENSE_TOKEN_PREFIX = 'mrm1';
const MS_PER_DAY = 86_400_000;
const CLOCK_SKEW_MS = 10 * 60_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export type LicenseStatus = 'activa' | 'prueba' | 'suspendida';
export type LicenseMode = 'normal' | 'aviso' | 'gracia' | 'solo_lectura';

export interface LicenseRecord {
  licenseId: string;
  status: LicenseStatus;
  holder?: string;
  issuedAt: string;
  expiresAt: string;
  graceDays: number;
  tokenId?: string;
  lastSeenAt?: string;
  maxSeenAt?: string;
  updatedBy?: string;
  updatedAt: string;
}

export interface LicenseSnapshot {
  enabled: boolean;
  licenseId: string;
  status: LicenseStatus;
  holder?: string;
  issuedAt: string;
  expiresAt: string;
  graceDays: number;
  daysRemaining: number;
  mode: LicenseMode;
  readOnly: boolean;
  maxDays: number;
  alertDays: number;
  clockTampered: boolean;
  updatedAt: string;
}

export interface LicenseEvent {
  id: string;
  licenseId?: string;
  action: string;
  status?: string;
  expiresAt?: string;
  graceDays?: number;
  actor?: string;
  source: string;
  tokenId?: string;
  detail?: string;
  createdAt: string;
}

export interface LicenseAlert {
  id: string;
  licenseId: string;
  alertDate: string;
  daysRemaining: number;
  recipients: string[];
  status: string;
  error?: string;
  createdAt: string;
  sentAt?: string;
}

export interface LicenseTokenPayload {
  v: 1;
  licenseId: string;
  status: 'activa' | 'prueba';
  issuedAt: string;
  expiresAt: string;
  graceDays: number;
  holder?: string;
  nonce: string;
}

interface LicenseRow {
  license_id: string;
  status: string;
  holder: string | null;
  issued_at: string;
  expires_at: string;
  grace_days: number;
  token_id: string | null;
  last_seen_at: string | null;
  max_seen_at: string | null;
  updated_by: string | null;
  updated_at: string;
}

/** Error de licencia con un código estable para la API y el CLI. */
export class LicenseError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'LICENSE_ERROR') {
    super(message);
    this.name = 'LicenseError';
    this.code = code;
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

/**
 * Trim an env value and drop surrounding quotes. Different loaders behave
 * differently: PM2/Compose strip quotes, but `docker run --env-file` and
 * systemd EnvironmentFile keep them literally. Normalizing here keeps labels
 * such as LICENSE_HOLDER consistent across every deployment method.
 */
function cleanEnvValue(value: string | undefined): string {
  return (value ?? '').trim().replace(/^["']|["']$/g, '');
}

export function isLicenseEnabled(): boolean {
  return process.env['LICENSE_ENABLED'] === 'true';
}

export function maxLicenseDays(): number {
  return positiveInt(process.env['LICENSE_MAX_DAYS'], 30);
}

export function defaultGraceDays(): number {
  return positiveInt(process.env['LICENSE_GRACE_DAYS'], 7);
}

export function licenseAlertDays(): number {
  return positiveInt(process.env['LICENSE_ALERT_DAYS'], 3);
}

function clockToleranceMs(): number {
  return positiveInt(process.env['LICENSE_ROLLBACK_TOLERANCE_HOURS'], 24) * 3_600_000;
}

function toRecord(row: LicenseRow): LicenseRecord {
  const status: LicenseStatus = ['activa', 'prueba', 'suspendida'].includes(
    row.status
  )
    ? (row.status as LicenseStatus)
    : 'prueba';
  return {
    licenseId: row.license_id,
    status,
    holder: row.holder ?? undefined,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    graceDays: Number(row.grace_days) || 0,
    tokenId: row.token_id ?? undefined,
    lastSeenAt: row.last_seen_at ?? undefined,
    maxSeenAt: row.max_seen_at ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    updatedAt: row.updated_at,
  };
}

function insertEvent(input: {
  licenseId?: string;
  action: string;
  status?: string;
  expiresAt?: string;
  graceDays?: number;
  actor?: string;
  source: string;
  tokenId?: string;
  detail?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO license_events
         (id, license_id, action, status, expires_at, grace_days, actor, source, token_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `lev-${createHash('sha256')
        .update(`${Date.now()}-${Math.random()}`)
        .digest('hex')
        .slice(0, 16)}`,
      input.licenseId ?? null,
      input.action,
      input.status ?? null,
      input.expiresAt ?? null,
      input.graceDays ?? null,
      input.actor ?? null,
      input.source,
      input.tokenId ?? null,
      input.detail ?? null,
      new Date().toISOString()
    );
}

/**
 * Ensure the singleton license exists. Fresh installations start with a
 * `prueba` license so the deployment is never locked out by the migration.
 */
export function ensureSystemLicense(now = new Date()): LicenseRecord {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM system_license WHERE id = 1')
    .get() as LicenseRow | undefined;
  if (row) return toRecord(row);

  const initialDays = positiveInt(process.env['LICENSE_INITIAL_DAYS'], 30);
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + initialDays * MS_PER_DAY).toISOString();
  const licenseId = cleanEnvValue(process.env['LICENSE_ID']) || 'erp-mermelada';
  const holder = cleanEnvValue(process.env['LICENSE_HOLDER']) || 'Mermelada ERP';

  db.prepare(
    `INSERT INTO system_license
       (id, license_id, status, holder, issued_at, expires_at, grace_days,
        token_id, last_seen_at, max_seen_at, updated_by, updated_at)
     VALUES (1, ?, 'prueba', ?, ?, ?, ?, NULL, ?, ?, 'sistema', ?)`
  ).run(
    licenseId,
    holder,
    issuedAt,
    expiresAt,
    defaultGraceDays(),
    issuedAt,
    issuedAt,
    issuedAt
  );

  insertEvent({
    licenseId,
    action: 'creada',
    status: 'prueba',
    expiresAt,
    graceDays: defaultGraceDays(),
    actor: 'sistema',
    source: 'sistema',
    detail: `Licencia de prueba inicial de ${initialDays} días`,
  });

  return ensureSystemLicense(now);
}

export function getLicenseRecord(): LicenseRecord {
  ensureSystemLicense();
  const row = getDb()
    .prepare('SELECT * FROM system_license WHERE id = 1')
    .get() as LicenseRow | undefined;
  if (!row) throw new LicenseError('No se pudo inicializar la licencia');
  return toRecord(row);
}

/** Compute the effective mode, including grace period and clock tampering. */
export function computeLicenseSnapshot(
  record: LicenseRecord,
  now = new Date()
): LicenseSnapshot {
  const nowMs = now.getTime();
  const expiresMs = Date.parse(record.expiresAt);
  const graceMs = record.graceDays * MS_PER_DAY;
  const maxSeenMs = record.maxSeenAt ? Date.parse(record.maxSeenAt) : NaN;
  const clockTampered =
    Number.isFinite(maxSeenMs) && nowMs < maxSeenMs - clockToleranceMs();
  const daysRemaining = Number.isFinite(expiresMs)
    ? Math.ceil((expiresMs - nowMs) / MS_PER_DAY)
    : 0;

  let mode: LicenseMode = 'normal';
  if (record.status === 'suspendida') {
    mode = 'solo_lectura';
  } else if (clockTampered) {
    mode = 'solo_lectura';
  } else if (nowMs >= expiresMs + graceMs) {
    mode = 'solo_lectura';
  } else if (nowMs >= expiresMs) {
    mode = 'gracia';
  } else if (daysRemaining <= licenseAlertDays()) {
    mode = 'aviso';
  }

  return {
    enabled: isLicenseEnabled(),
    licenseId: record.licenseId,
    status: record.status,
    holder: record.holder,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    graceDays: record.graceDays,
    daysRemaining,
    mode,
    readOnly: isLicenseEnabled() && mode === 'solo_lectura',
    maxDays: maxLicenseDays(),
    alertDays: licenseAlertDays(),
    clockTampered,
    updatedAt: record.updatedAt,
  };
}

export function getLicenseSnapshot(now = new Date()): LicenseSnapshot {
  return computeLicenseSnapshot(getLicenseRecord(), now);
}

let lastTouch = 0;

/**
 * Record that the server is alive and the highest clock value observed. The
 * update is throttled so it does not write on every request.
 */
export function touchLicense(now = new Date()): void {
  if (now.getTime() - lastTouch < TOUCH_INTERVAL_MS) return;
  lastTouch = now.getTime();
  try {
    const record = getLicenseRecord();
    const observed = now.toISOString();
    const maxSeen =
      record.maxSeenAt && Date.parse(record.maxSeenAt) > now.getTime()
        ? record.maxSeenAt
        : observed;
    getDb()
      .prepare(
        `UPDATE system_license
            SET last_seen_at = ?, max_seen_at = ?
          WHERE id = 1`
      )
      .run(observed, maxSeen);
  } catch {
    // A missing table or a locked database must not break the request flow.
  }
}

/** Test helper: reset the in-memory throttle. */
export function resetLicenseTouchCache(): void {
  lastTouch = 0;
}

function readPublicKey(): KeyObject {
  const inline = process.env['LICENSE_PUBLIC_KEY']?.trim();
  const path = process.env['LICENSE_PUBLIC_KEY_PATH']?.trim();

  let pem = '';
  if (inline) {
    pem = inline.includes('BEGIN PUBLIC KEY')
      ? inline.replace(/\\n/g, '\n')
      : Buffer.from(inline, 'base64').toString('utf8');
  } else if (path) {
    try {
      pem = readFileSync(path, 'utf8');
    } catch {
      throw new LicenseError(
        `No se pudo leer la clave pública de licencia en ${path}`,
        'LICENSE_PUBLIC_KEY_MISSING'
      );
    }
  }

  if (!pem) {
    throw new LicenseError(
      'LICENSE_PUBLIC_KEY o LICENSE_PUBLIC_KEY_PATH no está configurada',
      'LICENSE_PUBLIC_KEY_MISSING'
    );
  }

  try {
    return createPublicKey(pem);
  } catch {
    throw new LicenseError(
      'La clave pública de licencia no tiene un formato PEM válido',
      'LICENSE_PUBLIC_KEY_INVALID'
    );
  }
}

function parsePayload(raw: string): LicenseTokenPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LicenseError('El token no contiene un payload JSON válido', 'LICENSE_TOKEN_INVALID');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new LicenseError('El payload del token es inválido', 'LICENSE_TOKEN_INVALID');
  }

  const payload = parsed as Partial<LicenseTokenPayload>;
  if (payload.v !== 1) {
    throw new LicenseError(`Versión de token no soportada: ${String(payload.v)}`, 'LICENSE_TOKEN_VERSION');
  }
  if (payload.status !== 'activa' && payload.status !== 'prueba') {
    throw new LicenseError('Estado de licencia inválido en el token', 'LICENSE_TOKEN_INVALID');
  }
  if (
    typeof payload.licenseId !== 'string' ||
    !payload.licenseId.trim() ||
    typeof payload.issuedAt !== 'string' ||
    typeof payload.expiresAt !== 'string' ||
    typeof payload.nonce !== 'string' ||
    !payload.nonce.trim()
  ) {
    throw new LicenseError('El token está incompleto', 'LICENSE_TOKEN_INVALID');
  }
  if (
    typeof payload.graceDays !== 'number' ||
    !Number.isInteger(payload.graceDays) ||
    payload.graceDays < 0 ||
    payload.graceDays > 365
  ) {
    throw new LicenseError('Los días de gracia del token son inválidos', 'LICENSE_TOKEN_INVALID');
  }

  const issuedMs = Date.parse(payload.issuedAt);
  const expiresMs = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) {
    throw new LicenseError('Las fechas del token son inválidas', 'LICENSE_TOKEN_INVALID');
  }
  if (expiresMs <= issuedMs) {
    throw new LicenseError('El vencimiento debe ser posterior a la emisión', 'LICENSE_TOKEN_INVALID');
  }

  const durationDays = (expiresMs - issuedMs) / MS_PER_DAY;
  if (durationDays > maxLicenseDays() + 1 / 24) {
    throw new LicenseError(
      `La vigencia máxima permitida es ${maxLicenseDays()} días`,
      'LICENSE_TOKEN_TOO_LONG'
    );
  }
  if (issuedMs > Date.now() + CLOCK_SKEW_MS) {
    throw new LicenseError('El token fue emitido en el futuro; revise el reloj del servidor', 'LICENSE_TOKEN_FUTURE');
  }
  if (expiresMs <= Date.now()) {
    throw new LicenseError('El token ya está vencido', 'LICENSE_TOKEN_EXPIRED');
  }

  return payload as LicenseTokenPayload;
}

/**
 * Decode and verify a signed token. Throws `LicenseError` with a precise code.
 */
export function decodeLicenseToken(token: string): {
  payload: LicenseTokenPayload;
  tokenId: string;
} {
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_TOKEN_PREFIX) {
    throw new LicenseError(
      `Formato de token inválido; se esperaba ${LICENSE_TOKEN_PREFIX}.<payload>.<firma>`,
      'LICENSE_TOKEN_FORMAT'
    );
  }

  const [, payloadPart, signaturePart] = parts;
  let payloadRaw: string;
  try {
    payloadRaw = Buffer.from(payloadPart, 'base64url').toString('utf8');
  } catch {
    throw new LicenseError('El payload del token no es base64url válido', 'LICENSE_TOKEN_INVALID');
  }

  const payload = parsePayload(payloadRaw);
  const key = readPublicKey();
  const valid = verifySignature(
    null,
    Buffer.from(payloadPart),
    key,
    Buffer.from(signaturePart, 'base64url')
  );
  if (!valid) {
    throw new LicenseError('La firma del token no es válida', 'LICENSE_TOKEN_SIGNATURE');
  }

  const tokenId = createHash('sha256').update(trimmed).digest('hex').slice(0, 16);
  return { payload, tokenId };
}

export interface ApplyLicenseResult {
  snapshot: LicenseSnapshot;
  tokenId: string;
}

/** Validate and persist a signed token. */
export function applyLicenseToken(
  token: string,
  actor?: string,
  source = 'api'
): ApplyLicenseResult {
  const { payload, tokenId } = decodeLicenseToken(token);
  const now = new Date();
  const nowIso = now.toISOString();
  const db = getDb();
  const current = getLicenseRecord();
  const maxSeen =
    current.maxSeenAt && Date.parse(current.maxSeenAt) > now.getTime()
      ? current.maxSeenAt
      : nowIso;

  db.prepare(
    `UPDATE system_license SET
        license_id = ?, status = ?, holder = ?, issued_at = ?, expires_at = ?,
        grace_days = ?, token_id = ?, last_seen_at = ?, max_seen_at = ?,
        updated_by = ?, updated_at = ?
      WHERE id = 1`
  ).run(
    payload.licenseId.trim(),
    payload.status,
    payload.holder?.trim() || null,
    payload.issuedAt,
    payload.expiresAt,
    payload.graceDays,
    tokenId,
    nowIso,
    maxSeen,
    actor?.trim() || null,
    nowIso
  );

  insertEvent({
    licenseId: payload.licenseId,
    action: 'aplicada',
    status: payload.status,
    expiresAt: payload.expiresAt,
    graceDays: payload.graceDays,
    actor,
    source,
    tokenId,
    detail: `Vigencia hasta ${payload.expiresAt}`,
  });

  return { snapshot: getLicenseSnapshot(now), tokenId };
}

/** Immediately suspend the license (read-only until a new token is applied). */
export function suspendLicense(
  reason: string | undefined,
  actor?: string,
  source = 'api'
): LicenseSnapshot {
  const now = new Date().toISOString();
  const current = getLicenseRecord();
  getDb()
    .prepare(
      `UPDATE system_license
          SET status = 'suspendida', updated_by = ?, updated_at = ?
        WHERE id = 1`
    )
    .run(actor?.trim() || null, now);

  insertEvent({
    licenseId: current.licenseId,
    action: 'suspendida',
    status: 'suspendida',
    expiresAt: current.expiresAt,
    graceDays: current.graceDays,
    actor,
    source,
    detail: reason?.trim() || undefined,
  });

  return getLicenseSnapshot(new Date(now));
}

function rowToEvent(row: Record<string, unknown>): LicenseEvent {
  return {
    id: String(row['id']),
    licenseId: row['license_id'] ? String(row['license_id']) : undefined,
    action: String(row['action']),
    status: row['status'] ? String(row['status']) : undefined,
    expiresAt: row['expires_at'] ? String(row['expires_at']) : undefined,
    graceDays:
      row['grace_days'] === null || row['grace_days'] === undefined
        ? undefined
        : Number(row['grace_days']),
    actor: row['actor'] ? String(row['actor']) : undefined,
    source: String(row['source']),
    tokenId: row['token_id'] ? String(row['token_id']) : undefined,
    detail: row['detail'] ? String(row['detail']) : undefined,
    createdAt: String(row['created_at']),
  };
}

export function listLicenseEvents(limit = 20): LicenseEvent[] {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 20));
  const rows = getDb()
    .prepare('SELECT * FROM license_events ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(safeLimit) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

function rowToAlert(row: Record<string, unknown>): LicenseAlert {
  return {
    id: String(row['id']),
    licenseId: String(row['license_id']),
    alertDate: String(row['alert_date']),
    daysRemaining: Number(row['days_remaining']),
    recipients: String(row['recipients'] || '')
      .split(',')
      .filter(Boolean),
    status: String(row['status']),
    error: row['error'] ? String(row['error']) : undefined,
    createdAt: String(row['created_at']),
    sentAt: row['sent_at'] ? String(row['sent_at']) : undefined,
  };
}

export function listLicenseAlerts(limit = 20): LicenseAlert[] {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 20));
  const rows = getDb()
    .prepare('SELECT * FROM license_alerts ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(safeLimit) as Record<string, unknown>[];
  return rows.map(rowToAlert);
}

/** Insert an alert row exactly once per license/day. Returns false on duplicate. */
export function reserveLicenseAlert(input: {
  licenseId: string;
  alertDate: string;
  daysRemaining: number;
  recipients: string[];
}): string | null {
  const id = `lal-${createHash('sha256')
    .update(`${input.licenseId}-${input.alertDate}`)
    .digest('hex')
    .slice(0, 16)}`;
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO license_alerts
         (id, license_id, alert_date, days_remaining, recipients, status, error, created_at, sent_at)
       VALUES (?, ?, ?, ?, ?, 'pendiente', NULL, ?, NULL)`
    )
    .run(
      id,
      input.licenseId,
      input.alertDate,
      input.daysRemaining,
      input.recipients.join(','),
      new Date().toISOString()
    );
  return result.changes > 0 ? id : null;
}

export function updateLicenseAlert(
  id: string,
  status: string,
  error?: string
): void {
  const sent = status === 'enviado' || status === 'parcial';
  getDb()
    .prepare(
      `UPDATE license_alerts
          SET status = ?, error = ?, sent_at = ?
        WHERE id = ?`
    )
    .run(status, error ?? null, sent ? new Date().toISOString() : null, id);
}
