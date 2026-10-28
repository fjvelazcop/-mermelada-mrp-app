import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import {
  closeTunnelSession,
  getLatestTunnelSession,
  isEmailConfigured,
  listTunnelSessions,
  recordTunnelSession,
  sendTunnelNotification,
} from './notifications.js';

/**
 * Internal Cloudflare tunnel callback and read endpoints.
 *
 * `scripts/tunnel.mjs` runs under PM2, waits for the API to be healthy, starts
 * `cloudflared` and reports the public URL to this callback. Because the
 * callback runs on loopback and requires a shared token, it is registered
 * before the normal bearer/role middleware.
 */

export function internalTunnelToken(): string {
  return (
    process.env['TUNNEL_INTERNAL_TOKEN']?.trim() ||
    process.env['AUTH_SECRET']?.trim() ||
    ''
  );
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return (
    address === '::1' ||
    address === '127.0.0.1' ||
    address.startsWith('127.') ||
    address === '::ffff:127.0.0.1'
  );
}

function tokensMatch(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function errorResponse(
  res: Response,
  status: number,
  message: string,
  code: string
): void {
  res.status(status).json({ error: message, code });
}

/**
 * POST /api/internal/tunnel
 *
 * Body for a new session: `{ provider?, mode?, publicUrl, apiUrl?, pid? }`.
 * Body to close a session: `{ sessionId, status: "detenido" | "error" }`.
 */
export async function internalTunnelHandler(
  req: Request,
  res: Response
): Promise<void> {
  const expected = internalTunnelToken();
  if (!expected) {
    errorResponse(
      res,
      503,
      'El callback interno está deshabilitado: configure TUNNEL_INTERNAL_TOKEN o AUTH_SECRET',
      'INTERNAL_CALLBACK_DISABLED'
    );
    return;
  }

  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    errorResponse(
      res,
      403,
      'El callback del túnel solo acepta conexiones locales',
      'FORBIDDEN'
    );
    return;
  }

  // Requests proxied through the public tunnel also arrive from loopback.
  // Cloudflare adds these headers, so reject them to keep the callback private.
  if (req.header('cf-connecting-ip') || req.header('cf-ray')) {
    errorResponse(
      res,
      403,
      'El callback del túnel no está disponible a través del túnel público',
      'FORBIDDEN'
    );
    return;
  }

  const provided = req.header('x-internal-token') ?? '';
  if (!tokensMatch(provided, expected)) {
    errorResponse(res, 401, 'Token interno inválido', 'UNAUTHORIZED');
    return;
  }

  const sessionId =
    typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
  const requestedStatus =
    typeof req.body?.status === 'string' ? req.body.status : '';

  if (sessionId) {
    const finalStatus =
      requestedStatus === 'error' ? 'error' : 'detenido';
    const session = closeTunnelSession(sessionId, finalStatus);
    if (!session) {
      errorResponse(res, 404, 'Sesión de túnel no encontrada', 'NOT_FOUND');
      return;
    }
    res.json({ session, notification: null });
    return;
  }

  const publicUrl =
    typeof req.body?.publicUrl === 'string' ? req.body.publicUrl : '';
  if (!publicUrl) {
    errorResponse(
      res,
      422,
      'publicUrl es obligatorio para registrar el túnel',
      'VALIDATION_ERROR'
    );
    return;
  }

  let session;
  try {
    session = recordTunnelSession({
      provider:
        typeof req.body?.provider === 'string'
          ? req.body.provider
          : 'cloudflare',
      mode: typeof req.body?.mode === 'string' ? req.body.mode : 'quick',
      publicUrl,
      apiUrl:
        typeof req.body?.apiUrl === 'string' ? req.body.apiUrl : undefined,
      pid: Number.isInteger(req.body?.pid) ? Number(req.body.pid) : undefined,
      metadata:
        req.body?.metadata && typeof req.body.metadata === 'object'
          ? req.body.metadata
          : undefined,
    });
  } catch (error) {
    errorResponse(
      res,
      422,
      error instanceof Error ? error.message : 'Datos del túnel inválidos',
      'VALIDATION_ERROR'
    );
    return;
  }

  const notification = await sendTunnelNotification({
    publicUrl: session.publicUrl,
    apiUrl: session.apiUrl,
    startedAt: session.startedAt,
  });

  res.status(201).json({ session, notification });
}

/** GET /api/system/tunnel — latest URL plus recent history (admin only). */
export function getTunnelSessionsHandler(req: Request, res: Response): void {
  const limit = Number(req.query['limit'] || 20);
  res.json({
    latest: getLatestTunnelSession(),
    history: listTunnelSessions(limit),
    emailConfigured: isEmailConfigured(),
  });
}
