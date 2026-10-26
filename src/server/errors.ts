import type { NextFunction, Request, Response } from 'express';

/**
 * Uniform API error handling.
 *
 * Every error response has the shape:
 *   { error: string, code: string, details?: unknown }
 */

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    status: number,
    message: string,
    code = 'API_ERROR',
    details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, message, 'BAD_REQUEST', details);
}

export function unauthorized(message = 'Autenticación requerida'): ApiError {
  return new ApiError(401, message, 'UNAUTHORIZED');
}

export function forbidden(message = 'No tiene permisos para esta operación'): ApiError {
  return new ApiError(403, message, 'FORBIDDEN');
}

export function notFound(message = 'Recurso no encontrado'): ApiError {
  return new ApiError(404, message, 'NOT_FOUND');
}

/** 404 handler for unknown `/api/*` routes. */
export function apiNotFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
  });
}

/** Central Express error handler: never leaks stack traces to clients. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      ...(err.details === undefined ? {} : { details: err.details }),
    });
    return;
  }

  const message =
    err instanceof Error ? err.message : 'Error interno del servidor';
  res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
}
