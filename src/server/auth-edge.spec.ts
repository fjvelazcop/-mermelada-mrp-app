import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, setDbPath } from './database/persistence.js';
import type {
  AuthUser,
  AuthUserRecord,
  RoleDto,
  TokenPayload,
} from './auth.js';

/**
 * Branch-focused tests for authentication and RBAC.
 *
 * The HTTP integration suite covers the happy paths; this file exercises the
 * defensive branches (malformed tokens, inactive accounts, protected roles,
 * missing sessions and demo-mode fallbacks) directly against the handlers.
 */

const workDir = mkdtempSync(join(tmpdir(), 'mermelada-auth-edge-'));
const dbPath = join(workDir, 'auth-edge.db');

let auth: typeof import('./auth.js');

interface CapturedResponse {
  statusCode: number;
  body: unknown;
}

interface RequestOptions {
  body?: Record<string, unknown>;
  params?: Record<string, string | string[]>;
  query?: Record<string, unknown>;
  method?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, string>;
  auth?: { token: TokenPayload; user: AuthUser };
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

function makeRequest(options: RequestOptions = {}): Request {
  const headers = options.headers ?? {};
  return {
    body: options.body ?? {},
    params: options.params ?? {},
    query: options.query ?? {},
    method: options.method ?? 'GET',
    originalUrl: options.originalUrl ?? '/api/inventory/raw-materials',
    url: options.url ?? options.originalUrl ?? '/api/inventory/raw-materials',
    auth: options.auth,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

function captureNext(): { next: NextFunction; errors: unknown[]; called: () => boolean } {
  const errors: unknown[] = [];
  const next = ((error?: unknown) => {
    errors.push(error);
  }) as NextFunction;
  return { next, errors, called: () => errors.length > 0 };
}

function bodyOf(captured: CapturedResponse): Record<string, unknown> {
  return captured.body as Record<string, unknown>;
}

function publicUser(record: AuthUserRecord): AuthUser {
  return {
    id: record.id,
    username: record.username,
    email: record.email,
    fullName: record.full_name,
    nationalId: record.national_id ?? undefined,
    roleId: record.role_id,
    department: record.department ?? undefined,
    status: record.status,
    createdAt: record.created_at,
    avatarBg: record.avatar_bg ?? undefined,
  };
}

function seedUser(username: string): AuthUserRecord {
  const user = auth.findUserByUsername(username);
  if (!user) throw new Error(`Seed user not found: ${username}`);
  return user;
}

function authenticated(user: AuthUserRecord): { token: TokenPayload; user: AuthUser } {
  return {
    token: {
      sub: user.id,
      username: user.username,
      role: user.role_id,
      iat: Math.floor(Date.now() / 1000),
      iatMs: Date.now(),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    user: publicUser(user),
  };
}

function signPayload(payload: unknown, secret = 'edge-secret'): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

beforeAll(async () => {
  setDbPath(dbPath);
  process.env['AUTH_ENABLED'] = 'true';
  process.env['AUTH_SECRET'] = 'edge-secret';
  process.env['AUTH_SEED_PASSWORD'] = 'test-password';
  process.env['NODE_ENV'] = 'test';
  delete process.env['AUTH_RESET_EXPOSE_TOKEN'];
  delete process.env['AUTH_TOKEN_TTL_SECONDS'];
  delete process.env['AUTH_RESET_TTL_SECONDS'];

  auth = await import('./auth.js');
  auth.ensureSeedUsers();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe('password hashing', () => {
  it('rejects malformed stored hashes and wrong passwords', () => {
    expect(auth.verifyPassword('secret', 'no-separator')).toBe(false);
    expect(auth.verifyPassword('secret', 'salt:00')).toBe(false);

    const stored = auth.hashPassword('correct-password');
    expect(auth.verifyPassword('correct-password', stored)).toBe(true);
    expect(auth.verifyPassword('wrong-password', stored)).toBe(false);
  });
});

describe('token helpers', () => {
  it('signs and verifies a token with the configured secret', () => {
    const user = seedUser('admin');
    const token = auth.signToken(user);
    const payload = auth.verifyToken(token);

    expect(payload?.sub).toBe(user.id);
    expect(payload?.role).toBe('admin');
    expect(payload?.iatMs).toBeTypeOf('number');
  });

  it('falls back to the default secret when AUTH_SECRET is empty', () => {
    vi.stubEnv('AUTH_SECRET', '');
    const token = auth.signToken(seedUser('admin'));
    expect(auth.verifyToken(token)?.sub).toBe('usr-admin');
  });

  it('rejects malformed, tampered and expired tokens', () => {
    expect(auth.verifyToken('')).toBeNull();
    expect(auth.verifyToken('no-dot')).toBeNull();
    expect(auth.verifyToken(`${Buffer.from('{}').toString('base64url')}.bad`)).toBeNull();

    const user = seedUser('admin');
    expect(auth.verifyToken(auth.signToken(user, -10))).toBeNull();

    const tampered = auth.signToken(user).replace(/.$/, 'x');
    expect(auth.verifyToken(tampered)).toBeNull();
  });

  it('rejects validly signed payloads without required claims or invalid JSON', () => {
    const now = Math.floor(Date.now() / 1000);

    expect(auth.verifyToken(signPayload({ exp: now + 60 }))).toBeNull();
    expect(auth.verifyToken(signPayload({ sub: 'usr-admin' }))).toBeNull();
    expect(auth.verifyToken(signPayload({ sub: 'usr-admin', exp: now - 1 }))).toBeNull();

    const invalidJson = Buffer.from('not-json').toString('base64url');
    const signature = createHmac('sha256', 'edge-secret')
      .update(invalidJson)
      .digest('base64url');
    expect(auth.verifyToken(`${invalidJson}.${signature}`)).toBeNull();
  });

  it('accepts tokens without iatMs and falls back to iat seconds', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signPayload({
      sub: 'usr-admin',
      username: 'admin',
      role: 'admin',
      iat: now,
      exp: now + 60,
    });

    expect(auth.verifyToken(token)?.sub).toBe('usr-admin');
  });
});

describe('API path and token TTL helpers', () => {
  it('resolves originalUrl and falls back to url, stripping the query string', () => {
    expect(auth.apiPath(makeRequest({ originalUrl: '/api/health?x=1' }))).toBe(
      '/api/health'
    );
    expect(
      auth.apiPath(
        makeRequest({ originalUrl: '', url: '/api/auth/login?next=%2F' })
      )
    ).toBe('/api/auth/login');
    expect(auth.apiPath(makeRequest({ originalUrl: '', url: '' }))).toBe('');
  });

  it('uses the default token TTL when the env value is invalid', () => {
    vi.stubEnv('AUTH_TOKEN_TTL_SECONDS', 'not-a-number');
    const { res, captured } = captureResponse();
    auth.loginHandler(
      makeRequest({ body: { username: 'admin', password: 'test-password' } }),
      res
    );
    expect(bodyOf(captured)['expiresIn']).toBe(28800);
  });

  it('honours a valid token TTL in seconds', () => {
    vi.stubEnv('AUTH_TOKEN_TTL_SECONDS', '90');
    const { res, captured } = captureResponse();
    auth.loginHandler(
      makeRequest({ body: { username: 'admin', password: 'test-password' } }),
      res
    );
    expect(bodyOf(captured)['expiresIn']).toBe(90);
  });

  it('uses the default reset TTL when the env value is invalid', () => {
    vi.stubEnv('AUTH_RESET_EXPOSE_TOKEN', 'true');
    vi.stubEnv('AUTH_RESET_TTL_SECONDS', 'nope');
    const { res, captured } = captureResponse();
    auth.resetPasswordHandler(
      makeRequest({ body: { identifier: 'admin' } }),
      res
    );
    expect(bodyOf(captured)['expiresInSeconds']).toBe(1800);
  });

  it('honours a valid reset TTL in seconds', () => {
    vi.stubEnv('AUTH_RESET_EXPOSE_TOKEN', 'true');
    vi.stubEnv('AUTH_RESET_TTL_SECONDS', '120');
    const { res, captured } = captureResponse();
    auth.resetPasswordHandler(
      makeRequest({ body: { identifier: 'admin' } }),
      res
    );
    expect(bodyOf(captured)['expiresInSeconds']).toBe(120);
  });
});

describe('role administration edge cases', () => {
  it('creates roles with default permissions and retrieves them', () => {
    const role = auth.createRole({
      name: 'Rol de Cobertura Uno',
      description: 'Rol creado sin matriz explícita',
      color: 'amber',
    });

    expect(role.permissions['dashboard'].canView).toBe(true);
    expect(role.permissions['architecture'].canView).toBe(true);
    expect(role.permissions['inventory'].canView).toBe(false);
    expect(auth.getRole(role.id)?.name).toBe('Rol de Cobertura Uno');
    expect(auth.getRole('missing-role')).toBeNull();
  });

  it('updates metadata partially and returns null for unknown roles', () => {
    const role = auth.createRole({
      name: 'Rol Metadatos',
      description: 'Descripción original',
      color: 'blue',
    });

    expect(auth.updateRole('missing-role', {})).toBeNull();
    expect(auth.updateRole(role.id, { name: 'Rol Renombrado' })?.name).toBe(
      'Rol Renombrado'
    );
    expect(
      auth.updateRole(role.id, { description: 'Descripción nueva' })?.description
    ).toBe('Descripción nueva');
    expect(auth.updateRole(role.id, { color: 'red' })?.color).toBe('red');
  });

  it('rejects permissions for the admin role, unknown modules and unknown roles', () => {
    expect(auth.updateRolePermissions('missing-role', 'inventory', {})).toBeNull();
    expect(() =>
      auth.updateRolePermissions('admin', 'inventory', { canView: false })
    ).toThrow(/Administrador General/);
    expect(() =>
      auth.updateRolePermissions('operator', 'not-a-module', { canView: true })
    ).toThrow(/no existe/);
  });

  it('persists every permission flag as true and then as false', () => {
    const role = auth.createRole({
      name: 'Rol Flags',
      description: 'Rol para alternar todos los flags',
      color: 'purple',
    });
    const allTrue = {
      canView: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canExport: true,
    };
    const allFalse = {
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canExport: false,
    };

    const enabled = auth.updateRolePermissions(role.id, 'production', allTrue);
    expect(enabled?.permissions['production']).toEqual(allTrue);

    const disabled = auth.updateRolePermissions(role.id, 'production', allFalse);
    expect(disabled?.permissions['production']).toEqual(allFalse);
  });

  it('fills missing permission rows with denied flags and includes extra rows', () => {
    const role = auth.createRole({
      name: 'Rol Huecos',
      description: 'Rol con filas de permisos faltantes',
      color: 'stone',
    });
    const db = getDb();
    db.prepare(
      'DELETE FROM auth_role_permissions WHERE role_id = ? AND module_id = ?'
    ).run(role.id, 'costing');
    db.prepare(
      `INSERT INTO auth_role_permissions
        (role_id, module_id, can_view, can_create, can_edit, can_delete, can_export)
       VALUES (?, 'custom_module', 1, 0, 0, 0, 0)`
    ).run(role.id);

    const matrix = auth.getRolePermissions(role.id);
    expect(matrix?.['costing']).toEqual({
      view: false,
      create: false,
      edit: false,
      delete: false,
      export: false,
    });
    expect(matrix?.['custom_module'].view).toBe(true);
    expect(auth.getRolePermissions('missing-role')).toBeNull();
  });

  it('sorts built-in roles before custom roles and custom roles by creation date', () => {
    const older = auth.createRole({
      name: 'Rol Antiguo',
      description: 'Rol personalizado antiguo',
      color: 'stone',
    });
    const newer = auth.createRole({
      name: 'Rol Nuevo',
      description: 'Rol personalizado nuevo',
      color: 'stone',
    });
    getDb()
      .prepare('UPDATE auth_roles SET created_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', older.id);
    getDb()
      .prepare('UPDATE auth_roles SET created_at = ? WHERE id = ?')
      .run('2100-01-01T00:00:00.000Z', newer.id);

    const ids = auth.listRoles().map((role) => role.id);
    expect(ids.slice(0, 5)).toEqual([
      'admin',
      'supervisor_planta',
      'operator',
      'analista_costos',
      'almacenista',
    ]);
    expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(newer.id));
  });

  it('protects system and assigned roles and deletes unused custom roles', () => {
    expect(auth.deleteRole('missing-role')).toBe(false);
    expect(() => auth.deleteRole('operator')).toThrow(/roles base/);

    const role = auth.createRole({
      name: 'Rol Asignado',
      description: 'Rol con un usuario asignado',
      color: 'emerald',
    });
    const user = auth.createUser({
      fullName: 'Usuario Asignado',
      username: 'assigned-user',
      email: 'assigned-user@pulpacraft.local',
      roleId: role.id,
    });
    expect(() => auth.deleteRole(role.id)).toThrow(/asignado/);

    auth.deleteUser(user.id);
    expect(auth.deleteRole(role.id)).toBe(true);
  });
});

describe('user administration edge cases', () => {
  it('validates role existence, usernames and duplicates', () => {
    expect(() =>
      auth.createUser({
        fullName: 'Sin Rol',
        username: 'sin-rol',
        email: 'sin-rol@pulpacraft.local',
        roleId: 'missing-role',
      })
    ).toThrow(/no existe/);

    expect(() =>
      auth.createUser({
        fullName: 'Sin Nombre',
        username: '   ',
        email: 'sin-nombre@pulpacraft.local',
        roleId: 'operator',
      })
    ).toThrow(/obligatorio/);

    expect(() =>
      auth.createUser({
        fullName: 'Duplicado',
        username: 'admin',
        email: 'duplicado@pulpacraft.local',
        roleId: 'operator',
      })
    ).toThrow(/ya está registrado/);
  });

  it('applies status, avatar and optional field fallbacks', () => {
    const custom = auth.createRole({
      name: 'Rol Sin Color',
      description: 'Rol sin color de avatar por defecto',
      color: 'stone',
    });

    const withoutOptionals = auth.createUser({
      fullName: 'Usuario Mínimo',
      username: 'minimal-user',
      email: 'minimal-user@pulpacraft.local',
      nationalId: '',
      department: '',
      roleId: custom.id,
    });
    expect(withoutOptionals.nationalId).toBeUndefined();
    expect(withoutOptionals.department).toBeUndefined();
    expect(withoutOptionals.avatarBg).toBe('bg-stone-900');

    const inactive = auth.createUser({
      fullName: 'Usuario Inactivo',
      username: 'inactive-user',
      email: 'inactive-user@pulpacraft.local',
      nationalId: 'V-1',
      department: 'Calidad',
      status: 'inactivo',
      avatarBg: 'bg-emerald-600',
      roleId: 'operator',
    });
    expect(inactive.status).toBe('inactivo');
    expect(inactive.avatarBg).toBe('bg-emerald-600');

    const operator = auth.createUser({
      fullName: 'Operador Nuevo',
      username: 'operator-avatar',
      email: 'operator-avatar@pulpacraft.local',
      roleId: 'operator',
    });
    expect(operator.avatarBg).toBe('bg-blue-600');
  });

  it('uses the environment seed password and then the default one', () => {
    vi.stubEnv('AUTH_SEED_PASSWORD', 'env-password-123');
    const fromEnv = auth.createUser({
      fullName: 'Clave de Entorno',
      username: 'env-password-user',
      email: 'env-password@pulpacraft.local',
      roleId: 'operator',
    });
    expect(auth.verifyPassword('env-password-123', auth.findUserById(fromEnv.id)!.password_hash)).toBe(true);

    vi.stubEnv('AUTH_SEED_PASSWORD', '');
    const fromDefault = auth.createUser({
      fullName: 'Clave por Defecto',
      username: 'default-password-user',
      email: 'default-password@pulpacraft.local',
      roleId: 'operator',
    });
    expect(auth.verifyPassword('mermelada123', auth.findUserById(fromDefault.id)!.password_hash)).toBe(true);
  });

  it('rejects invalid updates and preserves omitted fields', () => {
    expect(auth.updateUser('missing-user', {})).toBeNull();

    const user = auth.createUser({
      fullName: 'Usuario Editable',
      username: 'editable-user',
      email: 'editable@pulpacraft.local',
      nationalId: 'V-123',
      department: 'Planta',
      roleId: 'operator',
    });

    expect(() => auth.updateUser(user.id, { roleId: 'missing-role' })).toThrow(/no existe/);
    expect(() => auth.updateUser(user.id, { username: '   ' })).toThrow(/obligatorio/);
    expect(() => auth.updateUser(user.id, { username: 'admin' })).toThrow(/ya está registrado/);

    const unchanged = auth.updateUser(user.id, {});
    expect(unchanged?.nationalId).toBe('V-123');
    expect(unchanged?.department).toBe('Planta');

    const cleared = auth.updateUser(user.id, {
      fullName: 'Usuario Editado',
      email: 'edited@pulpacraft.local',
      nationalId: '',
      department: '',
      avatarBg: 'bg-red-600',
      status: 'inactivo',
      username: 'edited-user',
    });
    expect(cleared?.nationalId).toBeUndefined();
    expect(cleared?.department).toBeUndefined();
    expect(cleared?.avatarBg).toBe('bg-red-600');
    expect(cleared?.status).toBe('inactivo');

    const rotated = auth.updateUser(user.id, { password: 'rotated-pass-123' });
    expect(rotated?.id).toBe(user.id);
    expect(
      auth.verifyPassword(
        'rotated-pass-123',
        auth.findUserById(user.id)!.password_hash
      )
    ).toBe(true);
  });

  it('protects the last active administrator and deletes other users', () => {
    expect(auth.deleteUser('missing-user')).toBe(false);
    expect(() => auth.deleteUser('usr-admin')).toThrow(/último administrador/);

    const secondAdmin = auth.createUser({
      fullName: 'Administrador Temporal',
      username: 'temp-admin',
      email: 'temp-admin@pulpacraft.local',
      roleId: 'admin',
    });
    expect(auth.deleteUser(secondAdmin.id)).toBe(true);

    const operator = auth.createUser({
      fullName: 'Operador Borrable',
      username: 'deletable-operator',
      email: 'deletable-operator@pulpacraft.local',
      roleId: 'operator',
    });
    expect(auth.deleteUser(operator.id)).toBe(true);
  });

  it('resolves missing role names and avatar defaults gracefully', () => {
    const user = auth.createUser({
      fullName: 'Usuario Sin Rol Real',
      username: 'ghost-role-user',
      email: 'ghost-role@pulpacraft.local',
      roleId: 'operator',
    });
    const db = getDb();
    db.prepare('UPDATE auth_users SET role_id = ?, avatar_bg = NULL WHERE id = ?').run(
      'ghost-role',
      user.id
    );

    const listed = auth.listUsers().find((entry) => entry.id === user.id);
    expect(listed?.roleName).toBeUndefined();
    expect(listed?.avatarBg).toBeUndefined();

    auth.deleteUser(user.id);
  });
});

describe('password reset and change flows', () => {
  it('ignores unknown and inactive accounts when requesting a reset', () => {
    expect(auth.requestPasswordReset('does-not-exist')).toBeNull();
    expect(auth.requestPasswordReset(seedUser('admin').email.toUpperCase())).not.toBeNull();
  });

  it('returns null for expired and orphaned reset tokens', () => {
    expect(auth.confirmPasswordReset('unknown-token', 'new-password-123')).toBeNull();

    const reset = auth.requestPasswordReset('operador');
    expect(reset).not.toBeNull();

    const tokenHash = createHash('sha256').update(reset!.token).digest('hex');
    getDb()
      .prepare('UPDATE password_reset_tokens SET expires_at = ? WHERE token_hash = ?')
      .run('2000-01-01T00:00:00.000Z', tokenHash);

    expect(auth.confirmPasswordReset(reset!.token, 'new-password-123')).toBeNull();
  });

  it('returns null when the reset owner is no longer active', () => {
    const reset = auth.requestPasswordReset('costos');
    expect(reset).not.toBeNull();

    getDb()
      .prepare("UPDATE auth_users SET status = 'inactivo' WHERE id = ?")
      .run(reset!.user.id);

    expect(auth.confirmPasswordReset(reset!.token, 'new-password-123')).toBeNull();

    getDb()
      .prepare("UPDATE auth_users SET status = 'activo' WHERE id = ?")
      .run(reset!.user.id);
  });

  it('reports not-found, inactive and wrong-password changes', () => {
    expect(auth.changePassword('missing-user', 'a', 'new-password-123')).toBe('not_found');

    const inactive = auth.createUser({
      fullName: 'Inactivo Cambio',
      username: 'inactive-change',
      email: 'inactive-change@pulpacraft.local',
      roleId: 'operator',
      status: 'inactivo',
      password: 'initial-password',
    });
    expect(
      auth.changePassword(inactive.id, 'initial-password', 'new-password-123')
    ).toBe('inactive');

    const active = auth.createUser({
      fullName: 'Activo Cambio',
      username: 'active-change',
      email: 'active-change@pulpacraft.local',
      roleId: 'operator',
      password: 'initial-password',
    });
    expect(auth.changePassword(active.id, 'wrong-password', 'new-password-123')).toBe(
      'invalid_password'
    );
    expect(auth.changePassword(active.id, 'initial-password', 'new-password-123')).toBe('ok');
  });
});

describe('authentication handlers', () => {
  it('rejects missing, malformed, unknown, inactive and wrong credentials', () => {
    const inactive = auth.createUser({
      fullName: 'Inactivo Login',
      username: 'inactive-login',
      email: 'inactive-login@pulpacraft.local',
      roleId: 'operator',
      status: 'inactivo',
      password: 'initial-password',
    });
    expect(inactive.status).toBe('inactivo');

    const cases: Record<string, unknown>[] = [
      {},
      { username: 123, password: 456 },
      { username: 'does-not-exist', password: 'whatever' },
      { username: 'inactive-login', password: 'initial-password' },
      { username: 'admin', password: 'wrong-password' },
    ];

    for (const body of cases) {
      const { res, captured } = captureResponse();
      auth.loginHandler(makeRequest({ body }), res);
      expect(captured.statusCode).toBe(401);
      expect(bodyOf(captured)['code']).toBe('UNAUTHORIZED');
    }

    const { res, captured } = captureResponse();
    auth.loginHandler(
      makeRequest({ body: { username: ' admin ', password: 'test-password' } }),
      res
    );
    expect(captured.statusCode).toBe(200);
    expect(bodyOf(captured)['token']).toBeTypeOf('string');
  });

  it('handles /me and logout with and without an authenticated session', () => {
    const anonymous = captureResponse();
    auth.meHandler(makeRequest(), anonymous.res);
    expect(anonymous.captured.statusCode).toBe(401);

    const admin = seedUser('admin');
    const session = authenticated(admin);

    const current = captureResponse();
    auth.meHandler(makeRequest({ auth: session }), current.res);
    expect(bodyOf(current.captured)['username']).toBe('admin');

    const anonymousLogout = captureResponse();
    auth.logoutHandler(makeRequest(), anonymousLogout.res);
    expect(bodyOf(anonymousLogout.captured)['user']).toBeNull();

    const logout = captureResponse();
    auth.logoutHandler(makeRequest({ auth: session }), logout.res);
    expect(bodyOf(logout.captured)['user']).toBe('admin');
  });

  it('returns the same reset response for unknown accounts and controls dev tokens', () => {
    const unknown = captureResponse();
    auth.resetPasswordHandler(
      makeRequest({ body: { identifier: 'does-not-exist' } }),
      unknown.res
    );
    expect(unknown.captured.statusCode).toBe(200);
    expect(bodyOf(unknown.captured)['devToken']).toBeUndefined();

    const empty = captureResponse();
    auth.resetPasswordHandler(makeRequest({ body: { identifier: 123 } }), empty.res);
    expect(empty.captured.statusCode).toBe(200);

    vi.stubEnv('AUTH_RESET_EXPOSE_TOKEN', 'true');
    const exposed = captureResponse();
    auth.resetPasswordHandler(
      makeRequest({ body: { identifier: 'admin' } }),
      exposed.res
    );
    expect(bodyOf(exposed.captured)['devToken']).toBeTypeOf('string');

    vi.stubEnv('AUTH_RESET_EXPOSE_TOKEN', 'false');
    vi.stubEnv('NODE_ENV', 'test');
    const nonProduction = captureResponse();
    auth.resetPasswordHandler(
      makeRequest({ body: { identifier: 'admin' } }),
      nonProduction.res
    );
    expect(bodyOf(nonProduction.captured)['devToken']).toBeTypeOf('string');

    vi.stubEnv('NODE_ENV', 'production');
    const production = captureResponse();
    auth.resetPasswordHandler(
      makeRequest({ body: { identifier: 'admin' } }),
      production.res
    );
    expect(bodyOf(production.captured)['devToken']).toBeUndefined();
  });

  it('validates reset confirmations and consumes valid tokens', () => {
    const missingToken = captureResponse();
    auth.confirmResetPasswordHandler(
      makeRequest({ body: { newPassword: 'new-password-123' } }),
      missingToken.res
    );
    expect(missingToken.captured.statusCode).toBe(400);

    const missingPassword = captureResponse();
    auth.confirmResetPasswordHandler(
      makeRequest({ body: { token: 'some-token-value' } }),
      missingPassword.res
    );
    expect(missingPassword.captured.statusCode).toBe(400);

    const invalid = captureResponse();
    auth.confirmResetPasswordHandler(
      makeRequest({ body: { token: 'invalid-token-value', newPassword: 'new-password-123' } }),
      invalid.res
    );
    expect(invalid.captured.statusCode).toBe(400);

    const reset = auth.requestPasswordReset('almacen');
    expect(reset).not.toBeNull();
    const valid = captureResponse();
    auth.confirmResetPasswordHandler(
      makeRequest({ body: { token: reset!.token, newPassword: 'new-password-123' } }),
      valid.res
    );
    expect(valid.captured.statusCode).toBe(200);
    expect(bodyOf(valid.captured)['success']).toBe(true);
  });

  it('covers every change-password response branch', () => {
    const anonymous = captureResponse();
    auth.changePasswordHandler(makeRequest(), anonymous.res);
    expect(anonymous.captured.statusCode).toBe(401);

    const admin = seedUser('admin');
    const invalid = captureResponse();
    auth.changePasswordHandler(
      makeRequest({
        auth: authenticated(admin),
        body: { currentPassword: 'wrong-password', newPassword: 'new-password-123' },
      }),
      invalid.res
    );
    expect(invalid.captured.statusCode).toBe(400);

    const inactive = auth.createUser({
      fullName: 'Inactivo Handler',
      username: 'inactive-handler',
      email: 'inactive-handler@pulpacraft.local',
      roleId: 'operator',
      status: 'inactivo',
      password: 'initial-password',
    });
    const inactiveResponse = captureResponse();
    auth.changePasswordHandler(
      makeRequest({
        auth: authenticated(inactive),
        body: { currentPassword: 'initial-password', newPassword: 'new-password-123' },
      }),
      inactiveResponse.res
    );
    expect(inactiveResponse.captured.statusCode).toBe(403);

    const missingResponse = captureResponse();
    auth.changePasswordHandler(
      makeRequest({
        auth: authenticated(admin),
        body: { currentPassword: 'x', newPassword: 'new-password-123' },
      }),
      missingResponse.res
    );
    // A valid admin session with a wrong password is a 400; the not-found branch
    // is exercised below with a synthetic id.
    expect(missingResponse.captured.statusCode).toBe(400);

    const orphanSession = {
      ...authenticated(admin),
      user: { ...publicUser(admin), id: 'missing-user' },
    };
    const notFound = captureResponse();
    auth.changePasswordHandler(
      makeRequest({
        auth: orphanSession,
        body: { currentPassword: 'test-password', newPassword: 'new-password-123' },
      }),
      notFound.res
    );
    expect(notFound.captured.statusCode).toBe(401);
  });
});

describe('user and role handlers', () => {
  it('returns 404 for unknown users and roles using array path params', () => {
    const user = captureResponse();
    auth.updateUserHandler(
      makeRequest({ params: { id: 'missing-user' }, body: {} }),
      user.res
    );
    expect(user.captured.statusCode).toBe(404);

    const deletedUser = captureResponse();
    auth.deleteUserHandler(
      makeRequest({ params: { id: 'missing-user' } }),
      deletedUser.res
    );
    expect(deletedUser.captured.statusCode).toBe(404);

    const role = captureResponse();
    auth.updateRoleHandler(
      makeRequest({ params: { id: ['missing-role'] }, body: {} }),
      role.res
    );
    expect(role.captured.statusCode).toBe(404);

    const permissions = captureResponse();
    auth.updateRolePermissionsHandler(
      makeRequest({
        params: { id: 'missing-role' },
        body: { moduleId: 'inventory' },
      }),
      permissions.res
    );
    expect(permissions.captured.statusCode).toBe(404);

    const deletedRole = captureResponse();
    auth.deleteRoleHandler(
      makeRequest({ params: { id: 'missing-role' } }),
      deletedRole.res
    );
    expect(deletedRole.captured.statusCode).toBe(404);
  });

  it('creates, updates, lists and deletes through the HTTP handlers', () => {
    const created = captureResponse();
    auth.createRoleHandler(
      makeRequest({
        body: {
          name: 'Rol Handler',
          description: 'Creado desde el handler',
          color: 'amber',
        },
      }),
      created.res
    );
    expect(created.captured.statusCode).toBe(201);
    const role = bodyOf(created.captured) as unknown as RoleDto;

    const updated = captureResponse();
    auth.updateRoleHandler(
      makeRequest({
        params: { id: [role.id] },
        body: { description: 'Actualizado desde el handler' },
      }),
      updated.res
    );
    expect(updated.captured.statusCode).toBe(200);

    const permissions = captureResponse();
    auth.updateRolePermissionsHandler(
      makeRequest({
        params: { id: role.id },
        body: { moduleId: 'inventory', permissions: { canView: true } },
      }),
      permissions.res
    );
    expect(permissions.captured.statusCode).toBe(200);

    const roles = captureResponse();
    auth.listRolesHandler(makeRequest(), roles.res);
    expect(Array.isArray(roles.captured.body)).toBe(true);

    const deleted = captureResponse();
    auth.deleteRoleHandler(
      makeRequest({ params: { id: role.id } }),
      deleted.res
    );
    expect(deleted.captured.statusCode).toBe(200);

    const createdUser = captureResponse();
    auth.createUserHandler(
      makeRequest({
        body: {
          fullName: 'Usuario Handler',
          username: 'handler-user',
          email: 'handler-user@pulpacraft.local',
          roleId: 'operator',
          password: 'handler-password-123',
        },
      }),
      createdUser.res
    );
    expect(createdUser.captured.statusCode).toBe(201);
    const user = bodyOf(createdUser.captured) as unknown as AuthUser;

    const updatedUser = captureResponse();
    auth.updateUserHandler(
      makeRequest({
        params: { id: [user.id] },
        body: { department: 'Calidad' },
      }),
      updatedUser.res
    );
    expect(updatedUser.captured.statusCode).toBe(200);

    const users = captureResponse();
    auth.listUsersHandler(makeRequest(), users.res);
    expect(Array.isArray(users.captured.body)).toBe(true);

    const deletedUser = captureResponse();
    auth.deleteUserHandler(
      makeRequest({ params: { id: user.id } }),
      deletedUser.res
    );
    expect(deletedUser.captured.statusCode).toBe(200);
  });
});

describe('authentication middleware', () => {
  it('is a no-op when authentication is disabled', () => {
    vi.stubEnv('AUTH_ENABLED', 'false');
    const { res } = captureResponse();
    const { next, called } = captureNext();
    auth.authenticate(makeRequest(), res, next);
    expect(called()).toBe(true);
    expect(auth.isAuthEnabled()).toBe(false);
  });

  it('lets public and non-API paths through', () => {
    const nonApi = captureNext();
    auth.authenticate(
      makeRequest({ originalUrl: '/dashboard' }),
      captureResponse().res,
      nonApi.next
    );
    expect(nonApi.called()).toBe(true);

    const publicPath = captureNext();
    auth.authenticate(
      makeRequest({ originalUrl: '/api/health' }),
      captureResponse().res,
      publicPath.next
    );
    expect(publicPath.called()).toBe(true);

    const docs = captureNext();
    auth.authenticate(
      makeRequest({ originalUrl: '/api/docs/swagger-ui.css' }),
      captureResponse().res,
      docs.next
    );
    expect(docs.called()).toBe(true);
  });

  it('rejects missing, malformed and invalid bearer tokens', () => {
    const missing = captureResponse();
    auth.authenticate(makeRequest(), missing.res, captureNext().next);
    expect(missing.captured.statusCode).toBe(401);

    const basic = captureResponse();
    auth.authenticate(
      makeRequest({ headers: { authorization: 'Basic abc' } }),
      basic.res,
      captureNext().next
    );
    expect(basic.captured.statusCode).toBe(401);

    const invalid = captureResponse();
    auth.authenticate(
      makeRequest({ headers: { authorization: 'Bearer nope' } }),
      invalid.res,
      captureNext().next
    );
    expect(invalid.captured.statusCode).toBe(401);
  });

  it('rejects tokens for missing, inactive and stale-password users', () => {
    const admin = seedUser('admin');
    const missingUser = captureResponse();
    auth.authenticate(
      makeRequest({
        headers: {
          authorization: `Bearer ${auth.signToken({
            ...admin,
            id: 'missing-user',
          })}`,
        },
      }),
      missingUser.res,
      captureNext().next
    );
    expect(missingUser.captured.statusCode).toBe(401);

    const inactive = auth.createUser({
      fullName: 'Inactivo Middleware',
      username: 'inactive-middleware',
      email: 'inactive-middleware@pulpacraft.local',
      roleId: 'operator',
      status: 'inactivo',
      password: 'initial-password',
    });
    const inactiveResponse = captureResponse();
    auth.authenticate(
      makeRequest({
        headers: {
          authorization: `Bearer ${auth.signToken(inactive)}`,
        },
      }),
      inactiveResponse.res,
      captureNext().next
    );
    expect(inactiveResponse.captured.statusCode).toBe(401);

    getDb()
      .prepare('UPDATE auth_users SET password_changed_at = ? WHERE id = ?')
      .run('2100-01-01T00:00:00.000Z', admin.id);
    const stale = captureResponse();
    auth.authenticate(
      makeRequest({
        headers: { authorization: `Bearer ${auth.signToken(admin)}` },
      }),
      stale.res,
      captureNext().next
    );
    expect(stale.captured.statusCode).toBe(401);

    getDb()
      .prepare('UPDATE auth_users SET password_changed_at = ? WHERE id = ?')
      .run('not-a-date', admin.id);
    const invalidDate = captureNext();
    auth.authenticate(
      makeRequest({
        headers: { authorization: `Bearer ${auth.signToken(admin)}` },
      }),
      captureResponse().res,
      invalidDate.next
    );
    expect(invalidDate.called()).toBe(true);

    getDb()
      .prepare('UPDATE auth_users SET password_changed_at = NULL WHERE id = ?')
      .run(admin.id);
  });

  it('authenticates a valid token and supports iat-only payloads', () => {
    const admin = seedUser('admin');
    const request = makeRequest({
      headers: { authorization: `Bearer ${auth.signToken(admin)}` },
    });
    const { next, called } = captureNext();
    auth.authenticate(request, captureResponse().res, next);
    expect(called()).toBe(true);
    expect(request.auth?.user.username).toBe('admin');

    const now = Math.floor(Date.now() / 1000);
    const legacyToken = signPayload({
      sub: admin.id,
      username: admin.username,
      role: admin.role_id,
      iat: now,
      exp: now + 60,
    });
    const legacyRequest = makeRequest({
      headers: { authorization: `Bearer ${legacyToken}` },
    });
    const legacyNext = captureNext();
    auth.authenticate(legacyRequest, captureResponse().res, legacyNext.next);
    expect(legacyNext.called()).toBe(true);
  });
});

describe('role guard middleware', () => {
  it('enforces roles for authenticated sessions', () => {
    const anonymous = captureResponse();
    auth.requireAdmin(makeRequest(), anonymous.res, captureNext().next);
    expect(anonymous.captured.statusCode).toBe(403);

    const operator = seedUser('operador');
    const forbidden = captureResponse();
    auth.requireAdmin(
      makeRequest({ auth: authenticated(operator) }),
      forbidden.res,
      captureNext().next
    );
    expect(forbidden.captured.statusCode).toBe(403);

    const admin = seedUser('admin');
    const allowed = captureNext();
    auth.requireAdmin(
      makeRequest({ auth: authenticated(admin) }),
      captureResponse().res,
      allowed.next
    );
    expect(allowed.called()).toBe(true);
  });

  it('uses X-Demo-Role when authentication is disabled', () => {
    vi.stubEnv('AUTH_ENABLED', 'false');

    const defaultAdmin = captureNext();
    auth.requireAdmin(makeRequest(), captureResponse().res, defaultAdmin.next);
    expect(defaultAdmin.called()).toBe(true);

    const allowed = captureNext();
    auth.requireRole('operator')(
      makeRequest({ headers: { 'x-demo-role': 'operator' } }),
      captureResponse().res,
      allowed.next
    );
    expect(allowed.called()).toBe(true);

    const forbidden = captureResponse();
    auth.requireAdmin(
      makeRequest({ headers: { 'x-demo-role': 'operator' } }),
      forbidden.res,
      captureNext().next
    );
    expect(forbidden.captured.statusCode).toBe(403);
  });
});

describe('module authorization middleware', () => {
  let admin: AuthUserRecord;
  let session: { token: TokenPayload; user: AuthUser };

  beforeAll(() => {
    admin = seedUser('admin');
    session = authenticated(admin);
  });

  it('is a no-op when authentication is disabled', () => {
    vi.stubEnv('AUTH_ENABLED', 'false');
    const { next, called } = captureNext();
    auth.authorizeRequest(makeRequest(), captureResponse().res, next);
    expect(called()).toBe(true);
  });

  it('skips non-API paths, public routes and /me', () => {
    for (const originalUrl of [
      '/dashboard',
      '/api/health',
      '/api/auth/login',
      '/api/auth/reset-password',
      '/api/auth/reset-password/confirm',
      '/api/openapi.json',
      '/api/docs/index.html',
      '/api/auth/me',
    ]) {
      const { next, called } = captureNext();
      auth.authorizeRequest(
        makeRequest({ originalUrl, auth: session }),
        captureResponse().res,
        next
      );
      expect(called()).toBe(true);
    }
  });

  it('requires a session and reserves the system reset for administrators', () => {
    const missing = captureResponse();
    auth.authorizeRequest(makeRequest(), missing.res, captureNext().next);
    expect(missing.captured.statusCode).toBe(401);

    const operator = seedUser('operador');
    const reset = captureResponse();
    auth.authorizeRequest(
      makeRequest({
        originalUrl: '/api/system/reset',
        method: 'POST',
        auth: authenticated(operator),
      }),
      reset.res,
      captureNext().next
    );
    expect(reset.captured.statusCode).toBe(403);

    const adminReset = captureNext();
    auth.authorizeRequest(
      makeRequest({ originalUrl: '/api/system/reset', method: 'POST', auth: session }),
      captureResponse().res,
      adminReset.next
    );
    expect(adminReset.called()).toBe(true);
  });

  it('allows unknown modules through and rejects unknown roles and denied actions', () => {
    const unknownModule = captureNext();
    auth.authorizeRequest(
      makeRequest({ originalUrl: '/api/unknown', auth: session }),
      captureResponse().res,
      unknownModule.next
    );
    expect(unknownModule.called()).toBe(true);

    const ghostRole = captureResponse();
    auth.authorizeRequest(
      makeRequest({
        originalUrl: '/api/inventory/raw-materials',
        auth: {
          ...session,
          user: { ...session.user, roleId: 'ghost-role' },
        },
      }),
      ghostRole.res,
      captureNext().next
    );
    expect(ghostRole.captured.statusCode).toBe(403);

    const denied = captureResponse();
    auth.authorizeRequest(
      makeRequest({
        originalUrl: '/api/inventory/raw-materials',
        auth: authenticated(seedUser('operador')),
      }),
      denied.res,
      captureNext().next
    );
    expect(denied.captured.statusCode).toBe(403);
    expect(bodyOf(denied.captured)['code']).toBe('FORBIDDEN');
  });

  it('maps every module prefix to its permission module', () => {
    const paths = [
      '/api/inventory/raw-materials',
      '/api/recipes',
      '/api/production-orders',
      '/api/sales/orders',
      '/api/suppliers',
      '/api/banks',
      '/api/payroll/weeks',
      '/api/costing/summary',
      '/api/expenses',
      '/api/fiscal-settings',
      '/api/exchange-rates',
      '/api/reports/dashboard',
      '/api/audit-logs',
    ];

    for (const originalUrl of paths) {
      const { next, called } = captureNext();
      auth.authorizeRequest(
        makeRequest({ originalUrl, auth: session }),
        captureResponse().res,
        next
      );
      expect(called()).toBe(true);
    }
  });

  it('maps HTTP methods and action suffixes to permission actions', () => {
    const requests: { method: string; originalUrl: string }[] = [
      { method: 'GET', originalUrl: '/api/inventory/raw-materials' },
      { method: 'HEAD', originalUrl: '/api/inventory/raw-materials' },
      { method: 'DELETE', originalUrl: '/api/inventory/raw-materials/rm-1' },
      { method: 'PUT', originalUrl: '/api/inventory/raw-materials/rm-1' },
      { method: 'PATCH', originalUrl: '/api/inventory/raw-materials/rm-1' },
      { method: 'POST', originalUrl: '/api/inventory/raw-materials' },
      { method: 'POST', originalUrl: '/api/production-orders/po-1/process' },
      { method: 'POST', originalUrl: '/api/exchange-rates/refresh' },
      { method: 'OPTIONS', originalUrl: '/api/inventory/raw-materials' },
    ];

    for (const request of requests) {
      const { next, called } = captureNext();
      auth.authorizeRequest(
        makeRequest({ ...request, auth: session }),
        captureResponse().res,
        next
      );
      expect(called()).toBe(true);
    }
  });
});
