import type { NextFunction, Request, Response } from 'express';
import {
  getLicenseSnapshot,
  isLicenseEnabled,
  touchLicense,
  type LicenseSnapshot,
} from './license.js';

/**
 * Enforce the global system license.
 *
 * While the license is valid (including its grace period) every request is
 * allowed. Once it is fully expired, suspended or the clock was rolled back,
 * only safe reads and the license endpoints remain available: the ERP becomes
 * read-only until a signed token is applied.
 */

const LICENSE_PREFIX = '/api/system/license';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Paths that must stay reachable so the system can be reactivated. */
const EXEMPT_PREFIXES = [
  LICENSE_PREFIX,
  '/api/auth',
  '/api/health',
  '/api/docs',
  '/api/openapi.json',
  '/api/internal/tunnel',
];

function isExempt(path: string): boolean {
  if (path === '/api') return true;
  return EXEMPT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

function applyHeaders(res: Response, snapshot: LicenseSnapshot): void {
  res.setHeader('X-License-Mode', snapshot.mode);
  res.setHeader('X-License-Days-Remaining', String(snapshot.daysRemaining));
  res.setHeader('X-License-Expires-At', snapshot.expiresAt);
}

export function licenseGuard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isLicenseEnabled()) {
      next();
      return;
    }

    let snapshot: LicenseSnapshot;
    try {
      touchLicense();
      snapshot = getLicenseSnapshot();
    } catch (error) {
      // Fail closed: if the license cannot be read, do not allow writes.
      const message =
        error instanceof Error ? error.message : 'No se pudo leer la licencia';
      if (SAFE_METHODS.has(req.method) || isExempt(req.path)) {
        next();
        return;
      }
      res.status(503).json({
        error: `Licencia no disponible: ${message}`,
        code: 'LICENSE_UNAVAILABLE',
      });
      return;
    }

    applyHeaders(res, snapshot);

    if (!snapshot.readOnly) {
      next();
      return;
    }

    if (SAFE_METHODS.has(req.method) || isExempt(req.path)) {
      next();
      return;
    }

    res.status(402).json({
      error:
        'La licencia del sistema venció o está suspendida. El sistema está en modo solo lectura hasta aplicar un token de activación.',
      code: 'LICENSE_EXPIRED',
      license: {
        status: snapshot.status,
        mode: snapshot.mode,
        expiresAt: snapshot.expiresAt,
        graceDays: snapshot.graceDays,
        daysRemaining: snapshot.daysRemaining,
        clockTampered: snapshot.clockTampered,
      },
    });
  };
}
