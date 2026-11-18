import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicenseSnapshot } from './license.js';

/**
 * Tests for the Express middleware that turns an expired or suspended license
 * into a read-only API. The license module is mocked so every branch of the
 * middleware can be exercised without touching SQLite.
 */

const licenseMocks = vi.hoisted(() => ({
  isLicenseEnabled: vi.fn(),
  touchLicense: vi.fn(),
  getLicenseSnapshot: vi.fn(),
}));

vi.mock('./license.js', () => ({
  isLicenseEnabled: licenseMocks.isLicenseEnabled,
  touchLicense: licenseMocks.touchLicense,
  getLicenseSnapshot: licenseMocks.getLicenseSnapshot,
}));

import { licenseGuard } from './license-guard.js';

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

function fakeRequest(method: string, path: string): Request {
  return { method, path } as unknown as Request;
}

function run(
  method: string,
  path: string
): { response: FakeResponse; next: ReturnType<typeof vi.fn> } {
  const response = fakeResponse();
  const next = vi.fn();
  licenseGuard()(
    fakeRequest(method, path),
    response.res,
    next as unknown as NextFunction
  );
  return { response, next };
}

function snapshot(overrides: Partial<LicenseSnapshot> = {}): LicenseSnapshot {
  return {
    enabled: true,
    licenseId: 'erp-test',
    status: 'activa',
    holder: 'ACME',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-12-01T00:00:00.000Z',
    graceDays: 7,
    daysRemaining: 14,
    mode: 'normal',
    readOnly: false,
    maxDays: 30,
    alertDays: 3,
    clockTampered: false,
    updatedAt: '2026-11-17T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  licenseMocks.isLicenseEnabled.mockReset();
  licenseMocks.touchLicense.mockReset();
  licenseMocks.getLicenseSnapshot.mockReset();
  licenseMocks.isLicenseEnabled.mockReturnValue(true);
  licenseMocks.getLicenseSnapshot.mockReturnValue(snapshot());
});

describe('licenseGuard', () => {
  it('lets every request through when the license system is disabled', () => {
    licenseMocks.isLicenseEnabled.mockReturnValue(false);
    const { response, next } = run('POST', '/api/sales/orders');

    expect(next).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(200);
    expect(response.headers).toEqual({});
    expect(licenseMocks.getLicenseSnapshot).not.toHaveBeenCalled();
  });

  it('allows writes and exposes the license headers when the license is valid', () => {
    const { response, next } = run('POST', '/api/sales/orders');

    expect(next).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-license-mode']).toBe('normal');
    expect(response.headers['x-license-days-remaining']).toBe('14');
    expect(response.headers['x-license-expires-at']).toBe(
      '2026-12-01T00:00:00.000Z'
    );
    expect(licenseMocks.touchLicense).toHaveBeenCalledOnce();
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'allows safe %s requests while the license is read-only',
    (method) => {
      licenseMocks.getLicenseSnapshot.mockReturnValue(
        snapshot({ mode: 'solo_lectura', readOnly: true })
      );
      const { response, next } = run(method, '/api/sales/orders');

      expect(next).toHaveBeenCalledOnce();
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-license-mode']).toBe('solo_lectura');
    }
  );

  it('rejects writes with 402 while the license is read-only', () => {
    licenseMocks.getLicenseSnapshot.mockReturnValue(
      snapshot({
        status: 'suspendida',
        mode: 'solo_lectura',
        readOnly: true,
        clockTampered: true,
        daysRemaining: -3,
      })
    );
    const { response, next } = run('POST', '/api/sales/orders');

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(402);
    expect(response.body).toMatchObject({
      code: 'LICENSE_EXPIRED',
      license: {
        status: 'suspendida',
        mode: 'solo_lectura',
        daysRemaining: -3,
        clockTampered: true,
      },
    });
  });

  it.each([
    ['/api'],
    ['/api/system/license'],
    ['/api/system/license/apply'],
    ['/api/auth/login'],
    ['/api/health'],
    ['/api/docs'],
    ['/api/openapi.json'],
    ['/api/internal/tunnel'],
  ])('keeps %s reachable while read-only', (path) => {
    licenseMocks.getLicenseSnapshot.mockReturnValue(
      snapshot({ mode: 'solo_lectura', readOnly: true })
    );
    const { response, next } = run('POST', path);

    expect(next).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(200);
  });

  it('allows safe reads when the license cannot be read', () => {
    licenseMocks.touchLicense.mockImplementation(() => {
      throw new Error('database locked');
    });
    const { response, next } = run('GET', '/api/sales/orders');

    expect(next).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(200);
  });

  it('allows exempt writes when the license cannot be read', () => {
    licenseMocks.getLicenseSnapshot.mockImplementation(() => {
      throw new Error('database locked');
    });
    const { response, next } = run('POST', '/api/system/license/apply');

    expect(next).toHaveBeenCalledOnce();
    expect(response.statusCode).toBe(200);
  });

  it('fails closed with 503 for writes when the license cannot be read', () => {
    licenseMocks.touchLicense.mockImplementation(() => {
      throw new Error('database locked');
    });
    const { response, next } = run('POST', '/api/sales/orders');

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(503);
    expect(response.body).toMatchObject({
      code: 'LICENSE_UNAVAILABLE',
      error: 'Licencia no disponible: database locked',
    });
  });

  it('uses a generic message when the thrown value is not an Error', () => {
    licenseMocks.touchLicense.mockImplementation(() => {
      throw 'boom';
    });
    const { response } = run('POST', '/api/sales/orders');

    expect(response.statusCode).toBe(503);
    expect(response.body).toMatchObject({
      error: 'Licencia no disponible: No se pudo leer la licencia',
    });
  });
});
