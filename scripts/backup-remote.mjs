#!/usr/bin/env node
/**
 * Optional off-site copy of the SQLite backups.
 *
 * Two mutually exclusive destinations are supported and selected with
 * BACKUP_REMOTE:
 *
 *   none    Local backups only (default).
 *   s3      Any S3-compatible storage: AWS S3, MinIO, Cloudflare R2,
 *           Backblaze B2 (S3 API), Wasabi, etc.
 *   gdrive  Google Drive folder shared with a service account.
 *
 * The module is imported by scripts/backup-db.mjs after the local copy is
 * created. Upload errors must never remove the local backup, so callers are
 * expected to catch them and keep going.
 */
import { createSign } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const S3_MODES = ['none', 's3', 'gdrive'];
const DEFAULT_S3_PREFIX = 'mermelada/backups';
const DEFAULT_RETENTION_DAYS = 15;
const BACKUP_FILE = /^mermelada-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db$/;
const BACKUP_TIMESTAMP =
  /^mermelada-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/;
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_DRIVE_UPLOAD =
  'https://www.googleapis.com/upload/drive/v3/files';
const DAY_MS = 24 * 60 * 60 * 1000;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function required(env, name) {
  const value = clean(env[name]);
  if (!value) {
    throw new Error(`Falta ${name} (necesaria para BACKUP_REMOTE=${env.BACKUP_REMOTE})`);
  }
  return value;
}

function isTrue(value) {
  return ['1', 'true', 'yes', 'on'].includes(clean(value).toLowerCase());
}

function normalizePrefix(value) {
  return clean(value).replace(/^\/+|\/+$/g, '');
}

/**
 * Parse and validate the remote backup configuration.
 * Only the selected destination is validated, so switching BACKUP_REMOTE does
 * not require cleaning the variables of the other provider.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function readRemoteConfig(env = process.env) {
  const mode = (clean(env.BACKUP_REMOTE) || 'none').toLowerCase();
  if (!S3_MODES.includes(mode)) {
    throw new Error(
      `BACKUP_REMOTE inválido: "${env.BACKUP_REMOTE}". Usa none, s3 o gdrive.`
    );
  }

  if (mode === 'none') {
    return { mode, retentionDays: 0, s3: null, gdrive: null };
  }

  const rawRetention =
    env.BACKUP_REMOTE_RETENTION_DAYS ??
    env.BACKUP_RETENTION_DAYS ??
    String(DEFAULT_RETENTION_DAYS);
  const retentionDays = Number(rawRetention);
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    throw new Error(
      `BACKUP_REMOTE_RETENTION_DAYS inválido: "${rawRetention}" (usa 0 para desactivar)`
    );
  }

  const config = {
    mode,
    retentionDays,
    s3: mode === 's3' ? readS3Config(env) : null,
    gdrive: mode === 'gdrive' ? readGdriveConfig(env) : null,
  };
  return config;
}

function readS3Config(env) {
  const accessKeyId = clean(env.BACKUP_S3_ACCESS_KEY_ID);
  const secretAccessKey = clean(env.BACKUP_S3_SECRET_ACCESS_KEY);
  if (accessKeyId && !secretAccessKey) {
    throw new Error('Falta BACKUP_S3_SECRET_ACCESS_KEY');
  }
  if (!accessKeyId && secretAccessKey) {
    throw new Error('Falta BACKUP_S3_ACCESS_KEY_ID');
  }

  return {
    bucket: required(env, 'BACKUP_S3_BUCKET'),
    region: clean(env.BACKUP_S3_REGION) || 'us-east-1',
    prefix: normalizePrefix(env.BACKUP_S3_PREFIX ?? DEFAULT_S3_PREFIX),
    accessKeyId,
    secretAccessKey,
    sessionToken: clean(env.BACKUP_S3_SESSION_TOKEN),
    endpoint: clean(env.BACKUP_S3_ENDPOINT),
    forcePathStyle: isTrue(env.BACKUP_S3_FORCE_PATH_STYLE),
  };
}

function readGdriveConfig(env) {
  const folderId = required(env, 'BACKUP_GDRIVE_FOLDER_ID');
  if (!/^[A-Za-z0-9_-]+$/.test(folderId)) {
    throw new Error(
      'BACKUP_GDRIVE_FOLDER_ID no es válido: copia solo el identificador de la carpeta'
    );
  }

  let clientEmail = clean(env.BACKUP_GDRIVE_CLIENT_EMAIL);
  // Dotenv stores multi-line values on one line; accept the escaped form too.
  let privateKey = clean(env.BACKUP_GDRIVE_PRIVATE_KEY).replace(/\\n/g, '\n');

  const accountFile = clean(env.BACKUP_GDRIVE_SERVICE_ACCOUNT_FILE);
  if (accountFile) {
    const fullPath = resolve(accountFile);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
    } catch (error) {
      throw new Error(
        `No se pudo leer BACKUP_GDRIVE_SERVICE_ACCOUNT_FILE (${fullPath}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    clientEmail = clean(parsed.client_email);
    privateKey = String(parsed.private_key ?? '').trim();
  }

  if (!clientEmail || !privateKey) {
    throw new Error(
      'Google Drive requiere BACKUP_GDRIVE_SERVICE_ACCOUNT_FILE o ' +
        'BACKUP_GDRIVE_CLIENT_EMAIL + BACKUP_GDRIVE_PRIVATE_KEY'
    );
  }
  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error(
      'BACKUP_GDRIVE_PRIVATE_KEY no parece una clave PEM de service account'
    );
  }

  return { folderId, clientEmail, privateKey };
}

/**
 * Convert a backup filename into its UTC timestamp, or null when the name does
 * not match the generated pattern. Only files created by this project are
 * candidates for remote pruning.
 *
 * @param {string} name
 * @returns {Date | null}
 */
export function parseBackupDate(name) {
  const match = BACKUP_TIMESTAMP.exec(basename(name));
  if (!match) return null;
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond)
    )
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @param {{ name: string, [key: string]: unknown }[]} files
 * @param {number} retentionDays
 * @param {number} [now]
 */
export function selectExpired(files, retentionDays, now = Date.now()) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return [];
  const cutoff = now - retentionDays * DAY_MS;
  return files.filter((file) => {
    const timestamp = parseBackupDate(file.name);
    return timestamp !== null && timestamp.getTime() < cutoff;
  });
}

/**
 * @param {string} name
 * @param {string} prefix
 */
export function buildS3Key(name, prefix) {
  const normalized = normalizePrefix(prefix);
  return normalized ? `${normalized}/${basename(name)}` : basename(name);
}

function assertBackupName(filePath) {
  const name = basename(filePath);
  if (!BACKUP_FILE.test(name)) {
    throw new Error(
      `Nombre de backup no reconocido: "${name}" (se espera mermelada-<ISO>.db)`
    );
  }
  return name;
}

async function loadS3Module() {
  try {
    return await import('@aws-sdk/client-s3');
  } catch {
    throw new Error(
      'No se encontró @aws-sdk/client-s3. Ejecuta "npm install" antes de usar BACKUP_REMOTE=s3.'
    );
  }
}

function createS3Client(S3Client, config) {
  /** @type {Record<string, unknown>} */
  const options = { region: config.region };
  if (config.endpoint) options['endpoint'] = config.endpoint;
  if (config.forcePathStyle) options['forcePathStyle'] = true;
  if (config.accessKeyId) {
    options['credentials'] = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    };
  }
  return new S3Client(options);
}

async function uploadToS3(filePath, name, config, module) {
  const client = createS3Client(module.S3Client, config);
  const key = buildS3Key(name, config.prefix);
  await client.send(
    new module.PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: readFileSync(filePath),
      ContentType: 'application/octet-stream',
    })
  );
  return { location: `s3://${config.bucket}/${key}`, key, name };
}

async function pruneS3(config, module, retentionDays) {
  const client = createS3Client(module.S3Client, config);
  const prefix = normalizePrefix(config.prefix);
  const keyPrefix = prefix ? `${prefix}/` : '';
  const files = [];
  let continuationToken;

  do {
    const page = await client.send(
      new module.ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: keyPrefix,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      })
    );
    for (const object of page.Contents ?? []) {
      if (!object.Key) continue;
      files.push({ name: basename(object.Key), key: object.Key });
    }
    continuationToken =
      page.IsTruncated && page.NextContinuationToken
        ? page.NextContinuationToken
        : undefined;
  } while (continuationToken);

  const expired = selectExpired(files, retentionDays);
  for (const file of expired) {
    await client.send(
      new module.DeleteObjectCommand({
        Bucket: config.bucket,
        Key: file.key,
      })
    );
  }
  return expired.length;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function buildJwtAssertion(config, nowSeconds) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: GOOGLE_DRIVE_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    })
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  signer.end();
  const signature = signer.sign(config.privateKey).toString('base64url');
  return `${header}.${claims}.${signature}`;
}

async function responseDetail(response) {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '';
  }
}

async function driveRequest(fetchImpl, url, init, label) {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(
      `${label} falló (HTTP ${response.status}): ${await responseDetail(response)}`
    );
  }
  return response;
}

async function getDriveToken(config, fetchImpl, nowSeconds) {
  const response = await driveRequest(
    fetchImpl,
    GOOGLE_TOKEN_URL,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: buildJwtAssertion(config, nowSeconds),
      }).toString(),
    },
    'Google OAuth'
  );
  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error('Google OAuth no devolvió access_token');
  }
  return payload.access_token;
}

async function uploadToGdrive(filePath, name, config, fetchImpl, nowSeconds) {
  const token = await getDriveToken(config, fetchImpl, nowSeconds);
  const boundary = `mermelada-${nowSeconds.toString(16)}-${Math.random()
    .toString(16)
    .slice(2)}`;
  const metadata = JSON.stringify({
    name,
    parents: [config.folderId],
  });
  const head = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, readFileSync(filePath), tail]);

  const response = await driveRequest(
    fetchImpl,
    `${GOOGLE_DRIVE_UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id,name`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
    'Google Drive upload'
  );
  const payload = await response.json();
  if (!payload.id) {
    throw new Error('Google Drive no devolvió el id del archivo subido');
  }
  return {
    location: `gdrive://${config.folderId}/${payload.id}`,
    id: payload.id,
    name,
  };
}

async function listGdriveFiles(config, token, fetchImpl) {
  const files = [];
  let pageToken;

  do {
    const params = new URLSearchParams({
      q: `'${config.folderId}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,modifiedTime)',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const response = await driveRequest(
      fetchImpl,
      `${GOOGLE_DRIVE_API}?${params.toString()}`,
      { headers: { authorization: `Bearer ${token}` } },
      'Google Drive list'
    );
    const payload = await response.json();
    files.push(...(payload.files ?? []));
    pageToken = payload.nextPageToken;
  } while (pageToken);

  return files;
}

async function pruneGdrive(config, fetchImpl, nowSeconds, retentionDays) {
  const token = await getDriveToken(config, fetchImpl, nowSeconds);
  const files = await listGdriveFiles(config, token, fetchImpl);
  const expired = selectExpired(files, retentionDays);

  for (const file of expired) {
    await driveRequest(
      fetchImpl,
      `${GOOGLE_DRIVE_API}/${encodeURIComponent(file.id)}?supportsAllDrives=true`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      },
      'Google Drive delete'
    );
  }
  return expired.length;
}

/**
 * Upload one local backup to the configured destination.
 *
 * @param {string} filePath
 * @param {ReturnType<typeof readRemoteConfig>} config
 * @param {{ s3?: any, fetch?: typeof fetch, now?: number }} [deps]
 */
export async function uploadBackup(filePath, config, deps = {}) {
  if (config.mode === 'none') return null;
  const name = assertBackupName(filePath);
  const nowSeconds = Math.floor((deps.now ?? Date.now()) / 1000);

  if (config.mode === 's3') {
    const module = deps.s3 ?? (await loadS3Module());
    return uploadToS3(filePath, name, config.s3, module);
  }

  if (config.mode === 'gdrive') {
    const fetchImpl = deps.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('Este Node no tiene fetch global; usa Node 20.19 o superior');
    }
    return uploadToGdrive(filePath, name, config.gdrive, fetchImpl, nowSeconds);
  }

  throw new Error(`Destino remoto no soportado: ${config.mode}`);
}

/**
 * Delete remote copies older than BACKUP_REMOTE_RETENTION_DAYS.
 * Only files matching the local backup pattern are considered.
 *
 * @param {ReturnType<typeof readRemoteConfig>} config
 * @param {{ s3?: any, fetch?: typeof fetch, now?: number }} [deps]
 */
export async function pruneRemoteBackups(config, deps = {}) {
  if (config.mode === 'none' || !(config.retentionDays > 0)) return 0;
  const nowSeconds = Math.floor((deps.now ?? Date.now()) / 1000);

  if (config.mode === 's3') {
    const module = deps.s3 ?? (await loadS3Module());
    return pruneS3(config.s3, module, config.retentionDays);
  }

  if (config.mode === 'gdrive') {
    const fetchImpl = deps.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('Este Node no tiene fetch global; usa Node 20.19 o superior');
    }
    return pruneGdrive(
      config.gdrive,
      fetchImpl,
      nowSeconds,
      config.retentionDays
    );
  }

  throw new Error(`Destino remoto no soportado: ${config.mode}`);
}

function findLatestBackup() {
  const directory = resolve(process.env.BACKUP_DIR || join(process.cwd(), 'backups'));
  const candidates = readdirSync(directory)
    .filter((entry) => BACKUP_FILE.test(entry))
    .map((entry) => join(directory, entry))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  if (candidates.length === 0) {
    throw new Error(`No hay backups mermelada-*.db en ${directory}`);
  }
  return candidates[0];
}

async function main() {
  const config = readRemoteConfig();
  if (config.mode === 'none') {
    throw new Error('BACKUP_REMOTE=none: elige s3 o gdrive para subir una copia');
  }

  const filePath = process.argv[2] ? resolve(process.argv[2]) : findLatestBackup();
  const uploaded = await uploadBackup(filePath, config);
  console.log(`[backup:remote] Uploaded ${basename(filePath)} to ${uploaded.location}`);

  const pruned = await pruneRemoteBackups(config);
  if (pruned > 0) {
    console.log(
      `[backup:remote] Pruned ${pruned} remote backup(s) older than ${config.retentionDays} day(s).`
    );
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(
      `[backup:remote] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  });
}
