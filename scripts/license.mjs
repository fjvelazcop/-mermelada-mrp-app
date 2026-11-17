#!/usr/bin/env node
/**
 * System-license CLI.
 *
 * Designed to be run by the licensor from their own machine (to issue tokens)
 * and over the existing SSH access on the server (to apply/query/suspend).
 *
 *   node scripts/license.mjs issue --days 30 --private-key ./keys/license-private.pem
 *   node scripts/license.mjs apply "mrm1...."
 *   node scripts/license.mjs status
 *   node scripts/license.mjs suspend --reason "falta de pago"
 *   node scripts/license.mjs events
 *   node scripts/license.mjs alerts --test
 *
 * The script talks directly to SQLite (DB_PATH), so it does not need the app
 * to be restarted after applying a token.
 */

import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

const TOKEN_PREFIX = 'mrm1';
const MS_PER_DAY = 86_400_000;
const CLOCK_SKEW_MS = 10 * 60_000;

// --- Minimal .env loader -----------------------------------------------------
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnvFile(resolve('.env'));
loadEnvFile(resolve('.env.production'));

// --- Arguments ---------------------------------------------------------------
const [command = 'help', ...rest] = process.argv.slice(2);

function hasFlag(name) {
  return rest.includes(`--${name}`);
}

function arg(name, fallback) {
  const exact = `--${name}`;
  const equals = `${exact}=`;
  const eq = rest.find((item) => item.startsWith(equals));
  if (eq) return eq.slice(equals.length);
  const index = rest.indexOf(exact);
  if (index !== -1) return rest[index + 1] ?? fallback;
  return fallback;
}

function positional(index = 0) {
  const values = rest.filter((item) => !item.startsWith('--'));
  // Skip values that belong to flags.
  const consumed = new Set();
  for (let i = 0; i < rest.length; i += 1) {
    if (!rest[i].startsWith('--')) continue;
    if (rest[i].includes('=')) continue;
    if (rest[i + 1] && !rest[i + 1].startsWith('--')) consumed.add(rest[i + 1]);
  }
  const free = values.filter((value) => !consumed.has(value));
  return free[index];
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function maxDays() {
  return positiveInt(process.env['LICENSE_MAX_DAYS'], 30);
}

function defaultGraceDays() {
  return positiveInt(process.env['LICENSE_GRACE_DAYS'], 7);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('es-VE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: process.env['TZ'] || 'America/Caracas',
  }).format(date);
}

// --- Database ----------------------------------------------------------------
const dbPath = resolve(process.env['DB_PATH'] || './data/mermelada.db');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS system_license (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    license_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'prueba',
    holder TEXT,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    grace_days INTEGER NOT NULL DEFAULT 7,
    token_id TEXT,
    last_seen_at TEXT,
    max_seen_at TEXT,
    updated_by TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS license_events (
    id TEXT PRIMARY KEY,
    license_id TEXT,
    action TEXT NOT NULL,
    status TEXT,
    expires_at TEXT,
    grace_days INTEGER,
    actor TEXT,
    source TEXT NOT NULL,
    token_id TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS license_alerts (
    id TEXT PRIMARY KEY,
    license_id TEXT NOT NULL,
    alert_date TEXT NOT NULL,
    days_remaining INTEGER NOT NULL,
    recipients TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    UNIQUE(license_id, alert_date)
  );
`);

function ensureLicense() {
  const row = db.prepare('SELECT * FROM system_license WHERE id = 1').get();
  if (row) return row;
  const now = new Date();
  const initialDays = positiveInt(process.env['LICENSE_INITIAL_DAYS'], 30);
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + initialDays * MS_PER_DAY).toISOString();
  const licenseId = process.env['LICENSE_ID']?.trim() || 'erp-mermelada';
  const holder = process.env['LICENSE_HOLDER']?.trim() || 'Mermelada ERP';
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
    source: 'cli',
    detail: `Licencia de prueba inicial de ${initialDays} días`,
  });
  return db.prepare('SELECT * FROM system_license WHERE id = 1').get();
}

function insertEvent(input) {
  db.prepare(
    `INSERT INTO license_events
       (id, license_id, action, status, expires_at, grace_days, actor, source, token_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `lev-${randomBytes(8).toString('hex')}`,
    input.licenseId ?? null,
    input.action,
    input.status ?? null,
    input.expiresAt ?? null,
    input.graceDays ?? null,
    input.actor ?? null,
    input.source ?? 'cli',
    input.tokenId ?? null,
    input.detail ?? null,
    new Date().toISOString()
  );
}

function readPrivateKey() {
  const path = resolve(
    arg('private-key', process.env['LICENSE_PRIVATE_KEY_PATH'] || './keys/license-private.pem')
  );
  if (!existsSync(path)) {
    fail(
      `no se encontró la clave privada en ${path}. Genérela con: node scripts/license-keygen.mjs --out ./keys`
    );
  }
  if (process.platform !== 'win32') {
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      console.warn(
        `Advertencia: ${path} tiene permisos ${mode.toString(8)}; use chmod 600 para protegerla.`
      );
    }
  }
  try {
    return createPrivateKey(readFileSync(path, 'utf8'));
  } catch {
    fail(`la clave privada ${path} no es un PEM válido`);
  }
}

function readPublicKey() {
  const inline = arg('public-key', process.env['LICENSE_PUBLIC_KEY'] || '').trim();
  if (inline) {
    const pem = inline.includes('BEGIN PUBLIC KEY')
      ? inline.replace(/\\n/g, '\n')
      : Buffer.from(inline, 'base64').toString('utf8');
    try {
      return createPublicKey(pem);
    } catch {
      fail('LICENSE_PUBLIC_KEY no es una clave PEM válida');
    }
  }
  const path = resolve(
    process.env['LICENSE_PUBLIC_KEY_PATH'] || './keys/license-public.pem'
  );
  if (!existsSync(path)) {
    fail(
      `no se encontró la clave pública en ${path}. Configure LICENSE_PUBLIC_KEY_PATH.`
    );
  }
  try {
    return createPublicKey(readFileSync(path, 'utf8'));
  } catch {
    fail(`la clave pública ${path} no es un PEM válido`);
  }
}

function signToken(payload) {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(null, Buffer.from(payloadPart), readPrivateKey());
  return `${TOKEN_PREFIX}.${payloadPart}.${signature.toString('base64url')}`;
}

function verifyToken(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    fail(`formato de token inválido; se esperaba ${TOKEN_PREFIX}.<payload>.<firma>`);
  }
  const [, payloadPart, signaturePart] = parts;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    fail('el payload del token no es JSON válido');
  }
  if (!payload || payload.v !== 1) fail(`versión de token no soportada: ${payload?.v}`);
  if (payload.status !== 'activa' && payload.status !== 'prueba') {
    fail('estado de licencia inválido en el token');
  }
  if (
    typeof payload.licenseId !== 'string' ||
    typeof payload.issuedAt !== 'string' ||
    typeof payload.expiresAt !== 'string' ||
    typeof payload.nonce !== 'string'
  ) {
    fail('el token está incompleto');
  }
  const issuedMs = Date.parse(payload.issuedAt);
  const expiresMs = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) {
    fail('las fechas del token son inválidas');
  }
  if (expiresMs <= issuedMs) fail('el vencimiento debe ser posterior a la emisión');
  const durationDays = (expiresMs - issuedMs) / MS_PER_DAY;
  if (durationDays > maxDays() + 1 / 24) {
    fail(`la vigencia máxima permitida es ${maxDays()} días`);
  }
  if (issuedMs > Date.now() + CLOCK_SKEW_MS) {
    fail('el token fue emitido en el futuro; revise el reloj');
  }
  if (expiresMs <= Date.now()) fail('el token ya está vencido');
  if (
    !verify(
      null,
      Buffer.from(payloadPart),
      readPublicKey(),
      Buffer.from(signaturePart, 'base64url')
    )
  ) {
    fail('la firma del token no es válida');
  }
  return {
    payload,
    tokenId: createHash('sha256').update(String(token).trim()).digest('hex').slice(0, 16),
  };
}

function snapshot(row) {
  const nowMs = Date.now();
  const expiresMs = Date.parse(row.expires_at);
  const graceDays = Number(row.grace_days) || 0;
  const maxSeenMs = row.max_seen_at ? Date.parse(row.max_seen_at) : NaN;
  const tolerance =
    positiveInt(process.env['LICENSE_ROLLBACK_TOLERANCE_HOURS'], 24) * 3_600_000;
  const clockTampered =
    Number.isFinite(maxSeenMs) && nowMs < maxSeenMs - tolerance;
  const daysRemaining = Math.ceil((expiresMs - nowMs) / MS_PER_DAY);
  let mode = 'normal';
  if (row.status === 'suspendida') mode = 'solo_lectura';
  else if (clockTampered) mode = 'solo_lectura';
  else if (nowMs >= expiresMs + graceDays * MS_PER_DAY) mode = 'solo_lectura';
  else if (nowMs >= expiresMs) mode = 'gracia';
  else if (daysRemaining <= positiveInt(process.env['LICENSE_ALERT_DAYS'], 3)) {
    mode = 'aviso';
  }
  return {
    row,
    graceDays,
    clockTampered,
    daysRemaining,
    mode,
    readOnly: mode === 'solo_lectura',
  };
}

function printStatus(row) {
  const info = snapshot(row);
  console.log(`Licencia ${row.license_id}`);
  console.log(`  Estado:          ${row.status}`);
  console.log(`  Titular:         ${row.holder || '—'}`);
  console.log(`  Emitida:         ${formatDate(row.issued_at)}`);
  console.log(`  Vence:           ${formatDate(row.expires_at)}`);
  console.log(`  Días restantes:  ${info.daysRemaining}`);
  console.log(`  Vigencia máx.:   ${maxDays()} días`);
  console.log(`  Gracia:          ${info.graceDays} día(s)`);
  console.log(`  Modo:            ${info.mode}`);
  if (info.clockTampered) {
    console.log('  ADVERTENCIA:     el reloj del servidor retrocedió más de lo permitido');
  }
  console.log(`  Última revisión: ${row.last_seen_at ? formatDate(row.last_seen_at) : '—'}`);
}

// --- Commands ---------------------------------------------------------------
function commandIssue() {
  const days = positiveInt(arg('days', '30'), 30);
  if (days > maxDays()) {
    fail(`la vigencia máxima permitida es ${maxDays()} días (LICENSE_MAX_DAYS)`);
  }
  const graceDays = positiveInt(arg('grace-days', process.env['LICENSE_GRACE_DAYS']), defaultGraceDays());
  const issuedAt = new Date();
  const expiresAt = arg('expires-at')
    ? new Date(arg('expires-at'))
    : new Date(issuedAt.getTime() + days * MS_PER_DAY);
  if (Number.isNaN(expiresAt.getTime())) fail('la fecha --expires-at no es válida');
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    fail('el vencimiento debe ser posterior a la emisión');
  }
  const actualDays = (expiresAt.getTime() - issuedAt.getTime()) / MS_PER_DAY;
  if (actualDays > maxDays() + 1 / 24) {
    fail(`la vigencia máxima permitida es ${maxDays()} días (LICENSE_MAX_DAYS)`);
  }

  const payload = {
    v: 1,
    licenseId: arg('license-id', process.env['LICENSE_ID'] || 'erp-mermelada'),
    status: arg('status', 'activa'),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    graceDays,
    holder: arg('holder', process.env['LICENSE_HOLDER'] || 'Mermelada ERP'),
    nonce: randomBytes(8).toString('hex'),
  };
  if (payload.status !== 'activa' && payload.status !== 'prueba') {
    fail('--status debe ser activa o prueba');
  }

  const token = signToken(payload);
  const outFile = arg('out');
  if (outFile) {
    writeFileSync(resolve(outFile), `${token}\n`, { mode: 0o600 });
  }

  console.log('Licencia emitida');
  console.log(`  Titular:   ${payload.holder}`);
  console.log(`  Licencia:  ${payload.licenseId}`);
  console.log(`  Emitida:   ${formatDate(payload.issuedAt)}`);
  console.log(`  Vence:     ${formatDate(payload.expiresAt)}`);
  console.log(`  Vigencia:  ${Math.round(actualDays)} días`);
  console.log(`  Gracia:    ${graceDays} día(s)`);
  console.log(`  Token:     ${token}`);
  if (outFile) console.log(`  Guardado:  ${resolve(outFile)}`);
  console.log('');
  console.log('Aplíquelo en el servidor con:');
  console.log(`  ssh mermelada-erp 'cd /ruta/app && node scripts/license.mjs apply "${token.slice(0, 24)}..."'`);
}

function commandApply(token) {
  const value = token || arg('token') || positional(0);
  if (!value) fail('indique el token: node scripts/license.mjs apply "mrm1..."');
  const { payload, tokenId } = verifyToken(value);
  const nowIso = new Date().toISOString();
  const current = ensureLicense();
  const maxSeen =
    current.max_seen_at && Date.parse(current.max_seen_at) > Date.now()
      ? current.max_seen_at
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
    arg('actor', process.env['USER'] || 'cli'),
    nowIso
  );
  insertEvent({
    licenseId: payload.licenseId,
    action: 'aplicada',
    status: payload.status,
    expiresAt: payload.expiresAt,
    graceDays: payload.graceDays,
    actor: arg('actor', process.env['USER'] || 'cli'),
    source: 'cli',
    tokenId,
    detail: `Vigencia hasta ${payload.expiresAt}`,
  });
  console.log('Licencia aplicada correctamente');
  printStatus(db.prepare('SELECT * FROM system_license WHERE id = 1').get());
}

function commandStatus() {
  printStatus(ensureLicense());
}

function commandSuspend() {
  const current = ensureLicense();
  const now = new Date().toISOString();
  const reason = arg('reason', '');
  db.prepare(
    `UPDATE system_license SET status = 'suspendida', updated_by = ?, updated_at = ? WHERE id = 1`
  ).run(arg('actor', process.env['USER'] || 'cli'), now);
  insertEvent({
    licenseId: current.license_id,
    action: 'suspendida',
    status: 'suspendida',
    expiresAt: current.expires_at,
    graceDays: current.grace_days,
    actor: arg('actor', process.env['USER'] || 'cli'),
    source: 'cli',
    detail: reason || undefined,
  });
  console.log('Licencia suspendida. El sistema quedó en solo lectura hasta aplicar un token.');
  printStatus(db.prepare('SELECT * FROM system_license WHERE id = 1').get());
}

function commandEvents() {
  const limit = Math.min(100, positiveInt(arg('limit', '20'), 20));
  const rows = db
    .prepare('SELECT * FROM license_events ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(limit);
  if (rows.length === 0) {
    console.log('No hay eventos de licencia.');
    return;
  }
  for (const row of rows) {
    console.log(`${formatDate(row.created_at)}  ${row.action.padEnd(10)} ${row.status || ''}`);
    console.log(`  source=${row.source} actor=${row.actor || '—'} token=${row.token_id || '—'}`);
    if (row.detail) console.log(`  ${row.detail}`);
  }
}

async function commandAlerts() {
  const limit = Math.min(100, positiveInt(arg('limit', '20'), 20));
  const rows = db
    .prepare('SELECT * FROM license_alerts ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(limit);

  if (hasFlag('test')) {
    await sendTestEmail();
    return;
  }

  if (rows.length === 0) {
    console.log('No hay alertas de licencia registradas.');
    return;
  }
  for (const row of rows) {
    console.log(
      `${row.alert_date}  días=${row.days_remaining}  ${row.status}  ${row.recipients || '—'}`
    );
    if (row.error) console.log(`  error: ${row.error}`);
  }
}

function commandVerify() {
  const token = arg('token') || positional(0);
  if (!token) fail('indique el token a verificar');
  const { payload, tokenId } = verifyToken(token);
  console.log('Token válido');
  console.log(`  Licencia: ${payload.licenseId}`);
  console.log(`  Titular:  ${payload.holder || '—'}`);
  console.log(`  Vence:    ${formatDate(payload.expiresAt)}`);
  console.log(`  Gracia:   ${payload.graceDays} día(s)`);
  console.log(`  Token ID: ${tokenId}`);
}

async function sendTestEmail() {
  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    fail('nodemailer no está instalado; ejecute el script desde el proyecto con node_modules');
  }
  const host = process.env['SMTP_HOST'];
  const from = process.env['SMTP_FROM'] || process.env['SMTP_FROM_EMAIL'];
  if (!host || !from) fail('SMTP_HOST y SMTP_FROM son obligatorios para enviar el correo de prueba');
  const recipients = db
    .prepare('SELECT email FROM notification_recipients WHERE active = 1')
    .all()
    .map((row) => row.email);
  if (recipients.length === 0) fail('no hay destinatarios activos en notification_recipients');

  const row = ensureLicense();
  const licenseInfo = snapshot(row);
  const port = Number(process.env['SMTP_PORT'] || 587);
  const secure = process.env['SMTP_SECURE']
    ? process.env['SMTP_SECURE'] === 'true'
    : port === 465;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth:
      process.env['SMTP_USER'] && process.env['SMTP_PASSWORD']
        ? { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASSWORD'] }
        : undefined,
  });

  const result = await transporter.sendMail({
    from,
    to: recipients.join(', '),
    bcc: process.env['SMTP_BCC'] || undefined,
    subject: `[PRUEBA] [Mermelada ERP] Licencia ${row.license_id} vence en ${licenseInfo.daysRemaining} días`,
    text: [
      'Mermelada ERP - Correo de prueba de alertas de licencia',
      '',
      `Licencia: ${row.license_id}`,
      `Estado:   ${row.status}`,
      `Vence:    ${formatDate(row.expires_at)}`,
      `Días:     ${licenseInfo.daysRemaining}`,
      `Gracia:   ${licenseInfo.graceDays} día(s)`,
      '',
      'Este es un correo de prueba; no consume el aviso diario.',
    ].join('\n'),
  });
  const accepted = Array.isArray(result?.accepted)
    ? result.accepted.length
    : 1;
  console.log(`Correo de prueba enviado a ${recipients.join(', ')} (aceptados: ${accepted}).`);
}

function printHelp() {
  console.log(`Uso: node scripts/license.mjs <comando> [opciones]

Comandos:
  issue      Emite un token firmado (máx. ${maxDays()} días)
  apply      Aplica un token firmado
  verify     Verifica un token sin aplicarlo
  status     Muestra el estado actual de la licencia
  suspend    Suspende la licencia (solo lectura)
  events     Lista el historial de eventos
  alerts     Lista las alertas diarias (--test envía un correo de prueba)

Opciones de issue:
  --days 30           Días de vigencia (por defecto 30)
  --expires-at FECHA  Fecha exacta de vencimiento
  --grace-days 7      Días de gracia
  --holder TEXTO      Titular
  --license-id ID     Identificador de la licencia
  --status activa     activa | prueba
  --private-key RUTA  Clave privada Ed25519
  --out RUTA          Guarda el token en un archivo

Variables:
  DB_PATH                     Base de datos SQLite
  LICENSE_PRIVATE_KEY_PATH    Clave privada (solo al emitir)
  LICENSE_PUBLIC_KEY_PATH     Clave pública (aplicar/verificar)
  LICENSE_MAX_DAYS            Vigencia máxima (30)
  LICENSE_GRACE_DAYS          Días de gracia por defecto
  SMTP_*                      Configuración de correo para --test`);
}

try {
  switch (command) {
    case 'issue':
      commandIssue();
      break;
    case 'apply':
      commandApply();
      break;
    case 'verify':
      commandVerify();
      break;
    case 'status':
      commandStatus();
      break;
    case 'suspend':
      commandSuspend();
      break;
    case 'events':
      commandEvents();
      break;
    case 'alerts':
      await commandAlerts();
      break;
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      printHelp();
      fail(`comando desconocido: ${command}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  db.close();
}
