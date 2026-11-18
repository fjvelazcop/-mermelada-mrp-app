/**
 * Transactional emails for the authentication flows.
 *
 * Password-reset and password-changed messages use the same SMTP transport and
 * `notification_log` as the operational notifications, but they are always
 * addressed to the affected user instead of the notification recipient list.
 *
 * The reset link carries the token in the URL fragment (`#reset=...`) so the
 * browser never sends it to the server in the request line or the `Referer`
 * header.
 */

export interface EmailUser {
  username: string;
  fullName: string;
  email: string;
}

export interface AuthEmail {
  subject: string;
  text: string;
  html: string;
}

const DEFAULT_APP_URL = 'http://localhost:4000';
const DEFAULT_TTL_SECONDS = 30 * 60;

/** Base application URL, without a trailing slash. */
export function resolveAppUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = (env['APP_URL'] ?? '').trim();
  return (value || DEFAULT_APP_URL).replace(/\/+$/, '');
}

/** True for URLs that only work on the server itself. */
export function isLocalAppUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    );
  } catch {
    return true;
  }
}

/**
 * Public base URL for links delivered by email.
 *
 * `APP_URL` wins when it points to a real domain. When it is empty or still
 * the local development value, use the origin of the incoming request so the
 * recovery link keeps working behind a tunnel whose public URL changes.
 */
export function resolvePublicAppUrl(options: {
  requestOrigin?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string {
  const configured = resolveAppUrl(options.env);
  if (!isLocalAppUrl(configured)) return configured;
  const origin = (options.requestOrigin ?? '').trim().replace(/\/+$/, '');
  return origin || configured;
}

/** Build the one-use recovery link. The token travels in the fragment. */
export function buildResetLink(
  token: string,
  appUrl: string = resolveAppUrl()
): string {
  return `${appUrl.replace(/\/+$/, '')}/login#reset=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function displayName(user: EmailUser): string {
  return user.fullName.trim() || user.username;
}

function ttlMinutes(ttlSeconds: number): number {
  return Math.max(1, Math.ceil(ttlSeconds / 60));
}

function formatDateTime(
  date: Date,
  timeZone = process.env['TZ'] || 'America/Caracas'
): string {
  try {
    return new Intl.DateTimeFormat('es-VE', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export interface PasswordResetEmailOptions {
  user: EmailUser;
  token: string;
  ttlSeconds?: number;
  appUrl?: string;
}

/** Email with the one-use link and the manual recovery code. */
export function buildPasswordResetEmail(
  options: PasswordResetEmailOptions
): AuthEmail {
  const { user, token } = options;
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const minutes = ttlMinutes(ttlSeconds);
  const link = buildResetLink(token, options.appUrl ?? resolveAppUrl());
  const name = displayName(user);

  const subject = '[Mermelada ERP] Recuperación de contraseña';

  const text = [
    'Mermelada ERP - Recuperación de contraseña',
    '',
    `Hola ${name},`,
    '',
    `Recibimos una solicitud para restablecer la contraseña de la cuenta "${user.username}".`,
    '',
    'Abre este enlace para definir una nueva contraseña:',
    link,
    '',
    'Si el enlace no abre, pega este código en la pantalla de recuperación:',
    token,
    '',
    `El enlace y el código vencen en ${minutes} minuto(s) y solo pueden usarse una vez.`,
    '',
    'Si no solicitaste este cambio, ignora este mensaje: tu contraseña actual sigue vigente.',
    '',
    'Este mensaje se envió automáticamente por el sistema de notificaciones.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
    <h2 style="margin-bottom: 8px;">Mermelada ERP — Recuperar contraseña</h2>
    <p>Hola ${escapeHtml(name)},</p>
    <p>Recibimos una solicitud para restablecer la contraseña de la cuenta
       <strong>${escapeHtml(user.username)}</strong>.</p>
    <p>
      <a href="${escapeHtml(link)}"
         style="display:inline-block;background:#d97706;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">
        Definir nueva contraseña
      </a>
    </p>
    <p>Si el botón no funciona, copia este enlace en tu navegador:</p>
    <p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
    <p>También puedes pegar este código en la pantalla de recuperación:</p>
    <pre style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:8px;padding:12px;white-space:pre-wrap;word-break:break-all;">${escapeHtml(token)}</pre>
    <p>El enlace y el código vencen en <strong>${minutes} minuto(s)</strong> y solo pueden usarse una vez.</p>
    <p>Si no solicitaste este cambio, ignora este mensaje: tu contraseña actual sigue vigente.</p>
    <p style="color:#6b7280;font-size:13px;">Este mensaje se envió automáticamente por el sistema de notificaciones.</p>
  </body>
</html>`;

  return { subject, text, html };
}

export interface PasswordChangedEmailOptions {
  user: EmailUser;
  changedAt?: Date;
}

/** Security notice sent after an authenticated password change. */
export function buildPasswordChangedEmail(
  options: PasswordChangedEmailOptions
): AuthEmail {
  const { user } = options;
  const changedAt = options.changedAt ?? new Date();
  const name = displayName(user);
  const when = formatDateTime(changedAt);

  const subject = '[Mermelada ERP] Tu contraseña fue cambiada';

  const text = [
    'Mermelada ERP - Cambio de contraseña',
    '',
    `Hola ${name},`,
    '',
    `La contraseña de la cuenta "${user.username}" fue cambiada el ${when}.`,
    '',
    'Si realizaste este cambio, no necesitas hacer nada más.',
    'Si no fuiste tú, contacta de inmediato al administrador del sistema y',
    'solicita el restablecimiento de tu acceso.',
    '',
    'Este mensaje se envió automáticamente por el sistema de notificaciones.',
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
    <h2 style="margin-bottom: 8px;">Mermelada ERP — Contraseña actualizada</h2>
    <p>Hola ${escapeHtml(name)},</p>
    <p>La contraseña de la cuenta <strong>${escapeHtml(user.username)}</strong>
       fue cambiada el <strong>${escapeHtml(when)}</strong>.</p>
    <p>Si realizaste este cambio, no necesitas hacer nada más.</p>
    <p>Si no fuiste tú, contacta de inmediato al administrador del sistema y
       solicita el restablecimiento de tu acceso.</p>
    <p style="color:#6b7280;font-size:13px;">Este mensaje se envió automáticamente por el sistema de notificaciones.</p>
  </body>
</html>`;

  return { subject, text, html };
}
