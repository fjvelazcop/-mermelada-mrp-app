import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * HTTP Basic Auth in front of the Angular UI.
 *
 * The API keeps its own bearer-token + RBAC flow. This middleware is applied
 * after the API routes, so it only protects static assets and the SSR shell.
 * Cloudflare provides HTTPS; this adds a shared gate before the app renders.
 *
 * Environment:
 *  - `UI_AUTH_ENABLED=true`
 *  - `UI_AUTH_USER`
 *  - `UI_AUTH_PASSWORD`
 *
 * If protection is enabled without credentials the middleware fails closed
 * (503) instead of silently exposing the UI.
 */

export const UI_AUTH_REALM = 'Mermelada ERP';

export function isUiAuthEnabled(): boolean {
  return process.env['UI_AUTH_ENABLED'] === 'true';
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function unauthorized(res: Response): void {
  res.setHeader(
    'WWW-Authenticate',
    `Basic realm="${UI_AUTH_REALM}", charset="UTF-8"`
  );
  res.status(401).type('text/plain').send('Autenticación requerida');
}

/**
 * Parse a Basic Authorization header. Returns `null` for malformed values.
 */
export function parseBasicAuth(
  header: string | undefined
): { user: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString(
      'utf8'
    );
  } catch {
    return null;
  }
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;
  return {
    user: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

export function uiAuthMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isUiAuthEnabled()) {
      next();
      return;
    }

    const user = process.env['UI_AUTH_USER'] || '';
    const password = process.env['UI_AUTH_PASSWORD'] || '';
    if (!user || !password) {
      res
        .status(503)
        .type('text/plain')
        .send(
          'UI_AUTH_ENABLED=true requiere UI_AUTH_USER y UI_AUTH_PASSWORD'
        );
      return;
    }

    const credentials = parseBasicAuth(req.header('authorization'));
    if (
      !credentials ||
      !safeEqual(credentials.user, user) ||
      !safeEqual(credentials.password, password)
    ) {
      unauthorized(res);
      return;
    }

    next();
  };
}
