import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, setDbPath } from './database/persistence';

/**
 * Integration tests for the HTTP API.
 *
 * The Express app is started on a random port and exercised with real HTTP
 * requests. Every mutation is checked against the SQLite tables as well.
 */

const workDir = mkdtempSync(join(tmpdir(), 'mermelada-api-'));
const dbPath = join(workDir, 'api.db');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  setDbPath(dbPath);

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
  rmSync(workDir, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('reports a healthy SQLite connection and the database path', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      database: { path: string; connected: boolean };
      timestamp: string;
    };

    expect(body.status).toBe('ok');
    expect(body.database.connected).toBe(true);
    expect(body.database.path).toBe(dbPath);
    expect(Date.parse(body.timestamp)).not.toBeNaN();
  });
});

describe('inventory API', () => {
  const payload = {
    code: 'TEST-API-001',
    name: 'Materia prima creada por la API',
    category: 'fruta',
    currentStock: 17,
    minStock: 3,
    unit: 'kg',
    costPerUnit: 2.25,
    supplier: 'Proveedor API',
    lastRestockDate: '2026-10-26',
  };

  it('returns the seeded raw materials', async () => {
    const response = await fetch(`${baseUrl}/api/inventory/raw-materials`);
    expect(response.status).toBe(200);

    const materials = (await response.json()) as { id: string }[];
    expect(Array.isArray(materials)).toBe(true);
    expect(materials.length).toBeGreaterThan(0);
  });

  it('creates a raw material and persists it relationally', async () => {
    const response = await fetch(`${baseUrl}/api/inventory/raw-materials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string; code: string };
    expect(created.id).toBeTruthy();
    expect(created.code).toBe(payload.code);

    const row = getDb()
      .prepare('SELECT code, name, current_stock FROM raw_materials WHERE id = ?')
      .get(created.id) as
      | { code: string; name: string; current_stock: number }
      | undefined;

    expect(row).toEqual({
      code: payload.code,
      name: payload.name,
      current_stock: payload.currentStock,
    });

    const list = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string }[];
    expect(list.some((material) => material.id === created.id)).toBe(true);
  });

  it('resets demo data through the API', async () => {
    const response = await fetch(`${baseUrl}/api/system/reset`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);

    const list = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { code: string }[];
    expect(list.some((material) => material.code === payload.code)).toBe(false);
  });
});

describe('read-only endpoints', () => {
  it.each([
    '/api/recipes',
    '/api/production-orders',
    '/api/sales/customers',
    '/api/sales/orders',
    '/api/sales/delivery-notes',
    '/api/payroll/weeks',
    '/api/payroll/employees',
    '/api/expenses',
    '/api/expenses/categories',
    '/api/audit-logs',
  ])('GET %s returns an array', async (path) => {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/fiscal-settings returns an object', async () => {
    const response = await fetch(`${baseUrl}/api/fiscal-settings`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { companyName?: string };
    expect(typeof body).toBe('object');
    expect(body.companyName).toBeTruthy();
  });

  it('GET /api/reports/dashboard returns metrics', async () => {
    const response = await fetch(`${baseUrl}/api/reports/dashboard`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body).toBe('object');
  });
});
