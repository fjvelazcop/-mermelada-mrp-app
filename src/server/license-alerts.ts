import {
  getLicenseSnapshot,
  isLicenseEnabled,
  licenseAlertDays,
  reserveLicenseAlert,
  updateLicenseAlert,
  type LicenseSnapshot,
} from './license.js';
import { listNotificationRecipients, sendSystemEmail, type MailTransport } from './notifications.js';

/**
 * Daily expiry reminders.
 *
 * From `LICENSE_ALERT_DAYS` days before expiration until the expiry day, one
 * email per calendar day is sent at `LICENSE_ALERT_HOUR` in
 * `LICENSE_ALERT_TIMEZONE`. The `license_alerts` unique key makes the process
 * idempotent even if it runs every hour or the server restarts.
 */

export interface LicenseAlertResult {
  status: 'sent' | 'partial' | 'skipped' | 'failed' | 'duplicate' | 'disabled';
  reason?: string;
  alertDate?: string;
  daysRemaining?: number;
  recipients?: string[];
  error?: string;
}

export interface LicenseAlertConfig {
  enabled: boolean;
  alertDays: number;
  hour: number;
  timeZone: string;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export function readLicenseAlertConfig(): LicenseAlertConfig {
  const hour = Number(process.env['LICENSE_ALERT_HOUR'] ?? 9);
  return {
    enabled: isLicenseEnabled(),
    alertDays: licenseAlertDays(),
    hour: Number.isFinite(hour) && hour >= 0 && hour <= 23 ? Math.trunc(hour) : 9,
    timeZone: process.env['LICENSE_ALERT_TIMEZONE']?.trim() || 'America/Caracas',
  };
}

function partsInTimeZone(
  date: Date,
  timeZone: string
): Record<string, string> {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(date);
    return Object.fromEntries(
      parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );
  } catch {
    // Invalid time zone: fall back to UTC so alerts still work.
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(date);
    return Object.fromEntries(
      parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );
  }
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = partsInTimeZone(date, timeZone);
  return `${parts['year']}-${parts['month']}-${parts['day']}`;
}

export function localHour(date: Date, timeZone: string): number {
  const parts = partsInTimeZone(date, timeZone);
  return Number(parts['hour']);
}

function formatExpiry(snapshot: LicenseSnapshot, timeZone: string): string {
  const parsed = new Date(snapshot.expiresAt);
  if (Number.isNaN(parsed.getTime())) return snapshot.expiresAt;
  try {
    return new Intl.DateTimeFormat('es-VE', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone,
    }).format(parsed);
  } catch {
    return parsed.toISOString();
  }
}

function subjectFor(daysRemaining: number): string {
  if (daysRemaining === 0) return '[Mermelada ERP] La licencia vence hoy';
  if (daysRemaining === 1) return '[Mermelada ERP] La licencia vence mañana';
  return `[Mermelada ERP] La licencia vence en ${daysRemaining} días`;
}

function buildLicenseEmail(
  snapshot: LicenseSnapshot,
  daysRemaining: number,
  config: LicenseAlertConfig
): { subject: string; text: string; html: string } {
  const subject = subjectFor(daysRemaining);
  const expiry = formatExpiry(snapshot, config.timeZone);
  const holder = snapshot.holder || 'Mermelada ERP';
  const grace = snapshot.graceDays;
  const daysText =
    daysRemaining === 0
      ? 'hoy'
      : daysRemaining === 1
        ? 'mañana'
        : `en ${daysRemaining} días`;

  const text = [
    'Mermelada ERP - Aviso de vencimiento de licencia',
    '',
    `La licencia del sistema vence ${daysText}.`,
    '',
    `Titular:         ${holder}`,
    `Licencia:        ${snapshot.licenseId}`,
    `Vence:           ${expiry}`,
    `Días restantes:  ${daysRemaining}`,
    `Período de gracia: ${grace} día(s)`,
    '',
    'Para renovar, emita un token nuevo y aplíquelo por SSH o desde el módulo',
    'Activación & Pagos → Licencia del sistema.',
    '',
    'Este mensaje se envió automáticamente por el sistema de notificaciones.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
    <h2 style="margin-bottom: 8px;">Mermelada ERP — Licencia por vencer</h2>
    <p>La licencia del sistema vence <strong>${daysText}</strong>.</p>
    <table cellpadding="8" cellspacing="0" style="border-collapse: collapse; border: 1px solid #d1d5db;">
      <tr><th align="left" style="background:#f3f4f6;border-bottom:1px solid #d1d5db;">Titular</th><td style="border-bottom:1px solid #d1d5db;">${escapeHtml(holder)}</td></tr>
      <tr><th align="left" style="background:#f3f4f6;border-bottom:1px solid #d1d5db;">Licencia</th><td style="border-bottom:1px solid #d1d5db;">${escapeHtml(snapshot.licenseId)}</td></tr>
      <tr><th align="left" style="background:#f3f4f6;border-bottom:1px solid #d1d5db;">Vence</th><td style="border-bottom:1px solid #d1d5db;">${escapeHtml(expiry)}</td></tr>
      <tr><th align="left" style="background:#f3f4f6;border-bottom:1px solid #d1d5db;">Días restantes</th><td style="border-bottom:1px solid #d1d5db;">${daysRemaining}</td></tr>
      <tr><th align="left" style="background:#f3f4f6;">Gracia</th><td>${grace} día(s)</td></tr>
    </table>
    <p>Para renovar, emita un token nuevo y aplíquelo por SSH o desde el módulo
       <strong>Activación &amp; Pagos → Licencia del sistema</strong>.</p>
    <p style="color:#6b7280;font-size:13px;">Este mensaje se envió automáticamente por el sistema de notificaciones.</p>
  </body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function activeRecipientEmails(): string[] {
  return listNotificationRecipients()
    .filter((recipient) => recipient.active)
    .map((recipient) => recipient.email);
}

/**
 * Run one idempotent check. Safe to call every hour, at boot or from tests.
 */
export async function runLicenseAlertCheck(
  now = new Date(),
  transport?: MailTransport
): Promise<LicenseAlertResult> {
  const config = readLicenseAlertConfig();
  if (!config.enabled) {
    return { status: 'disabled', reason: 'license_disabled' };
  }

  const snapshot = getLicenseSnapshot(now);
  if (snapshot.status === 'suspendida') {
    return { status: 'skipped', reason: 'license_suspended' };
  }

  const daysRemaining = snapshot.daysRemaining;
  if (daysRemaining < 0 || daysRemaining > config.alertDays) {
    return { status: 'skipped', reason: 'outside_alert_window', daysRemaining };
  }

  if (localHour(now, config.timeZone) < config.hour) {
    return { status: 'skipped', reason: 'before_alert_hour', daysRemaining };
  }

  const alertDate = localDateKey(now, config.timeZone);
  const recipients = activeRecipientEmails();
  const alertId = reserveLicenseAlert({
    licenseId: snapshot.licenseId,
    alertDate,
    daysRemaining,
    recipients,
  });

  if (!alertId) {
    return { status: 'duplicate', alertDate, daysRemaining, recipients };
  }

  if (recipients.length === 0) {
    updateLicenseAlert(alertId, 'omitido', 'no_recipients');
    return {
      status: 'skipped',
      reason: 'no_recipients',
      alertDate,
      daysRemaining,
      recipients,
    };
  }

  const email = buildLicenseEmail(snapshot, daysRemaining, config);
  const result = await sendSystemEmail({
    kind: 'license-expiry',
    ...email,
    recipients,
    transport,
  });

  const status =
    result.status === 'sent'
      ? 'enviado'
      : result.status === 'partial'
        ? 'parcial'
        : result.status === 'skipped'
          ? 'omitido'
          : 'fallido';
  updateLicenseAlert(alertId, status, result.error ?? result.reason);

  return {
    status:
      result.status === 'sent'
        ? 'sent'
        : result.status === 'partial'
          ? 'partial'
          : result.status === 'skipped'
            ? 'skipped'
            : 'failed',
    reason: result.reason,
    alertDate,
    daysRemaining,
    recipients,
    error: result.error,
  };
}

/** Send a manual test email without consuming the daily alert slot. */
export async function sendLicenseTestEmail(
  transport?: MailTransport
): Promise<LicenseAlertResult> {
  const config = readLicenseAlertConfig();
  const snapshot = getLicenseSnapshot();
  const recipients = activeRecipientEmails();
  const email = buildLicenseEmail(snapshot, snapshot.daysRemaining, config);
  const result = await sendSystemEmail({
    kind: 'license-test',
    subject: `[PRUEBA] ${email.subject}`,
    text: email.text,
    html: email.html,
    recipients,
    transport,
  });

  return {
    status:
      result.status === 'sent'
        ? 'sent'
        : result.status === 'partial'
          ? 'partial'
          : result.status === 'skipped'
            ? 'skipped'
            : 'failed',
    reason: result.reason,
    recipients,
    error: result.error,
  };
}

/**
 * Start the in-process scheduler. It runs once shortly after boot (so a missed
 * 09:00 email is recovered when the server starts later that day) and then
 * every `LICENSE_CHECK_INTERVAL_MS` (one hour by default).
 */
export function startLicenseAlertScheduler(): () => void {
  if (!isLicenseEnabled()) {
    return () => undefined;
  }

  const intervalMs = positiveInt(
    process.env['LICENSE_CHECK_INTERVAL_MS'],
    3_600_000
  );
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;
    void runLicenseAlertCheck().catch((error) => {
      console.error(
        '[license] No se pudo ejecutar la revisión de alertas:',
        error instanceof Error ? error.message : String(error)
      );
    });
  };

  const bootTimer = setTimeout(tick, 15_000);
  bootTimer.unref?.();
  const interval = setInterval(tick, intervalMs);
  interval.unref?.();

  return () => {
    stopped = true;
    clearTimeout(bootTimer);
    clearInterval(interval);
  };
}
