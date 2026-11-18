import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, setDbPath } from './database/persistence.js';
import {
  LicenseError,
  applyLicenseToken,
  computeLicenseSnapshot,
  decodeLicenseToken,
  defaultGraceDays,
  ensureSystemLicense,
  getLicenseRecord,
  getLicenseSnapshot,
  isLicenseEnabled,
  licenseAlertDays,
  listLicenseAlerts,
  listLicenseEvents,
  maxLicenseDays,
  reserveLicenseAlert,
  resetLicenseTouchCache,
  suspendLicense,
  touchLicense,
  updateLicenseAlert,
  type LicenseRecord,
} from './license.js';

/**
 * Tests for the Ed25519-signed global license.
 *
 * Every test uses a throw-away SQLite file and an in-memory key pair; no real
 * license key or production database is touched.
 */

const MS_PER_DAY = 86_400_000;
const workDir = mkdtempSync(join(tmpdir(), 'mermelada-license-'));
const dbPath = join(workDir, 'license.db');

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const privateKeyPem = String(privateKey);
const publicKeyPem = String(publicKey);

beforeAll(() => {
  setDbPath(dbPath);
});

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM system_license').run();
  db.prepare('DELETE FROM license_events').run();
  db.prepare('DELETE FROM license_alerts').run();
  resetLicenseTouchCache();
  vi.stubEnv('LICENSE_PUBLIC_KEY', publicKeyPem);
  vi.stubEnv('LICENSE_ENABLED', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface LicenseRowInput {
  licenseId?: string;
  status?: string;
  holder?: string | null;
  issuedAt?: string;
  expiresAt?: string;
  graceDays?: number;
  tokenId?: string | null;
  lastSeenAt?: string | null;
  maxSeenAt?: string | null;
  updatedBy?: string | null;
  updatedAt?: string;
}

function insertLicense(input: LicenseRowInput = {}): void {
  const now = new Date();
  const db = getDb();
  db.prepare('DELETE FROM system_license').run();
  db.prepare(
    `INSERT INTO system_license
       (id, license_id, status, holder, issued_at, expires_at, grace_days,
        token_id, last_seen_at, max_seen_at, updated_by, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.licenseId ?? 'erp-test',
    input.status ?? 'activa',
    input.holder === undefined ? 'ACME' : input.holder,
    input.issuedAt ?? new Date(now.getTime() - MS_PER_DAY).toISOString(),
    input.expiresAt ?? new Date(now.getTime() + 10 * MS_PER_DAY).toISOString(),
    input.graceDays ?? 7,
    input.tokenId === undefined ? null : input.tokenId,
    input.lastSeenAt === undefined ? null : input.lastSeenAt,
    input.maxSeenAt === undefined ? null : input.maxSeenAt,
    input.updatedBy === undefined ? null : input.updatedBy,
    input.updatedAt ?? now.toISOString()
  );
}

function baseRecord(overrides: Partial<LicenseRecord> = {}): LicenseRecord {
  const now = new Date();
  return {
    licenseId: 'erp-test',
    status: 'activa',
    holder: 'ACME',
    issuedAt: new Date(now.getTime() - MS_PER_DAY).toISOString(),
    expiresAt: new Date(now.getTime() + 10 * MS_PER_DAY).toISOString(),
    graceDays: 7,
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

interface TokenOptions {
  payload?: Record<string, unknown>;
  rawPayload?: string;
  signature?: Buffer;
  prefix?: string;
}

function buildToken(options: TokenOptions = {}): string {
  const now = Date.now();
  const payload = {
    v: 1,
    licenseId: 'erp-test',
    status: 'activa',
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 10 * MS_PER_DAY).toISOString(),
    graceDays: 7,
    holder: 'ACME',
    nonce: 'nonce-1',
    ...options.payload,
  };
  const payloadPart =
    options.rawPayload ??
    Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature =
    options.signature ??
    sign(null, Buffer.from(payloadPart), privateKeyPem);
  return `${options.prefix ?? 'mrm1'}.${payloadPart}.${signature.toString('base64url')}`;
}

function errorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(LicenseError);
    return (error as LicenseError).code;
  }
  throw new Error('Se esperaba un LicenseError');
}

function readLicenseRow(): Record<string, unknown> {
  return getDb()
    .prepare('SELECT * FROM system_license WHERE id = 1')
    .get() as Record<string, unknown>;
}

describe('environment helpers', () => {
  it('reads the enable flag only from an explicit true', () => {
    expect(isLicenseEnabled()).toBe(false);
    vi.stubEnv('LICENSE_ENABLED', '1');
    expect(isLicenseEnabled()).toBe(false);
    vi.stubEnv('LICENSE_ENABLED', 'true');
    expect(isLicenseEnabled()).toBe(true);
  });

  it('applies defaults and rejects invalid numeric settings', () => {
    expect(maxLicenseDays()).toBe(30);
    expect(defaultGraceDays()).toBe(7);
    expect(licenseAlertDays()).toBe(3);

    vi.stubEnv('LICENSE_MAX_DAYS', '45');
    vi.stubEnv('LICENSE_GRACE_DAYS', '2');
    vi.stubEnv('LICENSE_ALERT_DAYS', '5');
    expect(maxLicenseDays()).toBe(45);
    expect(defaultGraceDays()).toBe(2);
    expect(licenseAlertDays()).toBe(5);

    vi.stubEnv('LICENSE_MAX_DAYS', 'not-a-number');
    vi.stubEnv('LICENSE_GRACE_DAYS', '-3');
    vi.stubEnv('LICENSE_ALERT_DAYS', '0');
    expect(maxLicenseDays()).toBe(30);
    expect(defaultGraceDays()).toBe(7);
    expect(licenseAlertDays()).toBe(3);
  });
});

describe('ensureSystemLicense', () => {
  it('creates a trial license with normalised env labels', () => {
    vi.stubEnv('LICENSE_INITIAL_DAYS', '5');
    vi.stubEnv('LICENSE_ID', '"cliente-01"');
    vi.stubEnv('LICENSE_HOLDER', "'Mermeladas del Sur'");
    const now = new Date('2026-01-10T12:00:00.000Z');

    const record = ensureSystemLicense(now);

    expect(record.licenseId).toBe('cliente-01');
    expect(record.holder).toBe('Mermeladas del Sur');
    expect(record.status).toBe('prueba');
    expect(record.issuedAt).toBe(now.toISOString());
    expect(Date.parse(record.expiresAt) - now.getTime()).toBe(5 * MS_PER_DAY);
    expect(record.graceDays).toBe(7);

    const events = listLicenseEvents();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('creada');
    expect(events[0].detail).toContain('5 días');
  });

  it('uses default labels and falls back on invalid initial days', () => {
    vi.stubEnv('LICENSE_INITIAL_DAYS', 'invalid');
    const now = new Date('2026-01-10T12:00:00.000Z');

    const record = ensureSystemLicense(now);
    expect(record.licenseId).toBe('erp-mermelada');
    expect(record.holder).toBe('Mermelada ERP');
    expect(Date.parse(record.expiresAt) - now.getTime()).toBe(30 * MS_PER_DAY);
  });

  it('returns the existing row without creating another event', () => {
    insertLicense({ licenseId: 'existing', status: 'activa' });
    const record = ensureSystemLicense(new Date('2026-02-01T00:00:00.000Z'));
    expect(record.licenseId).toBe('existing');
    expect(listLicenseEvents()).toHaveLength(0);
  });
});

describe('getLicenseRecord', () => {
  it('maps nullable columns to undefined', () => {
    insertLicense({
      holder: null,
      tokenId: null,
      lastSeenAt: null,
      maxSeenAt: null,
      updatedBy: null,
    });

    const record = getLicenseRecord();
    expect(record.holder).toBeUndefined();
    expect(record.tokenId).toBeUndefined();
    expect(record.lastSeenAt).toBeUndefined();
    expect(record.maxSeenAt).toBeUndefined();
    expect(record.updatedBy).toBeUndefined();
  });

  it('falls back to prueba for unknown stored statuses', () => {
    insertLicense({ status: 'desconocido' });
    expect(getLicenseRecord().status).toBe('prueba');
  });
});

describe('computeLicenseSnapshot', () => {
  const now = new Date('2026-11-17T15:00:00.000Z');

  it('reports a normal license with plenty of days left', () => {
    const record = baseRecord({
      expiresAt: new Date(now.getTime() + 10 * MS_PER_DAY).toISOString(),
    });
    const snapshot = computeLicenseSnapshot(record, now);
    expect(snapshot.mode).toBe('normal');
    expect(snapshot.daysRemaining).toBe(10);
    expect(snapshot.readOnly).toBe(false);
    expect(snapshot.clockTampered).toBe(false);
    expect(snapshot.enabled).toBe(false);
  });

  it('enters aviso inside the alert window', () => {
    const record = baseRecord({
      expiresAt: new Date(now.getTime() + 2 * MS_PER_DAY).toISOString(),
    });
    expect(computeLicenseSnapshot(record, now).mode).toBe('aviso');
  });

  it('enters gracia after expiry but before the grace period ends', () => {
    const record = baseRecord({
      expiresAt: new Date(now.getTime() - MS_PER_DAY).toISOString(),
      graceDays: 7,
    });
    const snapshot = computeLicenseSnapshot(record, now);
    expect(snapshot.mode).toBe('gracia');
    expect(snapshot.daysRemaining).toBe(-1);
    expect(snapshot.readOnly).toBe(false);
  });

  it('becomes read-only once expiry plus grace has passed', () => {
    vi.stubEnv('LICENSE_ENABLED', 'true');
    const record = baseRecord({
      expiresAt: new Date(now.getTime() - 10 * MS_PER_DAY).toISOString(),
      graceDays: 7,
    });
    const snapshot = computeLicenseSnapshot(record, now);
    expect(snapshot.mode).toBe('solo_lectura');
    expect(snapshot.readOnly).toBe(true);
  });

  it('is read-only when the license is suspended', () => {
    const snapshot = computeLicenseSnapshot(
      baseRecord({ status: 'suspendida' }),
      now
    );
    expect(snapshot.mode).toBe('solo_lectura');
  });

  it('detects a rolled-back clock beyond the tolerance', () => {
    const record = baseRecord({
      maxSeenAt: new Date(now.getTime() + 48 * 3_600_000).toISOString(),
    });
    const snapshot = computeLicenseSnapshot(record, now);
    expect(snapshot.clockTampered).toBe(true);
    expect(snapshot.mode).toBe('solo_lectura');
  });

  it('accepts a rolled-back clock within a wider tolerance', () => {
    vi.stubEnv('LICENSE_ROLLBACK_TOLERANCE_HOURS', '72');
    const record = baseRecord({
      maxSeenAt: new Date(now.getTime() + 48 * 3_600_000).toISOString(),
    });
    const snapshot = computeLicenseSnapshot(record, now);
    expect(snapshot.clockTampered).toBe(false);
    expect(snapshot.mode).toBe('normal');
  });

  it('treats an unparsable expiry as zero days remaining', () => {
    const snapshot = computeLicenseSnapshot(
      baseRecord({ expiresAt: 'not-a-date' }),
      now
    );
    expect(snapshot.daysRemaining).toBe(0);
    expect(snapshot.mode).toBe('aviso');
  });

  it('exposes the configured limits', () => {
    vi.stubEnv('LICENSE_MAX_DAYS', '60');
    vi.stubEnv('LICENSE_ALERT_DAYS', '8');
    const snapshot = computeLicenseSnapshot(baseRecord(), now);
    expect(snapshot.maxDays).toBe(60);
    expect(snapshot.alertDays).toBe(8);
  });
});

describe('getLicenseSnapshot', () => {
  it('reads the stored license and uses the injected clock', () => {
    const now = new Date('2026-11-17T15:00:00.000Z');
    insertLicense({
      expiresAt: new Date(now.getTime() + 2 * MS_PER_DAY).toISOString(),
    });
    const snapshot = getLicenseSnapshot(now);
    expect(snapshot.mode).toBe('aviso');
    expect(snapshot.daysRemaining).toBe(2);
  });
});

describe('touchLicense', () => {
  it('stores the observed clock and throttles later calls', () => {
    insertLicense();
    const first = new Date('2026-11-17T10:00:00.000Z');

    touchLicense(first);
    expect(readLicenseRow()['last_seen_at']).toBe(first.toISOString());
    expect(readLicenseRow()['max_seen_at']).toBe(first.toISOString());

    touchLicense(new Date(first.getTime() + 60_000));
    expect(readLicenseRow()['last_seen_at']).toBe(first.toISOString());
  });

  it('keeps a previously observed future clock', () => {
    const future = new Date('2026-11-20T00:00:00.000Z');
    insertLicense({ maxSeenAt: future.toISOString() });

    touchLicense(new Date('2026-11-17T10:00:00.000Z'));
    expect(readLicenseRow()['max_seen_at']).toBe(future.toISOString());
  });

  it('swallows database failures', () => {
    const blocker = join(workDir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    resetLicenseTouchCache();
    setDbPath(join(blocker, 'license.db'));

    expect(() => touchLicense(new Date())).not.toThrow();

    setDbPath(dbPath);
  });
});

describe('decodeLicenseToken', () => {
  it('decodes a valid token and derives a stable id', () => {
    const token = buildToken();
    const decoded = decodeLicenseToken(token);
    expect(decoded.payload.licenseId).toBe('erp-test');
    expect(decoded.tokenId).toHaveLength(16);
    expect(decodeLicenseToken(token).tokenId).toBe(decoded.tokenId);
  });

  it('rejects malformed envelopes', () => {
    expect(errorCode(() => decodeLicenseToken('mrm1.only-two'))).toBe(
      'LICENSE_TOKEN_FORMAT'
    );
    expect(errorCode(() => decodeLicenseToken(buildToken({ prefix: 'nope' })))).toBe(
      'LICENSE_TOKEN_FORMAT'
    );
  });

  it('rejects a payload that is not valid JSON', () => {
    expect(
      errorCode(() =>
        decodeLicenseToken(buildToken({ rawPayload: 'not-json' }))
      )
    ).toBe('LICENSE_TOKEN_INVALID');
  });

  it('rejects a payload that is not an object', () => {
    expect(
      errorCode(() => decodeLicenseToken(buildToken({ rawPayload: 'null' })))
    ).toBe('LICENSE_TOKEN_INVALID');
  });

  it('rejects unsupported versions', () => {
    expect(
      errorCode(() => decodeLicenseToken(buildToken({ payload: { v: 2 } })))
    ).toBe('LICENSE_TOKEN_VERSION');
  });

  it('rejects invalid statuses', () => {
    expect(
      errorCode(() =>
        decodeLicenseToken(buildToken({ payload: { status: 'suspendida' } }))
      )
    ).toBe('LICENSE_TOKEN_INVALID');
  });

  it('rejects incomplete payloads', () => {
    expect(
      errorCode(() =>
        decodeLicenseToken(buildToken({ payload: { nonce: '  ' } }))
      )
    ).toBe('LICENSE_TOKEN_INVALID');
    expect(
      errorCode(() =>
        decodeLicenseToken(buildToken({ payload: { licenseId: '   ' } }))
      )
    ).toBe('LICENSE_TOKEN_INVALID');
  });

  it('rejects invalid grace days', () => {
    for (const graceDays of ['7', -1, 366, 1.5]) {
      expect(
        errorCode(() =>
          decodeLicenseToken(buildToken({ payload: { graceDays } }))
        )
      ).toBe('LICENSE_TOKEN_INVALID');
    }
  });

  it('rejects invalid dates', () => {
    expect(
      errorCode(() =>
        decodeLicenseToken(buildToken({ payload: { issuedAt: 'nope' } }))
      )
    ).toBe('LICENSE_TOKEN_INVALID');
    const now = Date.now();
    expect(
      errorCode(() =>
        decodeLicenseToken(
          buildToken({
            payload: {
              issuedAt: new Date(now).toISOString(),
              expiresAt: new Date(now).toISOString(),
            },
          })
        )
      )
    ).toBe('LICENSE_TOKEN_INVALID');
  });

  it('rejects a validity longer than the maximum', () => {
    const now = Date.now();
    expect(
      errorCode(() =>
        decodeLicenseToken(
          buildToken({
            payload: {
              issuedAt: new Date(now - 3_600_000).toISOString(),
              expiresAt: new Date(now + 40 * MS_PER_DAY).toISOString(),
            },
          })
        )
      )
    ).toBe('LICENSE_TOKEN_TOO_LONG');
  });

  it('rejects a token issued in the future', () => {
    const now = Date.now();
    expect(
      errorCode(() =>
        decodeLicenseToken(
          buildToken({
            payload: {
              issuedAt: new Date(now + 3_600_000).toISOString(),
              expiresAt: new Date(now + 10 * MS_PER_DAY).toISOString(),
            },
          })
        )
      )
    ).toBe('LICENSE_TOKEN_FUTURE');
  });

  it('rejects an expired token', () => {
    const now = Date.now();
    expect(
      errorCode(() =>
        decodeLicenseToken(
          buildToken({
            payload: {
              issuedAt: new Date(now - 10 * MS_PER_DAY).toISOString(),
              expiresAt: new Date(now - 3_600_000).toISOString(),
            },
          })
        )
      )
    ).toBe('LICENSE_TOKEN_EXPIRED');
  });

  it('rejects a bad signature', () => {
    expect(
      errorCode(() =>
        decodeLicenseToken(buildToken({ signature: Buffer.alloc(64) }))
      )
    ).toBe('LICENSE_TOKEN_SIGNATURE');
  });
});

describe('public key loading', () => {
  it('accepts an inline base64 PEM', () => {
    vi.stubEnv(
      'LICENSE_PUBLIC_KEY',
      Buffer.from(publicKeyPem, 'utf8').toString('base64')
    );
    expect(decodeLicenseToken(buildToken()).payload.licenseId).toBe('erp-test');
  });

  it('accepts an inline PEM with escaped newlines', () => {
    vi.stubEnv('LICENSE_PUBLIC_KEY', publicKeyPem.replace(/\n/g, '\\n'));
    expect(decodeLicenseToken(buildToken()).payload.licenseId).toBe('erp-test');
  });

  it('reads the public key from a file', () => {
    const keyPath = join(workDir, 'public.pem');
    writeFileSync(keyPath, publicKeyPem);
    vi.stubEnv('LICENSE_PUBLIC_KEY', '');
    vi.stubEnv('LICENSE_PUBLIC_KEY_PATH', keyPath);
    expect(decodeLicenseToken(buildToken()).payload.licenseId).toBe('erp-test');
  });

  it('reports a missing key file', () => {
    vi.stubEnv('LICENSE_PUBLIC_KEY', '');
    vi.stubEnv('LICENSE_PUBLIC_KEY_PATH', join(workDir, 'missing.pem'));
    expect(errorCode(() => decodeLicenseToken(buildToken()))).toBe(
      'LICENSE_PUBLIC_KEY_MISSING'
    );
  });

  it('reports a missing configuration', () => {
    vi.stubEnv('LICENSE_PUBLIC_KEY', '');
    vi.stubEnv('LICENSE_PUBLIC_KEY_PATH', '');
    expect(errorCode(() => decodeLicenseToken(buildToken()))).toBe(
      'LICENSE_PUBLIC_KEY_MISSING'
    );
  });

  it('reports an invalid PEM', () => {
    vi.stubEnv(
      'LICENSE_PUBLIC_KEY',
      Buffer.from('definitely not a key').toString('base64')
    );
    expect(errorCode(() => decodeLicenseToken(buildToken()))).toBe(
      'LICENSE_PUBLIC_KEY_INVALID'
    );
  });
});

describe('applyLicenseToken', () => {
  it('persists the token payload, trims labels and records the event', () => {
    insertLicense({ licenseId: 'old', status: 'prueba' });
    const token = buildToken({
      payload: { licenseId: ' new-license ', holder: '  New Holder  ', status: 'activa' },
    });

    const result = applyLicenseToken(token, '  admin  ', 'cli');

    expect(result.snapshot.licenseId).toBe('new-license');
    expect(result.snapshot.holder).toBe('New Holder');
    const row = readLicenseRow();
    expect(row['license_id']).toBe('new-license');
    expect(row['holder']).toBe('New Holder');
    expect(row['updated_by']).toBe('admin');
    expect(row['token_id']).toBe(result.tokenId);

    const [event] = listLicenseEvents(1);
    expect(event.action).toBe('aplicada');
    expect(event.actor).toBe('  admin  ');
    expect(event.source).toBe('cli');
    expect(event.tokenId).toBe(result.tokenId);
  });

  it('stores nulls when holder and actor are absent', () => {
    insertLicense();
    const token = buildToken({ payload: { holder: undefined } });

    applyLicenseToken(token);

    const row = readLicenseRow();
    expect(row['holder']).toBeNull();
    expect(row['updated_by']).toBeNull();
  });

  it('preserves a previously observed future clock', () => {
    const future = new Date(Date.now() + 48 * 3_600_000).toISOString();
    insertLicense({ maxSeenAt: future });
    applyLicenseToken(buildToken());
    expect(readLicenseRow()['max_seen_at']).toBe(future);
  });
});

describe('suspendLicense', () => {
  it('suspends with a reason and actor', () => {
    insertLicense();
    const snapshot = suspendLicense('  impago  ', '  master  ', 'cli');
    expect(snapshot.status).toBe('suspendida');
    expect(snapshot.mode).toBe('solo_lectura');
    expect(readLicenseRow()['updated_by']).toBe('master');

    const [event] = listLicenseEvents(1);
    expect(event.action).toBe('suspendida');
    expect(event.detail).toBe('impago');
    expect(event.actor).toBe('  master  ');
    expect(event.source).toBe('cli');
  });

  it('suspends without a reason or actor', () => {
    insertLicense();
    const snapshot = suspendLicense(undefined);
    expect(snapshot.status).toBe('suspendida');
    expect(readLicenseRow()['updated_by']).toBeNull();
    expect(listLicenseEvents(1)[0].detail).toBeUndefined();
  });
});

describe('license events', () => {
  it('maps nullable event columns', () => {
    getDb()
      .prepare(
        `INSERT INTO license_events
           (id, license_id, action, status, expires_at, grace_days, actor,
            source, token_id, detail, created_at)
         VALUES (?, NULL, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?)`
      )
      .run('lev-manual', 'manual', 'sistema', '2026-01-01T00:00:00.000Z');

    const [event] = listLicenseEvents(1);
    expect(event.id).toBe('lev-manual');
    expect(event.licenseId).toBeUndefined();
    expect(event.status).toBeUndefined();
    expect(event.expiresAt).toBeUndefined();
    expect(event.graceDays).toBeUndefined();
    expect(event.actor).toBeUndefined();
    expect(event.tokenId).toBeUndefined();
    expect(event.detail).toBeUndefined();
  });

  it('clamps the requested limit', () => {
    expect(listLicenseEvents(0)).toHaveLength(0);
    expect(listLicenseEvents(Number.NaN)).toHaveLength(0);
    expect(listLicenseEvents(1000)).toHaveLength(0);
  });
});

describe('license alerts storage', () => {
  it('reserves once per license/day and maps the stored row', () => {
    const input = {
      licenseId: 'erp-test',
      alertDate: '2026-11-17',
      daysRemaining: 2,
      recipients: ['a@example.com', 'b@example.com'],
    };
    const id = reserveLicenseAlert(input);
    expect(id).toBeTruthy();
    expect(reserveLicenseAlert(input)).toBeNull();

    const [alert] = listLicenseAlerts(1);
    expect(alert.licenseId).toBe('erp-test');
    expect(alert.alertDate).toBe('2026-11-17');
    expect(alert.daysRemaining).toBe(2);
    expect(alert.recipients).toEqual(['a@example.com', 'b@example.com']);
    expect(alert.status).toBe('pendiente');
    expect(alert.error).toBeUndefined();
    expect(alert.sentAt).toBeUndefined();
  });

  it('records sent and failed outcomes', () => {
    const id = reserveLicenseAlert({
      licenseId: 'erp-test',
      alertDate: '2026-11-18',
      daysRemaining: 1,
      recipients: [],
    }) as string;

    updateLicenseAlert(id, 'enviado');
    let [alert] = listLicenseAlerts(1);
    expect(alert.status).toBe('enviado');
    expect(alert.sentAt).toBeTruthy();

    updateLicenseAlert(id, 'fallido', 'smtp caído');
    [alert] = listLicenseAlerts(1);
    expect(alert.status).toBe('fallido');
    expect(alert.error).toBe('smtp caído');
    expect(alert.sentAt).toBeUndefined();
  });

  it('clamps the requested limit', () => {
    expect(listLicenseAlerts(0)).toHaveLength(0);
    expect(listLicenseAlerts(Number.NaN)).toHaveLength(0);
    expect(listLicenseAlerts(1000)).toHaveLength(0);
  });
});
