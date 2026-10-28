import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, setDbPath } from './database/persistence';

/**
 * Authentication and role-based authorization tests.
 *
 * The API runs with `AUTH_ENABLED=true` so every protected route requires a
 * valid bearer token and is checked against the role permission matrix.
 */

const workDir = mkdtempSync(join(tmpdir(), 'mermelada-auth-'));
const dbPath = join(workDir, 'auth.db');

let server: Server;
let baseUrl: string;
let auth: typeof import('./auth.js');

interface LoginBody {
  token: string;
  tokenType: string;
  expiresIn: number;
  user: { username: string; roleId: string };
}

async function login(username: string, password = 'test-password'): Promise<LoginBody> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as LoginBody;
}

function authed(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

interface JsonResponse {
  status: number;
  body: Record<string, unknown>;
}

async function jsonRequest(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? authed(token) : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body: parsed };
}

beforeAll(async () => {
  process.env['AUTH_ENABLED'] = 'true';
  process.env['AUTH_SECRET'] = 'test-secret';
  process.env['AUTH_SEED_PASSWORD'] = 'test-password';
  process.env['AUTH_TOKEN_TTL_SECONDS'] = '3600';

  setDbPath(dbPath);
  auth = await import('./auth.js');
  const { createApiApp } = await import('./api.js');
  const app = createApiApp();

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  closeDb();
  delete process.env['AUTH_ENABLED'];
  delete process.env['AUTH_SECRET'];
  delete process.env['AUTH_SEED_PASSWORD'];
  delete process.env['AUTH_TOKEN_TTL_SECONDS'];
  rmSync(workDir, { recursive: true, force: true });
});

describe('password hashing and tokens', () => {
  it('hashes passwords with a random salt and verifies them', () => {
    const first = auth.hashPassword('secreto');
    const second = auth.hashPassword('secreto');

    expect(first).not.toBe(second);
    expect(first).toContain(':');
    expect(auth.verifyPassword('secreto', first)).toBe(true);
    expect(auth.verifyPassword('incorrecto', first)).toBe(false);
    expect(auth.verifyPassword('secreto', 'malformed')).toBe(false);
    expect(auth.verifyPassword('secreto', 'salt:corta')).toBe(false);
  });

  it('signs and verifies a token, rejecting tampering and expiry', () => {
    const record = auth.findUserByUsername('admin');
    expect(record).toBeTruthy();

    const token = auth.signToken(record!);
    const payload = auth.verifyToken(token);
    expect(payload?.sub).toBe(record!.id);
    expect(payload?.role).toBe('admin');

    expect(auth.verifyToken('garbage')).toBeNull();
    expect(auth.verifyToken(`x${token}`)).toBeNull();
    expect(auth.verifyToken(token.slice(0, -2) + 'xx')).toBeNull();
    expect(auth.verifyToken(auth.signToken(record!, -10))).toBeNull();
  });

  it('seeds users idempotently and exposes find helpers', () => {
    auth.ensureSeedUsers();
    const row = getDb()
      .prepare('SELECT COUNT(*) AS count FROM auth_users')
      .get() as { count: number };
    expect(row.count).toBe(5);

    expect(auth.findUserByUsername('admin')?.role_id).toBe('admin');
    expect(auth.findUserById('usr-operador')?.username).toBe('operador');
    expect(auth.findUserByUsername('missing')).toBeUndefined();
    expect(auth.findUserById('missing')).toBeUndefined();
  });
});

describe('POST /api/auth/login', () => {
  it('returns a bearer token and the public user profile', async () => {
    const body = await login('admin');

    expect(body.token).toBeTruthy();
    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(3600);
    expect(body.user.username).toBe('admin');
    expect(body.user.roleId).toBe('admin');
  });

  it('rejects wrong credentials and unknown users', async () => {
    const wrong = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as { code: string }).code).toBe('UNAUTHORIZED');

    const unknown = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: 'test-password' }),
    });
    expect(unknown.status).toBe(401);
  });

  it('validates the login payload', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin' }),
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe(
      'VALIDATION_ERROR'
    );
  });
});

describe('GET /api/auth/me', () => {
  it('returns the authenticated profile', async () => {
    const { token } = await login('supervisor');
    const response = await fetch(`${baseUrl}/api/auth/me`, {
      headers: authed(token),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { username: string; roleId: string };
    expect(body.username).toBe('supervisor');
    expect(body.roleId).toBe('supervisor_planta');
  });

  it('requires a token', async () => {
    const response = await fetch(`${baseUrl}/api/auth/me`);
    expect(response.status).toBe(401);
  });
});

describe('bearer authentication', () => {
  it('rejects requests without a token', async () => {
    const response = await fetch(`${baseUrl}/api/inventory/raw-materials`);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string }).code).toBe(
      'UNAUTHORIZED'
    );
  });

  it('rejects malformed and expired tokens', async () => {
    const bad = await fetch(`${baseUrl}/api/inventory/raw-materials`, {
      headers: authed('not-a-token'),
    });
    expect(bad.status).toBe(401);

    const admin = auth.findUserByUsername('admin')!;
    const expired = auth.signToken(admin, -5);
    const expiredResponse = await fetch(`${baseUrl}/api/inventory/raw-materials`, {
      headers: authed(expired),
    });
    expect(expiredResponse.status).toBe(401);
  });

  it('rejects tokens for users that no longer exist', async () => {
    const ghost = auth.signToken({
      id: 'ghost',
      username: 'ghost',
      email: 'ghost@example.com',
      full_name: 'Ghost',
      national_id: null,
      password_hash: 'x:y',
      role_id: 'admin',
      department: null,
      status: 'activo',
      created_at: new Date().toISOString(),
      password_changed_at: null,
      avatar_bg: null,
    });
    const response = await fetch(`${baseUrl}/api/inventory/raw-materials`, {
      headers: authed(ghost),
    });
    expect(response.status).toBe(401);
  });

  it('allows public health and documentation routes without a token', async () => {
    for (const path of ['/api/health', '/api/openapi.json', '/api/docs']) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
    }
  });
});

describe('role-based access control', () => {
  it('lets administrators read and write every module', async () => {
    const { token } = await login('admin');
    const response = await fetch(`${baseUrl}/api/inventory/raw-materials`, {
      headers: authed(token),
    });
    expect(response.status).toBe(200);
  });

  it('blocks an operator from inventory but allows production', async () => {
    const { token } = await login('operador');

    const inventory = await fetch(`${baseUrl}/api/inventory/raw-materials`, {
      headers: authed(token),
    });
    expect(inventory.status).toBe(403);
    expect(((await inventory.json()) as { code: string }).code).toBe('FORBIDDEN');

    const production = await fetch(`${baseUrl}/api/production-orders`, {
      headers: authed(token),
    });
    expect(production.status).toBe(200);
  });

  it('distinguishes create from edit permissions for cost analysts', async () => {
    const { token } = await login('costos');

    const create = await fetch(`${baseUrl}/api/inventory/raw-materials`, {
      method: 'POST',
      headers: { ...authed(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'FORBIDDEN-1',
        name: 'No permitido',
        category: 'fruta',
        currentStock: 1,
        minStock: 1,
        unit: 'kg',
        costPerUnit: 1,
        lastRestockDate: '2026-10-26',
      }),
    });
    expect(create.status).toBe(403);

    const materials = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`, {
        headers: authed(token),
      })
    ).json()) as { id: string }[];

    const edit = await fetch(
      `${baseUrl}/api/inventory/raw-materials/${materials[0].id}`,
      {
        method: 'PUT',
        headers: { ...authed(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ minStock: 4 }),
      }
    );
    expect(edit.status).toBe(200);
  });

  it('allows a supervisor to create inventory movements but not delete expenses', async () => {
    const { token } = await login('supervisor');

    const materials = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`, {
        headers: authed(token),
      })
    ).json()) as { id: string; name: string; unit: string }[];

    const movement = await fetch(`${baseUrl}/api/inventory/movements`, {
      method: 'POST',
      headers: { ...authed(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        materialId: materials[0].id,
        materialName: materials[0].name,
        type: 'entrada',
        quantity: 2,
        costPerUnit: 1.5,
        totalCost: 3,
        date: '2026-10-26',
        performedBy: 'Supervisor',
      }),
    });
    expect(movement.status).toBe(201);

    const { token: adminToken } = await login('admin');
    const createdExpense = await fetch(`${baseUrl}/api/expenses`, {
      method: 'POST',
      headers: { ...authed(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: '2026-10-26',
        concept: 'Gasto para probar permisos',
        category: 'otros',
        categoryLabel: 'Otros',
        amountUsd: 5,
        exchangeRateUsed: 50,
        supplierOrBeneficiary: 'Proveedor',
        documentType: 'recibo_pago',
        paymentMethod: 'efectivo_usd',
        registeredBy: 'Admin',
        taxCategory: 'no_sujeto',
        fiscalBookEligible: false,
      }),
    });
    expect(createdExpense.status).toBe(201);
    const expense = (await createdExpense.json()) as { id: string };

    const forbidden = await fetch(`${baseUrl}/api/expenses/${expense.id}`, {
      method: 'DELETE',
      headers: authed(token),
    });
    expect(forbidden.status).toBe(403);
  });

  it('reserves the demo reset for administrators', async () => {
    const { token: operatorToken } = await login('operador');
    const forbidden = await fetch(`${baseUrl}/api/system/reset`, {
      method: 'POST',
      headers: authed(operatorToken),
    });
    expect(forbidden.status).toBe(403);

    const { token: adminToken } = await login('admin');
    const allowed = await fetch(`${baseUrl}/api/system/reset`, {
      method: 'POST',
      headers: authed(adminToken),
    });
    expect(allowed.status).toBe(200);
  });
});

describe('database-backed roles and permissions', () => {
  it('seeds the built-in roles with their current permission matrices', () => {
    auth.ensureSeedRoles();
    const roles = auth.listRoles();
    expect(roles.map((role) => role.id)).toEqual([
      'admin',
      'supervisor_planta',
      'operator',
      'analista_costos',
      'almacenista',
    ]);

    const operator = auth.getRolePermissions('operator');
    expect(operator?.['production']).toEqual({
      view: true,
      create: true,
      edit: true,
      delete: false,
      export: false,
    });
    expect(operator?.['inventory'].view).toBe(false);

    const supervisor = auth.getRolePermissions('supervisor_planta');
    expect(supervisor?.['inventory']).toEqual({
      view: true,
      create: true,
      edit: true,
      delete: false,
      export: true,
    });

    const rows = getDb()
      .prepare('SELECT COUNT(*) AS count FROM auth_role_permissions')
      .get() as { count: number };
    expect(rows.count).toBe(50);
    expect(auth.getRolePermissions('does-not-exist')).toBeNull();
  });

  it('does not overwrite customized permissions when reseeding', () => {
    auth.updateRolePermissions('almacenista', 'costing', { canView: true });
    auth.ensureSeedRoles();
    expect(auth.getRolePermissions('almacenista')?.['costing'].view).toBe(true);

    auth.updateRolePermissions('almacenista', 'costing', { canView: false });
  });
});

describe('role and user administration', () => {
  let adminToken = '';
  let customRoleId = '';
  let customUserId = '';
  let customUserToken = '';

  beforeAll(async () => {
    adminToken = (await login('admin')).token;
  });

  it('lets an administrator create a custom role with permissions', async () => {
    const created = await jsonRequest(
      '/api/auth/roles',
      'POST',
      {
        name: 'Inspector de Calidad HACCP',
        description: 'Verifica BPM y trazabilidad de los lotes',
        color: 'emerald',
        permissions: {
          production: {
            canView: true,
            canCreate: true,
            canEdit: false,
            canDelete: false,
            canExport: false,
          },
        },
      },
      adminToken
    );

    expect(created.status).toBe(201);
    expect(String(created.body['id'])).toMatch(/^role-inspector_de_calidad_haccp-/);
    expect(created.body['isSystem']).toBe(false);
    customRoleId = String(created.body['id']);

    const permissions = created.body['permissions'] as Record<
      string,
      { canView: boolean }
    >;
    expect(permissions['production'].canView).toBe(true);
    expect(permissions['inventory'].canView).toBe(false);
  });

  it('creates a user assigned to the custom role and enforces its permissions', async () => {
    const created = await jsonRequest(
      '/api/auth/users',
      'POST',
      {
        fullName: 'Carlos Mendoza',
        username: 'cmendoza',
        email: 'cmendoza@pulpacraft.local',
        nationalId: 'V-19.876.543',
        roleId: customRoleId,
        department: 'Control de Calidad',
        password: 'initial-pass-123',
      },
      adminToken
    );

    expect(created.status).toBe(201);
    expect(created.body['roleId']).toBe(customRoleId);
    expect(created.body['roleName']).toBe('Inspector de Calidad HACCP');
    customUserId = String(created.body['id']);

    customUserToken = (
      await login('cmendoza', 'initial-pass-123')
    ).token;

    const production = await jsonRequest(
      '/api/production-orders',
      'GET',
      undefined,
      customUserToken
    );
    expect(production.status).toBe(200);

    const inventory = await jsonRequest(
      '/api/inventory/raw-materials',
      'GET',
      undefined,
      customUserToken
    );
    expect(inventory.status).toBe(403);
    expect(inventory.body['code']).toBe('FORBIDDEN');
  });

  it('applies role permission changes immediately to existing users', async () => {
    const updated = await jsonRequest(
      `/api/auth/roles/${customRoleId}/permissions`,
      'PUT',
      { moduleId: 'inventory', permissions: { canView: true } },
      adminToken
    );
    expect(updated.status).toBe(200);

    const inventory = await jsonRequest(
      '/api/inventory/raw-materials',
      'GET',
      undefined,
      customUserToken
    );
    expect(inventory.status).toBe(200);
  });

  it('forbids non-administrators from managing users and roles', async () => {
    const { token } = await login('operador');

    const listUsers = await jsonRequest('/api/auth/users', 'GET', undefined, token);
    expect(listUsers.status).toBe(403);

    const createRole = await jsonRequest(
      '/api/auth/roles',
      'POST',
      { name: 'Rol no permitido', description: 'No debe crearse' },
      token
    );
    expect(createRole.status).toBe(403);

    const createUser = await jsonRequest(
      '/api/auth/users',
      'POST',
      {
        fullName: 'Intruso',
        username: 'intruso',
        email: 'intruso@example.com',
        roleId: 'operator',
      },
      token
    );
    expect(createUser.status).toBe(403);
  });

  it('protects system roles and roles that still have users', async () => {
    const systemDelete = await jsonRequest(
      '/api/auth/roles/operator',
      'DELETE',
      undefined,
      adminToken
    );
    expect(systemDelete.status).toBe(400);
    expect(systemDelete.body['error']).toMatch(/roles base/);

    const inUseDelete = await jsonRequest(
      `/api/auth/roles/${customRoleId}`,
      'DELETE',
      undefined,
      adminToken
    );
    expect(inUseDelete.status).toBe(400);
    expect(inUseDelete.body['error']).toMatch(/asignado/);
  });

  it('lists persisted users with their role name', async () => {
    const response = await jsonRequest('/api/auth/users', 'GET', undefined, adminToken);
    expect(response.status).toBe(200);
    const users = response.body as unknown as {
      username: string;
      roleName?: string;
    }[];
    const created = users.find((user) => user.username === 'cmendoza');
    expect(created?.roleName).toBe('Inspector de Calidad HACCP');
  });

  it('deletes the user and then the unused custom role', async () => {
    const deletedUser = await jsonRequest(
      `/api/auth/users/${customUserId}`,
      'DELETE',
      undefined,
      adminToken
    );
    expect(deletedUser.status).toBe(200);

    const deletedRole = await jsonRequest(
      `/api/auth/roles/${customRoleId}`,
      'DELETE',
      undefined,
      adminToken
    );
    expect(deletedRole.status).toBe(200);

    const roles = await jsonRequest('/api/auth/roles', 'GET', undefined, adminToken);
    const ids = (roles.body as unknown as { id: string }[]).map((role) => role.id);
    expect(ids).not.toContain(customRoleId);
  });
});

describe('POST /api/auth/change-password', () => {
  it('verifies the current password, rotates the hash and invalidates tokens', async () => {
    const { token: adminToken } = await login('admin');

    const created = await jsonRequest(
      '/api/auth/users',
      'POST',
      {
        fullName: 'Usuario de Clave',
        username: 'clave-user',
        email: 'clave-user@pulpacraft.local',
        roleId: 'operator',
        password: 'initial-pass-123',
      },
      adminToken
    );
    expect(created.status).toBe(201);
    const userId = String(created.body['id']);

    const session = await login('clave-user', 'initial-pass-123');

    const wrong = await jsonRequest(
      '/api/auth/change-password',
      'POST',
      { currentPassword: 'incorrecta', newPassword: 'nueva-pass-456' },
      session.token
    );
    expect(wrong.status).toBe(400);
    expect(wrong.body['code']).toBe('INVALID_CURRENT_PASSWORD');

    const changed = await jsonRequest(
      '/api/auth/change-password',
      'POST',
      { currentPassword: 'initial-pass-123', newPassword: 'nueva-pass-456' },
      session.token
    );
    expect(changed.status).toBe(200);
    expect(changed.body['requiresLogin']).toBe(true);

    const stale = await jsonRequest('/api/auth/me', 'GET', undefined, session.token);
    expect(stale.status).toBe(401);

    const oldLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'clave-user', password: 'initial-pass-123' }),
    });
    expect(oldLogin.status).toBe(401);

    const newSession = await login('clave-user', 'nueva-pass-456');
    expect(newSession.user.roleId).toBe('operator');

    const cleanup = await jsonRequest(
      `/api/auth/users/${userId}`,
      'DELETE',
      undefined,
      adminToken
    );
    expect(cleanup.status).toBe(200);
  });

  it('rejects a new password equal to the current one', async () => {
    const { token } = await login('operador');
    const response = await jsonRequest(
      '/api/auth/change-password',
      'POST',
      { currentPassword: 'test-password', newPassword: 'test-password' },
      token
    );
    expect(response.status).toBe(422);
    expect(response.body['code']).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    const response = await jsonRequest('/api/auth/change-password', 'POST', {
      currentPassword: 'test-password',
      newPassword: 'nueva-pass-456',
    });
    expect(response.status).toBe(401);
  });
});
