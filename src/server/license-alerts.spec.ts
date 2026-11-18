import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, setDbPath } from './database/persistence.js';
import {
  listLicenseAlerts,
  resetLicenseTouchCache,
} from './license.js';
import {
  localDateKey,
  localHour,
  readLicenseAlertConfig,
  runLicenseAlertCheck,
  sendLicenseTestEmail,
  startLicenseAlertScheduler,
} from './license-alerts.js';
import {
  createNotificationRecipient,
  type MailMessage,
  type MailTransport,
} from './notifications.js';

/**
 * Tests for the daily license-expiry reminders and their in-process scheduler.
 *
 * SMTP is never contacted: a fake transport captures each message and can fail
 * or reject recipients on purpose.
 */

const MS_PER_DAY = 86_400_000;
const workDir = mkdtempSync(join(tmpdir(), 'mermelada-license-alerts-'));
const dbPath = join(workDir, 'license-alerts.db');

class FakeTransport implements MailTransport {
  messages: MailMessage[] = [];
  accepted: string[] | null = null;
  failures = 0;

  async sendMail(message: MailMessage): Promise<unknown> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('SMTP temporalmente no disponible');
    }
    this.messages.push(message);
    return {
      accepted: this.accepted ?? message.to.split(', '),
      rejected: [],
    };
  }
}

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
  db.prepare('DELETE FROM license_alerts').run();
  db.prepare('DELETE FROM license_events').run();
  db.prepare('DELETE FROM notification_recipients').run();
  db.prepare('DELETE FROM notification_log').run();
  resetLicenseTouchCache();
  vi.stubEnv('LICENSE_ENABLED', 'true');
  vi.stubEnv('SMTP_RETRY_DELAY_MS', '0');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function configureSmtp(): void {
  vi.stubEnv('SMTP_HOST', 'smtp.example.com');
  vi.stubEnv('SMTP_PORT', '587');
  vi.stubEnv('SMTP_FROM', 'erp@example.com');
}

function addRecipients(...emails: string[]): void {
  for (const email of emails) {
    createNotificationRecipient({ email });
  }
}

function setLicense(expiresAt: Date, overrides: Record<string, unknown> = {}): void {
  const now = new Date();
  getDb().prepare('DELETE FROM system_license').run();
  getDb()
    .prepare(
      `INSERT INTO system_license
         (id, license_id, status, holder, issued_at, expires_at, grace_days,
          token_id, last_seen_at, max_seen_at, updated_by, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`
    )
    .run(
      (overrides['licenseId'] as string) ?? 'erp-test',
      (overrides['status'] as string) ?? 'activa',
      'holder' in overrides ? (overrides['holder'] as string | null) : 'ACME',
      new Date(now.getTime() - MS_PER_DAY).toISOString(),
      expiresAt.toISOString(),
      7,
      now.toISOString()
    );
}

function firstAlert(): {
  status: string;
  error?: string;
  sentAt?: string;
  recipients: string[];
} {
  return listLicenseAlerts(1)[0];
}

describe('readLicenseAlertConfig', () => {
  it('uses documented defaults', () => {
    vi.stubEnv('LICENSE_ENABLED', 'false');
    expect(readLicenseAlertConfig()).toEqual({
      enabled: false,
      alertDays: 3,
      hour: 9,
      timeZone: 'America/Caracas',
    });
  });

  it('reads valid overrides and trims the time zone', () => {
    vi.stubEnv('LICENSE_ALERT_DAYS', '6');
    vi.stubEnv('LICENSE_ALERT_HOUR', '23');
    vi.stubEnv('LICENSE_ALERT_TIMEZONE', '  UTC  ');
    expect(readLicenseAlertConfig()).toEqual({
      enabled: true,
      alertDays: 6,
      hour: 23,
      timeZone: 'UTC',
    });
  });

  it.each(['99', '-1', 'not-a-number'])(
    'falls back to 09:00 for hour %s',
    (hour) => {
      vi.stubEnv('LICENSE_ALERT_HOUR', hour);
      expect(readLicenseAlertConfig().hour).toBe(9);
    }
  );

  it('falls back on an invalid alert-day setting', () => {
    vi.stubEnv('LICENSE_ALERT_DAYS', '0');
    expect(readLicenseAlertConfig().alertDays).toBe(3);
  });
});

describe('time-zone helpers', () => {
  it('formats the local date and hour', () => {
    const date = new Date('2026-11-17T15:00:00.000Z');
    expect(localDateKey(date, 'America/Caracas')).toBe('2026-11-17');
    expect(localHour(date, 'America/Caracas')).toBe(11);
  });

  it('falls back to UTC for an invalid time zone', () => {
    const date = new Date('2026-11-17T15:00:00.000Z');
    expect(localDateKey(date, 'Not/AZone')).toBe('2026-11-17');
    expect(localHour(date, 'Not/AZone')).toBe(15);
  });
});

describe('runLicenseAlertCheck', () => {
  const now = new Date('2026-11-17T15:00:00.000Z');
  const expiringSoon = new Date(now.getTime() + 2 * MS_PER_DAY);

  it('does nothing when the license system is disabled', async () => {
    vi.stubEnv('LICENSE_ENABLED', 'false');
    const result = await runLicenseAlertCheck(now);
    expect(result).toEqual({ status: 'disabled', reason: 'license_disabled' });
  });

  it('skips a suspended license', async () => {
    setLicense(expiringSoon, { status: 'suspendida' });
    const result = await runLicenseAlertCheck(now);
    expect(result).toEqual({ status: 'skipped', reason: 'license_suspended' });
  });

  it('skips when the expiry is outside the alert window', async () => {
    setLicense(new Date(now.getTime() + 10 * MS_PER_DAY));
    const result = await runLicenseAlertCheck(now);
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('outside_alert_window');
    expect(result.daysRemaining).toBe(10);
  });

  it('skips once the license has already expired', async () => {
    setLicense(new Date(now.getTime() - MS_PER_DAY));
    const result = await runLicenseAlertCheck(now);
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('outside_alert_window');
    expect(result.daysRemaining).toBe(-1);
  });

  it('waits until the configured alert hour', async () => {
    setLicense(expiringSoon);
    const result = await runLicenseAlertCheck(
      new Date('2026-11-17T10:00:00.000Z')
    );
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('before_alert_hour');
  });

  it('reserves the daily slot and sends one email', async () => {
    configureSmtp();
    addRecipients('ops@example.com', 'jefa@example.com');
    setLicense(expiringSoon);
    const transport = new FakeTransport();

    const result = await runLicenseAlertCheck(now, transport);

    expect(result.status).toBe('sent');
    expect(result.alertDate).toBe('2026-11-17');
    expect(result.daysRemaining).toBe(2);
    expect(transport.messages).toHaveLength(1);
    expect(transport.messages[0].subject).toContain('vence en 2 días');
    expect(transport.messages[0].text).toContain('ACME');
    expect(transport.messages[0].html).toContain('Mermelada ERP');
    expect(firstAlert().status).toBe('enviado');
    expect(firstAlert().sentAt).toBeTruthy();
  });

  it('is idempotent for the same calendar day', async () => {
    configureSmtp();
    addRecipients('ops@example.com');
    setLicense(expiringSoon);
    const transport = new FakeTransport();

    expect((await runLicenseAlertCheck(now, transport)).status).toBe('sent');
    const second = await runLicenseAlertCheck(now, transport);

    expect(second.status).toBe('duplicate');
    expect(transport.messages).toHaveLength(1);
  });

  it('records a skipped alert when there are no recipients', async () => {
    configureSmtp();
    setLicense(expiringSoon);

    const result = await runLicenseAlertCheck(now, new FakeTransport());

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('no_recipients');
    expect(result.recipients).toEqual([]);
    expect(firstAlert().status).toBe('omitido');
    expect(firstAlert().error).toBe('no_recipients');
  });

  it('marks the alert as partial when only some recipients are accepted', async () => {
    configureSmtp();
    addRecipients('ops@example.com', 'jefa@example.com');
    setLicense(expiringSoon);
    const transport = new FakeTransport();
    transport.accepted = ['ops@example.com'];

    const result = await runLicenseAlertCheck(now, transport);

    expect(result.status).toBe('partial');
    expect(result.error).toContain('no aceptó');
    expect(firstAlert().status).toBe('parcial');
  });

  it('records a skipped send when SMTP is not configured', async () => {
    addRecipients('ops@example.com');
    setLicense(expiringSoon);

    const result = await runLicenseAlertCheck(now, new FakeTransport());

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('smtp_not_configured');
    expect(firstAlert().status).toBe('omitido');
  });

  it('records a failed send when the transport keeps failing', async () => {
    configureSmtp();
    addRecipients('ops@example.com');
    setLicense(expiringSoon);
    const transport = new FakeTransport();
    transport.failures = 3;

    const result = await runLicenseAlertCheck(now, transport);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('SMTP temporalmente no disponible');
    expect(firstAlert().status).toBe('fallido');
  });
});

describe('sendLicenseTestEmail', () => {
  it('sends a test copy with an escaped holder and a prefixed subject', async () => {
    configureSmtp();
    addRecipients('ops@example.com');
    addRecipients('inactivo@example.com');
    getDb()
      .prepare('UPDATE notification_recipients SET active = 0 WHERE email = ?')
      .run('inactivo@example.com');
    setLicense(new Date(Date.now() + 3_600_000), {
      holder: '<ACME & "Co">',
    });
    const transport = new FakeTransport();

    const result = await sendLicenseTestEmail(transport);

    expect(result.status).toBe('sent');
    expect(result.recipients).toEqual(['ops@example.com']);
    expect(transport.messages).toHaveLength(1);
    expect(transport.messages[0].subject).toBe(
      '[PRUEBA] [Mermelada ERP] La licencia vence mañana'
    );
    expect(transport.messages[0].html).toContain(
      '&lt;ACME &amp; &quot;Co&quot;&gt;'
    );
  });

  it('uses the “today” wording when the license expires today', async () => {
    configureSmtp();
    addRecipients('ops@example.com');
    setLicense(new Date(Date.now() - 3_600_000));
    const transport = new FakeTransport();

    await sendLicenseTestEmail(transport);

    expect(transport.messages[0].subject).toContain('vence hoy');
    expect(transport.messages[0].text).toContain('vence hoy');
  });

  it('falls back to the generic holder label', async () => {
    configureSmtp();
    addRecipients('ops@example.com');
    setLicense(new Date(Date.now() + 36 * 3_600_000), { holder: null });
    const transport = new FakeTransport();

    await sendLicenseTestEmail(transport);

    expect(transport.messages[0].subject).toContain('vence en 2 días');
    expect(transport.messages[0].text).toContain('Titular:         Mermelada ERP');
  });

  it('returns partial when some recipients are rejected', async () => {
    configureSmtp();
    addRecipients('ops@example.com', 'jefa@example.com');
    setLicense(new Date(Date.now() + 3_600_000));
    const transport = new FakeTransport();
    transport.accepted = ['ops@example.com'];

    const result = await sendLicenseTestEmail(transport);

    expect(result.status).toBe('partial');
  });

  it('returns skipped when SMTP is not configured', async () => {
    addRecipients('ops@example.com');
    setLicense(new Date(Date.now() + 3_600_000));

    const result = await sendLicenseTestEmail(new FakeTransport());

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('smtp_not_configured');
  });

  it('returns failed when the transport throws', async () => {
    configureSmtp();
    addRecipients('ops@example.com');
    setLicense(new Date(Date.now() + 3_600_000));
    const transport = new FakeTransport();
    transport.failures = 3;

    const result = await sendLicenseTestEmail(transport);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('SMTP temporalmente no disponible');
  });

  it('falls back to UTC formatting for an invalid time zone', async () => {
    configureSmtp();
    addRecipients('ops@example.com');
    vi.stubEnv('LICENSE_ALERT_TIMEZONE', 'Not/AZone');
    const expiresAt = new Date(Date.now() + 3_600_000);
    setLicense(expiresAt);
    const transport = new FakeTransport();

    await sendLicenseTestEmail(transport);

    expect(transport.messages[0].html).toContain(expiresAt.toISOString());
  });

  it('prints an unparsable expiry verbatim', async () => {
    configureSmtp();
    addRecipients('ops@example.com');
    getDb().prepare('DELETE FROM system_license').run();
    const now = new Date();
    getDb()
      .prepare(
        `INSERT INTO system_license
           (id, license_id, status, holder, issued_at, expires_at, grace_days,
            token_id, last_seen_at, max_seen_at, updated_by, updated_at)
         VALUES (1, 'erp-test', 'activa', 'ACME', ?, 'not-a-date', 7,
                 NULL, NULL, NULL, NULL, ?)`
      )
      .run(now.toISOString(), now.toISOString());
    const transport = new FakeTransport();

    await sendLicenseTestEmail(transport);

    expect(transport.messages[0].html).toContain('not-a-date');
  });
});

describe('startLicenseAlertScheduler', () => {
  it('does nothing when the license system is disabled', () => {
    vi.stubEnv('LICENSE_ENABLED', 'false');
    const stop = startLicenseAlertScheduler();
    expect(() => stop()).not.toThrow();
  });

  it('runs on boot and on the configured interval until stopped', async () => {
    vi.useFakeTimers();
    vi.stubEnv('LICENSE_CHECK_INTERVAL_MS', '1000');
    const stop = startLicenseAlertScheduler();

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(1_000);
    stop();

    expect(vi.getTimerCount()).toBe(0);
  });
});
