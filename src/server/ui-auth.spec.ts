import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isUiAuthEnabled,
  parseBasicAuth,
  uiAuthMiddleware,
} from './ui-auth.js';

/**
 * Unit tests for the optional HTTP Basic Auth gate in front of the Angular UI.
 */

interface CapturedResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

function captureResponse(): { res: Response; captured: CapturedResponse } {
  const captured: CapturedResponse = {
    statusCode: 200,
    body: undefined,
    headers: {},
  };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return res;
    },
    type() {
      return res;
    },
    send(payload: unknown) {
      captured.body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, captured };
}

function makeRequest(authorization?: string): Request {
  return {
    header(name: string) {
      return name.toLowerCase() === 'authorization' ? authorization : undefined;
    },
  } as unknown as Request;
}

function captureNext(): { next: NextFunction; called: () => boolean } {
  let calls = 0;
  const next = (() => {
    calls += 1;
  }) as NextFunction;
  return { next, called: () => calls > 0 };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseBasicAuth', () => {
  it('parses valid headers and rejects malformed values', () => {
    const encoded = Buffer.from('usuario:clave:con:dos:puntos').toString(
      'base64'
    );
    expect(parseBasicAuth(`Basic ${encoded}`)).toEqual({
      user: 'usuario',
      password: 'clave:con:dos:puntos',
    });
    expect(parseBasicAuth(undefined)).toBeNull();
    expect(parseBasicAuth('Bearer token')).toBeNull();
    expect(
      parseBasicAuth(`Basic ${Buffer.from('sin-dos-puntos').toString('base64')}`)
    ).toBeNull();
  });
});

describe('uiAuthMiddleware', () => {
  it('is a no-op when UI protection is disabled', () => {
    const { res } = captureResponse();
    const { next, called } = captureNext();
    uiAuthMiddleware()(makeRequest(), res, next);
    expect(called()).toBe(true);
    expect(isUiAuthEnabled()).toBe(false);
  });

  it('fails closed when credentials are missing', () => {
    vi.stubEnv('UI_AUTH_ENABLED', 'true');
    vi.stubEnv('UI_AUTH_USER', '');
    vi.stubEnv('UI_AUTH_PASSWORD', '');
    const { res, captured } = captureResponse();
    const { next, called } = captureNext();

    uiAuthMiddleware()(makeRequest(), res, next);

    expect(called()).toBe(false);
    expect(captured.statusCode).toBe(503);
    expect(String(captured.body)).toContain('UI_AUTH_USER');
  });

  it('challenges requests without or with invalid credentials', () => {
    vi.stubEnv('UI_AUTH_ENABLED', 'true');
    vi.stubEnv('UI_AUTH_USER', 'demo');
    vi.stubEnv('UI_AUTH_PASSWORD', 'secreto');

    const anonymous = captureResponse();
    const anonymousNext = captureNext();
    uiAuthMiddleware()(makeRequest(), anonymous.res, anonymousNext.next);
    expect(anonymousNext.called()).toBe(false);
    expect(anonymous.captured.statusCode).toBe(401);
    expect(anonymous.captured.headers['www-authenticate']).toContain(
      'Basic realm="Mermelada ERP"'
    );

    const invalid = captureResponse();
    const invalidNext = captureNext();
    uiAuthMiddleware()(
      makeRequest(`Basic ${Buffer.from('demo:incorrecta').toString('base64')}`),
      invalid.res,
      invalidNext.next
    );
    expect(invalidNext.called()).toBe(false);
    expect(invalid.captured.statusCode).toBe(401);
  });

  it('accepts the configured credentials', () => {
    vi.stubEnv('UI_AUTH_ENABLED', 'true');
    vi.stubEnv('UI_AUTH_USER', 'demo');
    vi.stubEnv('UI_AUTH_PASSWORD', 'secreto');
    const { res } = captureResponse();
    const { next, called } = captureNext();

    uiAuthMiddleware()(
      makeRequest(`Basic ${Buffer.from('demo:secreto').toString('base64')}`),
      res,
      next
    );

    expect(called()).toBe(true);
    expect(isUiAuthEnabled()).toBe(true);
  });
});
