import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  SECURITY_HEADERS,
  createRateLimiter,
  isRateLimitExempt,
  loginRateLimitKey,
  readRateLimitConfig,
  securityHeaders,
} from './security.js';

interface FakeResponse {
  res: Response;
  headers: Record<string, string>;
  statusCode: number;
  body: unknown;
}

function fakeResponse(): FakeResponse {
  const state = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
  };
  const res = {
    setHeader(name: string, value: string | number): unknown {
      state.headers[name.toLowerCase()] = String(value);
      return res;
    },
    status(code: number): unknown {
      state.statusCode = code;
      return res;
    },
    json(payload: unknown): unknown {
      state.body = payload;
      return res;
    },
    header(name: string): string | undefined {
      return state.headers[name.toLowerCase()];
    },
  };
  return {
    res: res as unknown as Response,
    get headers() {
      return state.headers;
    },
    get statusCode() {
      return state.statusCode;
    },
    get body() {
      return state.body;
    },
  };
}

interface FakeRequestOptions {
  ip?: string;
  secure?: boolean;
  headers?: Record<string, string>;
  originalUrl?: string;
  url?: string;
  body?: unknown;
}

function fakeRequest(options: FakeRequestOptions = {}): Request {
  const headers = Object.fromEntries(
    Object.entries(options.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ])
  );
  const req = {
    ip: options.ip ?? '203.0.113.10',
    secure: options.secure ?? false,
    headers,
    body: options.body,
    originalUrl: options.originalUrl ?? '/api/sales/orders',
    url: options.url ?? options.originalUrl ?? '/api/sales/orders',
    socket: { remoteAddress: options.ip ?? '203.0.113.10' },
    header(name: string): string | undefined {
      return headers[name.toLowerCase()];
    },
  };
  return req as unknown as Request;
}

function run(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  req: Request
): { response: FakeResponse; next: ReturnType<typeof vi.fn> } {
  const response = fakeResponse();
  const next = vi.fn();
  middleware(req, response.res, next as unknown as NextFunction);
  return { response, next };
}

describe('securityHeaders', () => {
  it('sets the hardening headers on every response', () => {
    const { response, next } = run(
      securityHeaders(),
      fakeRequest({ headers: {} })
    );

    expect(next).toHaveBeenCalledOnce();
    expect(response.headers[SECURITY_HEADERS.nosniff.toLowerCase()]).toBe(
      'nosniff'
    );
    expect(response.headers[SECURITY_HEADERS.frame.toLowerCase()]).toBe('DENY');
    expect(
      response.headers[SECURITY_HEADERS.referrer.toLowerCase()]
    ).toBe('strict-origin-when-cross-origin');
    expect(
      response.headers[SECURITY_HEADERS.permissions.toLowerCase()]
    ).toContain('geolocation=()');
    expect(response.headers[SECURITY_HEADERS.csp.toLowerCase()]).toContain(
      "frame-ancestors 'none'"
    );
  });

  it('only sends HSTS over HTTPS', () => {
    const http = run(securityHeaders(), fakeRequest({ secure: false }));
    expect(
      http.response.headers[SECURITY_HEADERS.hsts.toLowerCase()]
    ).toBeUndefined();

    const secure = run(securityHeaders(), fakeRequest({ secure: true }));
    expect(secure.response.headers[SECURITY_HEADERS.hsts.toLowerCase()]).toBe(
      'max-age=15552000; includeSubDomains'
    );
  });

  it('detects HTTPS behind the tunnel from X-Forwarded-Proto', () => {
    const forwarded = run(
      securityHeaders(),
      fakeRequest({ headers: { 'x-forwarded-proto': 'https, http' } })
    );
    expect(
      forwarded.response.headers[SECURITY_HEADERS.hsts.toLowerCase()]
    ).toBeTruthy();

    const plain = run(
      securityHeaders(),
      fakeRequest({ headers: { 'x-forwarded-proto': 'http' } })
    );
    expect(
      plain.response.headers[SECURITY_HEADERS.hsts.toLowerCase()]
    ).toBeUndefined();
  });
});

describe('createRateLimiter', () => {
  it('allows requests up to the limit and then replies 429', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    const first = run(limiter, fakeRequest());
    const second = run(limiter, fakeRequest());
    const third = run(limiter, fakeRequest());

    expect(first.response.statusCode).toBe(200);
    expect(first.next).toHaveBeenCalledOnce();
    expect(first.response.headers['ratelimit-limit']).toBe('2');
    expect(first.response.headers['ratelimit-remaining']).toBe('1');

    expect(second.next).toHaveBeenCalledOnce();
    expect(second.response.headers['ratelimit-remaining']).toBe('0');

    expect(third.next).not.toHaveBeenCalled();
    expect(third.response.statusCode).toBe(429);
    expect(third.response.headers['retry-after']).toBe('60');
    expect(third.response.body).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('uses a custom message and key generator', () => {
    const limiter = createRateLimiter({
      max: 1,
      message: 'Bloqueado',
      keyGenerator: (req) => String(req.body?.username ?? 'anon'),
    });

    run(limiter, fakeRequest({ body: { username: 'admin' } }));
    const blocked = run(limiter, fakeRequest({ body: { username: 'admin' } }));
    const other = run(limiter, fakeRequest({ body: { username: 'operador' } }));

    expect(blocked.response.statusCode).toBe(429);
    expect(blocked.response.body).toEqual({
      error: 'Bloqueado',
      code: 'RATE_LIMITED',
    });
    expect(other.next).toHaveBeenCalledOnce();
  });

  it('resets the bucket when the window expires', () => {
    let nowMs = 1_000;
    const limiter = createRateLimiter({
      max: 1,
      windowMs: 1_000,
      now: () => nowMs,
    });

    run(limiter, fakeRequest());
    expect(run(limiter, fakeRequest()).response.statusCode).toBe(429);

    nowMs += 1_001;
    const afterWindow = run(limiter, fakeRequest());
    expect(afterWindow.next).toHaveBeenCalledOnce();
    expect(afterWindow.response.statusCode).toBe(200);
  });

  it('tracks each client IP separately and skips exempt paths', () => {
    const limiter = createRateLimiter({
      max: 1,
      skip: (req) => req.originalUrl === '/api/health',
    });

    run(limiter, fakeRequest({ ip: '198.51.100.1' }));
    const otherClient = run(limiter, fakeRequest({ ip: '198.51.100.2' }));
    expect(otherClient.next).toHaveBeenCalledOnce();

    const skipped = run(
      limiter,
      fakeRequest({ originalUrl: '/api/health', ip: '198.51.100.1' })
    );
    expect(skipped.next).toHaveBeenCalledOnce();
    expect(skipped.response.headers['ratelimit-limit']).toBeUndefined();
  });

  it('can be reset manually', () => {
    const limiter = createRateLimiter({ max: 1 });
    run(limiter, fakeRequest());
    expect(run(limiter, fakeRequest()).response.statusCode).toBe(429);

    limiter.reset();
    expect(run(limiter, fakeRequest()).next).toHaveBeenCalledOnce();
  });

  it('falls back to the socket address when req.ip is missing', () => {
    const limiter = createRateLimiter({ max: 1 });
    const req = fakeRequest({ ip: '' });
    Object.assign(req, { ip: undefined });

    run(limiter, req);
    expect(run(limiter, req).response.statusCode).toBe(429);
  });

  it('clamps invalid limits to a safe minimum', () => {
    const limiter = createRateLimiter({ max: 0, windowMs: 10 });
    const first = run(limiter, fakeRequest());
    expect(first.response.headers['ratelimit-limit']).toBe('1');
    expect(run(limiter, fakeRequest()).response.statusCode).toBe(429);
  });
});

describe('readRateLimitConfig', () => {
  it('is disabled by default in tests and enabled in production', () => {
    expect(readRateLimitConfig({ NODE_ENV: 'test' }).enabled).toBe(false);
    expect(readRateLimitConfig({ NODE_ENV: 'production' }).enabled).toBe(true);
    expect(readRateLimitConfig({}).enabled).toBe(true);
  });

  it('honours explicit overrides', () => {
    expect(
      readRateLimitConfig({ RATE_LIMIT_ENABLED: 'false', NODE_ENV: 'production' })
        .enabled
    ).toBe(false);
    expect(
      readRateLimitConfig({ RATE_LIMIT_ENABLED: 'true', NODE_ENV: 'test' })
        .enabled
    ).toBe(true);
  });

  it('reads custom windows and falls back on invalid values', () => {
    const config = readRateLimitConfig({
      RATE_LIMIT_WINDOW_MS: '30000',
      RATE_LIMIT_MAX: '42',
      RATE_LIMIT_LOGIN_WINDOW_MS: '600000',
      RATE_LIMIT_LOGIN_MAX: '5',
    });
    expect(config).toMatchObject({
      windowMs: 30_000,
      max: 42,
      loginWindowMs: 600_000,
      loginMax: 5,
    });

    const fallback = readRateLimitConfig({
      RATE_LIMIT_WINDOW_MS: '-1',
      RATE_LIMIT_MAX: 'abc',
      RATE_LIMIT_LOGIN_WINDOW_MS: '0',
      RATE_LIMIT_LOGIN_MAX: '',
    });
    expect(fallback).toMatchObject({
      windowMs: 60_000,
      max: 300,
      loginWindowMs: 900_000,
      loginMax: 10,
    });
  });
});

describe('rate limit helpers', () => {
  it('exempts health, docs and the tunnel callback', () => {
    expect(isRateLimitExempt(fakeRequest({ originalUrl: '/api/health' }))).toBe(
      true
    );
    expect(
      isRateLimitExempt(fakeRequest({ originalUrl: '/api/health?probe=1' }))
    ).toBe(true);
    expect(
      isRateLimitExempt(fakeRequest({ originalUrl: '/api/docs/swagger.css' }))
    ).toBe(true);
    expect(
      isRateLimitExempt(fakeRequest({ originalUrl: '/api/internal/tunnel' }))
    ).toBe(true);
    expect(
      isRateLimitExempt(fakeRequest({ originalUrl: '/api/auth/login' }))
    ).toBe(false);
  });

  it('builds the login key from IP and username', () => {
    expect(
      loginRateLimitKey(
        fakeRequest({ ip: '203.0.113.5', body: { username: '  Admin ' } })
      )
    ).toBe('203.0.113.5|admin');

    expect(loginRateLimitKey(fakeRequest({ ip: '203.0.113.5' }))).toBe(
      '203.0.113.5|'
    );
    expect(
      loginRateLimitKey(
        fakeRequest({ ip: '203.0.113.5', body: { username: 42 } })
      )
    ).toBe('203.0.113.5|');
  });
});
