import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, setDbPath } from './database/persistence';

/**
 * Hidden `master` role and the activation/payment-control module.
 *
 * The API runs with `AUTH_ENABLED=true` so role checks use the JWT claims.
 */

const workDir = mkdtempSync(join(tmpdir(), 'mermelada-activation-'));
const dbPath = join(workDir, 'activation.db');

let server: Server;
let baseUrl: string;
let auth: typeof import('./auth.js');
let masterToken = '';
let adminToken = '';

interface LoginBody {
  token: string;
  user: { id: string; username: string; roleId: string };
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

async function jsonRequest(
  path: string,
  method = 'GET',
  body?: unknown,
  token?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
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

const activationPayload = {
  clientName: 'Distribuidora El Samán C.A.',
  clientDocument: 'J-40123456-7',
  concept: 'Activación anual del servicio',
  amount: 120,
  currency: 'USD',
  paymentMethod: 'transferencia',
  reference: 'TRF-001',
  paymentDate: '2026-11-13',
  periodStart: '2026-11-13',
  periodEnd: '2027-11-13',
  status: 'activo',
  notes: 'Pago verificado por tesorería',
};

beforeAll(async () => {
  process.env['AUTH_ENABLED'] = 'true';
  process.env['AUTH_SECRET'] = 'test-secret';
  process.env['AUTH_SEED_PASSWORD'] = 'test-password';
  process.env['AUTH_MASTER_PASSWORD'] = 'test-password';
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

  masterToken = (await login('fjvelazco')).token;
  adminToken = (await login('admin')).token;
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
  delete process.env['AUTH_MASTER_PASSWORD'];
  delete process.env['AUTH_TOKEN_TTL_SECONDS'];
  rmSync(workDir, { recursive: true, force: true });
});

describe('hidden master account', () => {
  it('seeds Francisco Velazco with the master role and hides it from user listings', async () => {
    const record = auth.findUserByUsername('fjvelazco');
    expect(record?.role_id).toBe('master');
    expect(record?.national_id).toBe('1431651');
    expect(record?.email).toBe('fjvelazco@gmail.com');

    const listed = await jsonRequest('/api/auth/users', 'GET', undefined, adminToken);
    expect(listed.status).toBe(200);
    const users = listed.body as unknown as { username: string }[];
    expect(users.some((user) => user.username === 'fjvelazco')).toBe(false);
  });

  it('only shows the master role to master users', async () => {
    const asAdmin = await jsonRequest('/api/auth/roles', 'GET', undefined, adminToken);
    expect(asAdmin.status).toBe(200);
    const adminRoles = asAdmin.body as unknown as { id: string }[];
    expect(adminRoles.some((role) => role.id === 'master')).toBe(false);

    const asMaster = await jsonRequest('/api/auth/roles', 'GET', undefined, masterToken);
    expect(asMaster.status).toBe(200);
    const masterRoles = asMaster.body as unknown as { id: string }[];
    expect(masterRoles.some((role) => role.id === 'master')).toBe(true);
  });

  it('does not let administrators assign the master role', async () => {
    const forbidden = await jsonRequest(
      '/api/auth/users',
      'POST',
      {
        fullName: 'Intruso Master',
        username: 'intruso',
        email: 'intruso@example.com',
        roleId: 'master',
        password: 'test-password',
      },
      adminToken
    );
    expect(forbidden.status).toBe(400);
  });
});

describe('activation / payment control', () => {
  let activationId = '';

  it('rejects administrators and allows the master to create records', async () => {
    const forbidden = await jsonRequest(
      '/api/activations',
      'POST',
      activationPayload,
      adminToken
    );
    expect(forbidden.status).toBe(403);

    const created = await jsonRequest(
      '/api/activations',
      'POST',
      activationPayload,
      masterToken
    );
    expect(created.status).toBe(201);
    expect(created.body['clientName']).toBe(activationPayload.clientName);
    expect(created.body['amount']).toBe(120);
    activationId = String(created.body['id']);
  });

  it('allows the master to list, update and delete records', async () => {
    const listed = await jsonRequest('/api/activations', 'GET', undefined, masterToken);
    expect(listed.status).toBe(200);
    const records = listed.body as unknown as { id: string }[];
    expect(records.some((record) => record.id === activationId)).toBe(true);

    const updated = await jsonRequest(
      `/api/activations/${activationId}`,
      'PUT',
      { status: 'vencido', amount: 150 },
      masterToken
    );
    expect(updated.status).toBe(200);
    expect(updated.body['status']).toBe('vencido');
    expect(updated.body['amount']).toBe(150);

    const deleted = await jsonRequest(
      `/api/activations/${activationId}`,
      'DELETE',
      undefined,
      masterToken
    );
    expect(deleted.status).toBe(200);

    const missing = await jsonRequest(
      `/api/activations/${activationId}`,
      'DELETE',
      undefined,
      masterToken
    );
    expect(missing.status).toBe(404);
  });

  it('keeps administrators out of the module entirely', async () => {
    const listed = await jsonRequest('/api/activations', 'GET', undefined, adminToken);
    expect(listed.status).toBe(403);
  });

  it('refuses to grant the activation module to other roles', () => {
    expect(() =>
      auth.updateRolePermissions('almacenista', 'activation', { canView: true })
    ).toThrow(/exclusivo del rol Master/);
  });
});
