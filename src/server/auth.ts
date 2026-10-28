import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getDb } from './database/persistence.js';

/**
 * Basic authentication and role-based authorization.
 *
 * Enabled with `AUTH_ENABLED=true`. When disabled (default for local/demo use)
 * the API keeps working without credentials, but the login endpoints are still
 * available so clients can obtain a token.
 */

export type RoleId =
  | 'admin'
  | 'supervisor_planta'
  | 'operator'
  | 'analista_costos'
  | 'almacenista';

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'export';

export type ModuleId =
  | 'dashboard'
  | 'inventory'
  | 'production'
  | 'costing'
  | 'sales'
  | 'payroll'
  | 'expenses'
  | 'suppliers'
  | 'settings'
  | 'architecture';

export type ModulePermissions = Record<PermissionAction, boolean>;

const full: ModulePermissions = {
  view: true,
  create: true,
  edit: true,
  delete: true,
  export: true,
};
const read: ModulePermissions = {
  view: true,
  create: false,
  edit: false,
  delete: false,
  export: false,
};
const readExport: ModulePermissions = {
  view: true,
  create: false,
  edit: false,
  delete: false,
  export: true,
};
const write: ModulePermissions = {
  view: true,
  create: true,
  edit: true,
  delete: false,
  export: true,
};
const none: ModulePermissions = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  export: false,
};

export const ROLE_PERMISSIONS: Record<RoleId, Record<ModuleId, ModulePermissions>> = {
  admin: {
    dashboard: full,
    inventory: full,
    production: full,
    costing: full,
    sales: full,
    payroll: full,
    expenses: full,
    suppliers: full,
    settings: full,
    architecture: full,
  },
  supervisor_planta: {
    dashboard: readExport,
    inventory: write,
    production: write,
    costing: read,
    sales: read,
    payroll: read,
    expenses: none,
    suppliers: readExport,
    settings: none,
    architecture: read,
  },
  operator: {
    dashboard: read,
    inventory: none,
    production: write,
    costing: none,
    sales: none,
    payroll: none,
    expenses: none,
    suppliers: none,
    settings: none,
    architecture: none,
  },
  analista_costos: {
    dashboard: readExport,
    inventory: { view: true, create: false, edit: true, delete: false, export: true },
    production: read,
    costing: write,
    sales: readExport,
    payroll: read,
    expenses: write,
    suppliers: write,
    settings: none,
    architecture: read,
  },
  almacenista: {
    dashboard: read,
    inventory: write,
    production: read,
    costing: none,
    sales: { view: true, create: true, edit: false, delete: false, export: true },
    payroll: none,
    expenses: none,
    suppliers: write,
    settings: none,
    architecture: read,
  },
};

export interface AuthUserRecord {
  id: string;
  username: string;
  email: string;
  full_name: string;
  national_id: string | null;
  password_hash: string;
  role_id: RoleId;
  department: string | null;
  status: string;
  created_at: string;
  password_changed_at: string | null;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  nationalId?: string;
  roleId: RoleId;
  department?: string;
  status: string;
  createdAt: string;
}

export interface TokenPayload {
  sub: string;
  username: string;
  role: RoleId;
  iat: number;
  exp: number;
}

export interface AuthenticatedUser {
  token: TokenPayload;
  user: AuthUser;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthenticatedUser;
  }
}

const DEFAULT_SEED_PASSWORD = 'mermelada123';
const DEFAULT_TOKEN_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_SECRET = 'mermelada-dev-secret-change-me';

interface SeedUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  nationalId: string;
  roleId: RoleId;
  department: string;
}

const SEED_USERS: SeedUser[] = [
  {
    id: 'usr-admin',
    username: 'admin',
    email: 'admin@pulpacraft.local',
    fullName: 'Felipe Velazco',
    nationalId: 'V-18.490.231',
    roleId: 'admin',
    department: 'Dirección General',
  },
  {
    id: 'usr-supervisor',
    username: 'supervisor',
    email: 'supervisor@pulpacraft.local',
    fullName: 'Hermes Rodríguez',
    nationalId: 'V-14.882.102',
    roleId: 'supervisor_planta',
    department: 'Producción & Cocción',
  },
  {
    id: 'usr-operador',
    username: 'operador',
    email: 'operador@pulpacraft.local',
    fullName: 'Denis Briceño',
    nationalId: 'V-20.119.456',
    roleId: 'operator',
    department: 'Planta de Elaboración & Cocción',
  },
  {
    id: 'usr-costos',
    username: 'costos',
    email: 'costos@pulpacraft.local',
    fullName: 'Daniela Silva',
    nationalId: 'V-22.340.890',
    roleId: 'analista_costos',
    department: 'Finanzas & Costos',
  },
  {
    id: 'usr-almacen',
    username: 'almacen',
    email: 'almacen@pulpacraft.local',
    fullName: 'Luis Morales',
    nationalId: 'V-17.552.310',
    roleId: 'almacenista',
    department: 'Almacén & Despachos',
  },
];

/** Hash a password with a random salt using Node's scrypt implementation. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

/** Verify a password against a stored `salt:hash` value. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;

  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;

  return timingSafeEqual(candidate, expected);
}

export function isAuthEnabled(): boolean {
  return process.env['AUTH_ENABLED'] === 'true';
}

function getSecret(): string {
  return process.env['AUTH_SECRET'] || DEFAULT_SECRET;
}

function getTokenTtlSeconds(): number {
  const raw = Number(process.env['AUTH_TOKEN_TTL_SECONDS']);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TOKEN_TTL_SECONDS;
}

function getResetTtlSeconds(): number {
  const raw = Number(process.env['AUTH_RESET_TTL_SECONDS']);
  return Number.isFinite(raw) && raw > 0 ? raw : 30 * 60;
}

function toPublicUser(row: AuthUserRecord): AuthUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    nationalId: row.national_id ?? undefined,
    roleId: row.role_id,
    department: row.department ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** Insert the demo users if the auth table is empty. Idempotent. */
export function ensureSeedUsers(): void {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS count FROM auth_users').get() as {
    count: number;
  };
  if (row.count > 0) return;

  const password = process.env['AUTH_SEED_PASSWORD'] || DEFAULT_SEED_PASSWORD;
  const createdAt = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO auth_users (
      id, username, email, full_name, national_id, password_hash,
      role_id, department, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?)
  `);

  const seed = db.transaction(() => {
    for (const user of SEED_USERS) {
      insert.run(
        user.id,
        user.username,
        user.email,
        user.fullName,
        user.nationalId,
        hashPassword(password),
        user.roleId,
        user.department,
        createdAt
      );
    }
  });
  seed();
}

export function findUserByUsername(username: string): AuthUserRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM auth_users WHERE username = ?')
    .get(username) as AuthUserRecord | undefined;
}

export function findUserById(id: string): AuthUserRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM auth_users WHERE id = ?')
    .get(id) as AuthUserRecord | undefined;
}

export function findUserByIdentifier(identifier: string): AuthUserRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM auth_users WHERE username = ? OR lower(email) = lower(?)')
    .get(identifier, identifier) as AuthUserRecord | undefined;
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create a single-use password reset token. Returns the raw token so the API
 * can deliver it (SMTP in production, devToken in non-production).
 */
export function requestPasswordReset(
  identifier: string
): { token: string; user: AuthUserRecord } | null {
  const user = findUserByIdentifier(identifier.trim());
  if (!user || user.status !== 'activo') return null;

  const db = getDb();
  const now = new Date();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(now.getTime() + getResetTtlSeconds() * 1000);

  const create = db.transaction(() => {
    // Invalidate any previous unused token.
    db.prepare(
      'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL'
    ).run(now.toISOString(), user.id);
    db.prepare(
      `INSERT INTO password_reset_tokens
        (id, user_id, token_hash, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).run(
      'prt-' + randomBytes(8).toString('hex'),
      user.id,
      hashResetToken(token),
      expiresAt.toISOString(),
      now.toISOString()
    );
  });
  create();

  return { token, user };
}

/** Consume a reset token and set a new password. */
export function confirmPasswordReset(
  token: string,
  newPassword: string
): AuthUserRecord | null {
  const db = getDb();
  const now = new Date();
  const row = db
    .prepare(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`
    )
    .get(hashResetToken(token), now.toISOString()) as
    | { id: string; user_id: string }
    | undefined;
  if (!row) return null;

  const user = findUserById(row.user_id);
  if (!user || user.status !== 'activo') return null;

  const apply = db.transaction(() => {
    db.prepare(
      'UPDATE auth_users SET password_hash = ?, password_changed_at = ? WHERE id = ?'
    ).run(hashPassword(newPassword), now.toISOString(), user.id);
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(
      now.toISOString(),
      row.id
    );
    // Any other outstanding reset token is no longer valid.
    db.prepare(
      'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL'
    ).run(now.toISOString(), user.id);
  });
  apply();

  return user;
}

/** Create a signed token: `base64url(payload).base64url(hmac)`. */
export function signToken(user: AuthUserRecord, ttlSeconds = getTokenTtlSeconds()): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: user.id,
    username: user.username,
    role: user.role_id,
    iat: now,
    exp: now + ttlSeconds,
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', getSecret())
    .update(encoded)
    .digest('base64url');

  return `${encoded}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = createHmac('sha256', getSecret())
    .update(encoded)
    .digest('base64url');
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    provided.length !== expectedBuffer.length ||
    !timingSafeEqual(provided, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as TokenPayload;
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function unauthorized(res: Response, message: string): void {
  res.status(401).json({ error: message, code: 'UNAUTHORIZED' });
}

const PUBLIC_PATHS = [
  /^\/api\/health$/,
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/reset-password$/,
  /^\/api\/auth\/reset-password\/confirm$/,
  /^\/api\/openapi\.json$/,
  /^\/api\/docs(?:\/.*)?$/,
];

/**
 * Full request path (mount-independent). `req.path` is relative when the
 * middleware is mounted below `/api`, so use `originalUrl` instead.
 */
export function apiPath(req: Request): string {
  return (req.originalUrl || req.url || '').split('?')[0];
}

function isPublicPath(req: Request): boolean {
  const path = apiPath(req);
  return PUBLIC_PATHS.some((pattern) => pattern.test(path));
}

/** Express middleware: validates the bearer token when auth is enabled. */
export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isAuthEnabled()) {
    next();
    return;
  }

  // Health, login and API documentation stay public.
  if (!apiPath(req).startsWith('/api/') || isPublicPath(req)) {
    next();
    return;
  }

  const header = req.header('authorization') ?? '';
  if (!header.startsWith('Bearer ')) {
    unauthorized(res, 'Token de autenticación requerido');
    return;
  }

  const payload = verifyToken(header.slice('Bearer '.length));
  if (!payload) {
    unauthorized(res, 'Token inválido o expirado');
    return;
  }

  const record = findUserById(payload.sub);
  if (!record || record.status !== 'activo') {
    unauthorized(res, 'Usuario no encontrado o inactivo');
    return;
  }

  // Tokens issued before the last password change are no longer valid.
  if (record.password_changed_at) {
    const changedAt = Math.floor(Date.parse(record.password_changed_at) / 1000);
    if (Number.isFinite(changedAt) && payload.iat < changedAt) {
      unauthorized(res, 'Token inválido o expirado');
      return;
    }
  }

  req.auth = { token: payload, user: toPublicUser(record) };
  next();
}

/**
 * Restrict a route to the given roles. In demo mode (AUTH_ENABLED=false)
 * there is no server-side session, so the active role simulated by the
 * frontend is read from `X-Demo-Role` to keep administrator-only rules
 * enforceable during functional testing.
 */
export function requireRole(...roles: RoleId[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isAuthEnabled()) {
      const role = req.auth?.user.roleId;
      if (!role || !roles.includes(role)) {
        res.status(403).json({
          error: `Esta operación requiere uno de los roles: ${roles.join(', ')}`,
          code: 'FORBIDDEN',
          details: { requiredRoles: roles },
        });
        return;
      }
      next();
      return;
    }

    const demoRole = (req.header('x-demo-role') || 'admin') as RoleId;
    if (!roles.includes(demoRole)) {
      res.status(403).json({
        error: `Esta operación requiere uno de los roles: ${roles.join(', ')}`,
        code: 'FORBIDDEN',
        details: { requiredRoles: roles, demoRole },
      });
      return;
    }
    next();
  };
}

/** Shorthand for administrator-only endpoints. */
export const requireAdmin = requireRole('admin');

function resolveModule(path: string): ModuleId | null {
  if (path.startsWith('/api/inventory')) return 'inventory';
  if (path.startsWith('/api/recipes')) return 'production';
  if (path.startsWith('/api/production-orders')) return 'production';
  if (path.startsWith('/api/sales')) return 'sales';
  if (path.startsWith('/api/suppliers')) return 'suppliers';
  if (path.startsWith('/api/banks')) return 'expenses';
  if (path.startsWith('/api/payroll')) return 'payroll';
  if (path.startsWith('/api/costing')) return 'costing';
  if (path.startsWith('/api/expenses')) return 'expenses';
  if (path.startsWith('/api/fiscal-settings')) return 'settings';
  if (path.startsWith('/api/exchange-rates')) return 'settings';
  if (path.startsWith('/api/reports')) return 'dashboard';
  if (path.startsWith('/api/audit-logs')) return 'dashboard';
  return null;
}

function resolveAction(req: Request): PermissionAction {
  if (req.method === 'GET' || req.method === 'HEAD') return 'view';
  if (req.method === 'DELETE') return 'delete';
  if (req.method === 'PUT' || req.method === 'PATCH') return 'edit';
  if (req.method === 'POST') {
    if (/\/(process|refresh|update|status|collect|annul)$/.test(apiPath(req))) return 'edit';
    return 'create';
  }
  return 'view';
}

/** Express middleware: checks module permissions for the current role. */
export function authorizeRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isAuthEnabled()) {
    next();
    return;
  }

  if (!apiPath(req).startsWith('/api/')) {
    next();
    return;
  }

  if (isPublicPath(req)) {
    next();
    return;
  }

  if (apiPath(req) === '/api/auth/me') {
    next();
    return;
  }

  const auth = req.auth;
  if (!auth) {
    unauthorized(res, 'Autenticación requerida');
    return;
  }

  // Demo reset is reserved for administrators.
  if (apiPath(req) === '/api/system/reset' && auth.user.roleId !== 'admin') {
    res.status(403).json({
      error: 'Solo un administrador puede reiniciar los datos',
      code: 'FORBIDDEN',
    });
    return;
  }

  const module = resolveModule(apiPath(req));
  if (!module) {
    next();
    return;
  }

  const action = resolveAction(req);
  const permissions = ROLE_PERMISSIONS[auth.user.roleId]?.[module];
  if (!permissions || !permissions[action]) {
    res.status(403).json({
      error: `El rol ${auth.user.roleId} no tiene permiso '${action}' sobre '${module}'`,
      code: 'FORBIDDEN',
      details: { module, action },
    });
    return;
  }

  next();
}

/** POST /api/auth/login handler. */
export function loginHandler(req: Request, res: Response): void {
  const username =
    typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const record = username ? findUserByUsername(username) : undefined;
  if (!record || record.status !== 'activo' || !verifyPassword(password, record.password_hash)) {
    unauthorized(res, 'Usuario o contraseña incorrectos');
    return;
  }

  const token = signToken(record);
  res.json({
    token,
    tokenType: 'Bearer',
    expiresIn: getTokenTtlSeconds(),
    user: toPublicUser(record),
  });
}

/** GET /api/auth/me handler. */
export function meHandler(req: Request, res: Response): void {
  if (!req.auth) {
    unauthorized(res, 'Autenticación requerida');
    return;
  }
  res.json(req.auth.user);
}

/** POST /api/auth/logout handler. Tokens are stateless, so the client discards it. */
export function logoutHandler(req: Request, res: Response): void {
  res.json({
    success: true,
    message: 'Sesión cerrada correctamente',
    user: req.auth?.user?.username ?? null,
  });
}

/** POST /api/auth/reset-password handler. */
export function resetPasswordHandler(req: Request, res: Response): void {
  const identifier =
    typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';

  // Always answer with the same message to avoid account enumeration.
  const result = identifier ? requestPasswordReset(identifier) : null;

  const body: Record<string, unknown> = {
    success: true,
    message:
      'Si el usuario o correo existe, recibirás instrucciones para restablecer la contraseña.',
  };

  // In non-production environments the token is returned to enable the
  // recovery flow before SMTP is configured.
  const exposeToken =
    (process.env['AUTH_RESET_EXPOSE_TOKEN'] === 'true' ||
      process.env['NODE_ENV'] !== 'production') &&
    result;
  if (exposeToken) {
    body['devToken'] = result.token;
    body['expiresInSeconds'] = getResetTtlSeconds();
  }

  res.json(body);
}

/** POST /api/auth/reset-password/confirm handler. */
export function confirmResetPasswordHandler(req: Request, res: Response): void {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const newPassword =
    typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  const user = token && newPassword ? confirmPasswordReset(token, newPassword) : null;
  if (!user) {
    res.status(400).json({
      error: 'El enlace de recuperación es inválido o ha expirado',
      code: 'INVALID_RESET_TOKEN',
    });
    return;
  }

  res.json({
    success: true,
    message: 'Contraseña actualizada correctamente. Inicia sesión con tu nueva contraseña.',
    user: toPublicUser(user),
  });
}
