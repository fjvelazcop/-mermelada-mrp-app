import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Security hardening shared by the API and the Angular SSR shell.
 *
 * Two independent middleware live here:
 *
 *  - `securityHeaders()` adds the standard hardening headers. HSTS is only
 *    sent when the request is already HTTPS (directly or through a trusted
 *    proxy) so local HTTP development keeps working.
 *  - `createRateLimiter()` is a dependency-free, in-memory fixed-window
 *    limiter. It is enough for a single-node deployment; if the app is ever
 *    scaled horizontally the limiter must move to a shared store.
 *
 * The Content-Security-Policy starts as `Report-Only` on purpose: Angular
 * injects inline styles and loads Google Fonts, so the policy is validated in
 * production logs before it is enforced.
 */

export const SECURITY_HEADERS = {
  nosniff: 'X-Content-Type-Options',
  frame: 'X-Frame-Options',
  referrer: 'Referrer-Policy',
  permissions: 'Permissions-Policy',
  hsts: 'Strict-Transport-Security',
  csp: 'Content-Security-Policy-Report-Only',
} as const;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self'",
  "connect-src 'self' https:",
].join('; ');

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'camera=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'payment=()',
  'usb=()',
].join(', ');

function isHttps(req: Request): boolean {
  if (req.secure) return true;
  const forwarded = req.header('x-forwarded-proto');
  return forwarded?.split(',')[0]?.trim().toLowerCase() === 'https';
}

/** Add hardening headers to every response (API, static assets and SSR). */
export function securityHeaders(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader(SECURITY_HEADERS.nosniff, 'nosniff');
    res.setHeader(SECURITY_HEADERS.frame, 'DENY');
    res.setHeader(SECURITY_HEADERS.referrer, 'strict-origin-when-cross-origin');
    res.setHeader(SECURITY_HEADERS.permissions, PERMISSIONS_POLICY);
    res.setHeader(SECURITY_HEADERS.csp, CONTENT_SECURITY_POLICY);

    if (isHttps(req)) {
      res.setHeader(
        SECURITY_HEADERS.hsts,
        'max-age=15552000; includeSubDomains'
      );
    }

    next();
  };
}

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs?: number;
  /** Maximum number of requests allowed per window and key. */
  max?: number;
  /** Message returned with HTTP 429. */
  message?: string;
  /** Requests matching this predicate are not counted. */
  skip?: (req: Request) => boolean;
  /** Bucket key. Defaults to the client IP. */
  keyGenerator?: (req: Request) => string;
  /** Injectable clock, used by tests. */
  now?: () => number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimiter extends RequestHandler {
  /** Drop every bucket (used by tests and by configuration reloads). */
  reset(): void;
}

const MAX_TRACKED_BUCKETS = 10_000;

function clientKey(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Create an in-memory fixed-window rate limiter.
 *
 * Responses always include `RateLimit-*` headers and a `Retry-After` header
 * when the limit is exceeded, which lets clients and Cloudflare back off.
 */
export function createRateLimiter(
  options: RateLimitOptions = {}
): RateLimiter {
  const windowMs = Math.max(1000, options.windowMs ?? 60_000);
  const max = Math.max(1, Math.trunc(options.max ?? 300));
  const now = options.now ?? Date.now;
  const buckets = new Map<string, RateLimitBucket>();
  const keyGenerator = options.keyGenerator ?? clientKey;
  const message =
    options.message ??
    'Demasiadas solicitudes. Espere unos segundos e intente de nuevo.';

  const handler = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    if (options.skip?.(req)) {
      next();
      return;
    }

    const current = now();
    const key = keyGenerator(req);
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const resetSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - current) / 1000)
    );

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(resetSeconds));
      res.status(429).json({ error: message, code: 'RATE_LIMITED' });
      return;
    }

    if (buckets.size > MAX_TRACKED_BUCKETS) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= current) buckets.delete(bucketKey);
      }
    }

    next();
  };

  return Object.assign(handler, {
    reset(): void {
      buckets.clear();
    },
  });
}

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  max: number;
  loginWindowMs: number;
  loginMax: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read the limiter configuration.
 *
 * Enabled by default, disabled automatically under `NODE_ENV=test` so the
 * integration suite can issue hundreds of requests. `RATE_LIMIT_ENABLED`
 * always wins when set explicitly.
 */
export function readRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env
): RateLimitConfig {
  const flag = env['RATE_LIMIT_ENABLED'];
  const enabled =
    flag === 'false'
      ? false
      : flag === 'true'
        ? true
        : env['NODE_ENV'] !== 'test';

  return {
    enabled,
    windowMs: positiveInt(env['RATE_LIMIT_WINDOW_MS'], 60_000),
    max: positiveInt(env['RATE_LIMIT_MAX'], 300),
    loginWindowMs: positiveInt(env['RATE_LIMIT_LOGIN_WINDOW_MS'], 900_000),
    loginMax: positiveInt(env['RATE_LIMIT_LOGIN_MAX'], 10),
  };
}

/** Paths that must stay reachable regardless of rate limiting. */
const RATE_LIMIT_EXEMPT = [
  '/api/health',
  '/api/openapi.json',
  '/api/docs',
  '/api/internal/tunnel',
];

export function isRateLimitExempt(req: Request): boolean {
  const url = req.originalUrl || req.url;
  return RATE_LIMIT_EXEMPT.some(
    (path) => url === path || url.startsWith(`${path}/`) || url.startsWith(`${path}?`)
  );
}

/** Login limiter key: client IP plus the attempted username. */
export function loginRateLimitKey(req: Request): string {
  const body = req.body as { username?: unknown } | undefined;
  const username =
    typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  return `${clientKey(req)}|${username}`;
}
