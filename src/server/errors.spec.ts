import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  apiNotFoundHandler,
  badRequest,
  errorHandler,
  forbidden,
  notFound,
  unauthorized,
} from './errors.js';

/**
 * Unit tests for the uniform API error helpers.
 *
 * These cover the branches that are hard to reach through the HTTP layer:
 * every factory, the `headersSent` guard and non-`Error` throwables.
 */

interface CapturedResponse {
  statusCode: number;
  body: unknown;
}

function captureResponse(): { res: Response; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: undefined };
  const res = {
    headersSent: false,
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      captured.body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, captured };
}

function captureNext(): { next: NextFunction; errors: unknown[] } {
  const errors: unknown[] = [];
  const next = ((error?: unknown) => {
    errors.push(error);
  }) as NextFunction;
  return { next, errors };
}

describe('error factories', () => {
  it('builds a bad request error with optional details', () => {
    const error = badRequest('Datos inválidos', { field: 'name' });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.message).toBe('Datos inválidos');
    expect(error.details).toEqual({ field: 'name' });
  });

  it('builds unauthorized errors with default and custom messages', () => {
    expect(unauthorized().status).toBe(401);
    expect(unauthorized().code).toBe('UNAUTHORIZED');
    expect(unauthorized().message).toBe('Autenticación requerida');
    expect(unauthorized('Token vencido').message).toBe('Token vencido');
  });

  it('builds forbidden errors with default and custom messages', () => {
    expect(forbidden().status).toBe(403);
    expect(forbidden().code).toBe('FORBIDDEN');
    expect(forbidden().message).toBe('No tiene permisos para esta operación');
    expect(forbidden('Sin acceso').message).toBe('Sin acceso');
  });

  it('builds not-found errors with default and custom messages', () => {
    expect(notFound().status).toBe(404);
    expect(notFound().code).toBe('NOT_FOUND');
    expect(notFound().message).toBe('Recurso no encontrado');
    expect(notFound('Proveedor no encontrado').message).toBe('Proveedor no encontrado');
  });
});

describe('apiNotFoundHandler', () => {
  it('reports the method and original URL', () => {
    const { res, captured } = captureResponse();
    apiNotFoundHandler(
      {
        method: 'PATCH',
        originalUrl: '/api/unknown?x=1',
      } as unknown as Request,
      res
    );

    expect(captured.statusCode).toBe(404);
    expect(captured.body).toEqual({
      error: 'Ruta no encontrada: PATCH /api/unknown?x=1',
      code: 'NOT_FOUND',
    });
  });
});

describe('errorHandler', () => {
  it('delegates to next when the response was already sent', () => {
    const { res } = captureResponse();
    res.headersSent = true;
    const { next, errors } = captureNext();
    const failure = new Error('boom');

    errorHandler(failure, {} as Request, res, next);

    expect(errors).toEqual([failure]);
  });

  it('serializes ApiError responses including details', () => {
    const { res, captured } = captureResponse();
    const { next } = captureNext();

    errorHandler(
      new ApiError(422, 'Payload inválido', 'VALIDATION_ERROR', { field: 'email' }),
      {} as Request,
      res,
      next
    );

    expect(captured.statusCode).toBe(422);
    expect(captured.body).toEqual({
      error: 'Payload inválido',
      code: 'VALIDATION_ERROR',
      details: { field: 'email' },
    });
  });

  it('omits the details property when the ApiError has none', () => {
    const { res, captured } = captureResponse();
    const { next } = captureNext();

    errorHandler(new ApiError(409, 'Conflicto'), {} as Request, res, next);

    expect(captured.body).toEqual({ error: 'Conflicto', code: 'API_ERROR' });
  });

  it('maps generic errors to a 500 response without leaking the stack', () => {
    const { res, captured } = captureResponse();
    const { next } = captureNext();

    errorHandler(new Error('SQLite is locked'), {} as Request, res, next);

    expect(captured.statusCode).toBe(500);
    expect(captured.body).toEqual({
      error: 'SQLite is locked',
      code: 'INTERNAL_ERROR',
    });
  });

  it('uses a generic message for non-Error throwables', () => {
    const { res, captured } = captureResponse();
    const { next } = captureNext();

    errorHandler('unexpected', {} as Request, res, next);

    expect(captured.statusCode).toBe(500);
    expect(captured.body).toEqual({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR',
    });
  });
});
