import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, setDbPath } from './database/persistence';

/**
 * End-to-end coverage for the editable catalogs (supplier types and raw-material
 * categories) and the operational reset used to start from zero inventory.
 */

const workDir = mkdtempSync(join(tmpdir(), 'mermelada-catalogs-'));
const dbPath = join(workDir, 'catalogs.db');

let server: Server;
let baseUrl: string;

async function request(
  path: string,
  method = 'GET',
  body?: unknown
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await response.json()) as Record<string, unknown>;
  return { response, body: parsed };
}

function count(table: string): number {
  return (
    getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
}

beforeAll(async () => {
  setDbPath(dbPath);
  const { createApiApp } = await import('./api.js');
  const app = createApiApp();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

describe('editable catalogs', () => {
  it('seeds supplier types with envases and cajas', async () => {
    const { response, body } = await request('/api/supplier-types');
    expect(response.status).toBe(200);
    const codes = (body as unknown as { code: string }[]).map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'fruta',
        'aditivo',
        'empaque',
        'quimico',
        'servicios',
        'envases',
        'cajas',
        'otro',
      ])
    );
    expect(codes).toHaveLength(8);
  });

  it('seeds material categories with envases, cajas and otro', async () => {
    const { response, body } = await request('/api/material-categories');
    expect(response.status).toBe(200);
    const codes = (body as unknown as { code: string }[]).map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'fruta',
        'aditivo',
        'quimico',
        'empaque',
        'envases',
        'cajas',
        'otro',
      ])
    );
    expect(codes).toHaveLength(7);
    expect(codes).not.toContain('servicios');
  });

  it('creates, updates and deletes custom supplier types', async () => {
    const created = await request('/api/supplier-types', 'POST', {
      code: 'transporte',
      label: 'Transporte Especial',
      description: 'Fletes y transporte refrigerado',
      color: 'blue',
      active: true,
    });
    expect(created.response.status).toBe(201);
    const id = created.body['id'] as string;
    expect(created.body['isSystem']).toBe(false);

    const duplicate = await request('/api/supplier-types', 'POST', {
      code: 'transporte',
      label: 'Duplicado',
    });
    expect(duplicate.response.status).toBe(400);

    const updated = await request(`/api/supplier-types/${id}`, 'PUT', {
      label: 'Transporte Refrigerado',
      active: false,
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body['label']).toBe('Transporte Refrigerado');
    expect(updated.body['active']).toBe(false);

    const immutableCode = await request(`/api/supplier-types/${id}`, 'PUT', {
      code: 'otro-codigo',
    });
    expect(immutableCode.response.status).toBe(400);

    const removed = await request(`/api/supplier-types/${id}`, 'DELETE');
    expect(removed.response.status).toBe(200);
  });

  it('accepts suppliers and raw materials using catalog values', async () => {
    const supplier = await request('/api/suppliers', 'POST', {
      businessName: 'Vidrios Los Llanos C.A.',
      taxId: 'J-50123456-7',
      primaryContact: 'Ana Torres',
      primaryPhone: '+58 414 555 0001',
      fiscalAddress: 'Zona Industrial, Barquisimeto',
      supplierType: 'envases',
      paymentTerms: 'Contado',
      status: 'activo',
    });
    expect(supplier.response.status).toBe(201);

    const material = await request('/api/inventory/raw-materials', 'POST', {
      code: 'MP-CAJ-99',
      name: 'Caja cartón corrugado prueba',
      category: 'cajas',
      currentStock: 10,
      minStock: 2,
      unit: 'unidades',
      costPerUnit: 0.5,
      lastRestockDate: '2026-11-20',
    });
    expect(material.response.status).toBe(201);

    const badSupplier = await request('/api/suppliers', 'POST', {
      businessName: 'Tipo Inexistente C.A.',
      taxId: 'J-50123456-8',
      primaryContact: 'Ana Torres',
      primaryPhone: '+58 414 555 0002',
      fiscalAddress: 'Zona Industrial, Barquisimeto',
      supplierType: 'no-existe',
      paymentTerms: 'Contado',
      status: 'activo',
    });
    expect(badSupplier.response.status).toBe(400);
  });

  it('blocks deleting a supplier type still in use', async () => {
    const { body } = await request('/api/supplier-types');
    const envases = (body as unknown as { id: string; code: string }[]).find(
      (item) => item.code === 'envases'
    )!;
    const response = await request(`/api/supplier-types/${envases.id}`, 'DELETE');
    expect(response.response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('está asociado');
  });

  it('blocks deleting a material category still in use', async () => {
    const { body } = await request('/api/material-categories');
    const cajas = (body as unknown as { id: string; code: string }[]).find(
      (item) => item.code === 'cajas'
    )!;
    const response = await request(`/api/material-categories/${cajas.id}`, 'DELETE');
    expect(response.response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('está asociada');
  });
});

describe('operational reset', () => {
  it('clears transactions and zeroes stock while keeping masters', async () => {
    expect(count('expenses')).toBeGreaterThan(0);
    expect(count('production_orders')).toBeGreaterThan(0);
    expect(count('inventory_movements')).toBeGreaterThan(0);

    const materialsBefore = count('raw_materials');
    const productsBefore = count('finished_goods');

    const { response } = await request('/api/system/reset-operational', 'POST', {});
    expect(response.status).toBe(200);

    expect(count('expenses')).toBe(0);
    expect(count('production_orders')).toBe(0);
    expect(count('inventory_movements')).toBe(0);
    expect(count('raw_materials')).toBe(materialsBefore);
    expect(count('finished_goods')).toBe(productsBefore);

    const stock = getDb()
      .prepare(
        'SELECT SUM(current_stock) AS total, MAX(current_stock) AS max FROM raw_materials'
      )
      .get() as { total: number; max: number };
    expect(stock.total).toBe(0);
    expect(stock.max).toBe(0);

    const finished = getDb()
      .prepare(
        'SELECT SUM(stock_units) AS units, SUM(available_units) AS available FROM finished_goods'
      )
      .get() as { units: number; available: number };
    expect(finished.units).toBe(0);
    expect(finished.available).toBe(0);

    expect(count('supplier_types')).toBe(8);
    expect(count('material_categories')).toBe(7);
  });
});
