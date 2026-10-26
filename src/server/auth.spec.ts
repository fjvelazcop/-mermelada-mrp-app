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
