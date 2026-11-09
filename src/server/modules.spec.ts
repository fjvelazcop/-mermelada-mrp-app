import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, setDbPath } from './database/persistence';
import {
  VENEZUELAN_BANKS,
  bankLabel,
  findBank,
} from '../app/core/data/venezuelan-banks';

/**
 * Integration tests for the ERP modules added in Issue #6:
 * supplier directory/price history, manual production, sales collection and
 * the Venezuelan bank catalog.
 */

const workDir = mkdtempSync(join(tmpdir(), 'mermelada-modules-'));
const dbPath = join(workDir, 'modules.db');

let server: Server;
let baseUrl: string;

type JsonBody = Record<string, unknown>;

interface ApiResponse {
  response: Response;
  body: JsonBody;
}

async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await response.json()) as JsonBody;
  return { response, body: parsed };
}

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

describe('Venezuelan bank catalog', () => {
  it('exposes the official SUDEBAN codes with code + name labels', () => {
    expect(VENEZUELAN_BANKS.length).toBeGreaterThan(20);
    expect(findBank('0108')?.name).toContain('Provincial');
    expect(findBank('0102')?.name).toContain('Venezuela');
    expect(findBank('0134')?.name).toContain('Banesco');
    expect(bankLabel(findBank('0108')!)).toMatch(/^0108 - /);
  });

  it('returns undefined for unknown codes', () => {
    expect(findBank('9999')).toBeUndefined();
    expect(findBank('')).toBeUndefined();
  });
});

describe('supplier directory and price history', () => {
  const supplierPayload = {
    businessName: 'Frutas del Sur C.A.',
    taxId: 'J-30123456-7',
    primaryContact: 'María Pérez',
    primaryPhone: '+58 412 555 0101',
    secondaryPhone: '+58 212 555 0101',
    email: 'compras@frutasdelsur.com',
    fiscalAddress: 'Av. Principal, Galpón 4, Caracas',
    physicalAddress: 'Zona Industrial El Valle, Caracas',
    supplierType: 'fruta',
    paymentTerms: 'Contado',
    status: 'activo',
    notes: 'Proveedor de prueba',
  };

  let supplierId = '';

  it('lists the seeded suppliers', async () => {
    const { response, body } = await request('/api/suppliers');
    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown as unknown[]).length).toBeGreaterThan(0);
  });

  it('requires the mandatory primary contact', async () => {
    const withoutContact: Record<string, unknown> = { ...supplierPayload };
    delete withoutContact['primaryContact'];
    const { response } = await request('/api/suppliers', 'POST', withoutContact);
    expect(response.status).toBe(422);
  });

  it('creates a supplier with a fixed contact card', async () => {
    const { response, body } = await request(
      '/api/suppliers',
      'POST',
      supplierPayload
    );
    expect(response.status).toBe(201);
    expect(body['code']).toMatch(/^PROV-\d{4}$/);
    expect(body['primaryContact']).toBe('María Pérez');
    expect(body['fiscalAddress']).toBe(supplierPayload.fiscalAddress);
    supplierId = body['id'] as string;
  });

  it('rejects duplicate RIF values', async () => {
    const { response } = await request('/api/suppliers', 'POST', {
      ...supplierPayload,
      businessName: 'Otro proveedor',
    });
    expect(response.status).toBe(400);
  });

  it('registers prices and closes the previous current price', async () => {
    const first = await request(`/api/suppliers/${supplierId}/prices`, 'POST', {
      productName: 'Guayaba Roja Criolla',
      unit: 'kg',
      priceUsd: 1.2,
      validFrom: '2026-10-01',
    });
    expect(first.response.status).toBe(201);
    expect(first.body['isCurrent']).toBe(true);
    expect(first.body['supplierName']).toBe(supplierPayload.businessName);

    const second = await request(`/api/suppliers/${supplierId}/prices`, 'POST', {
      productName: 'Guayaba Roja Criolla',
      unit: 'kg',
      priceUsd: 1.35,
      validFrom: '2026-10-20',
      notes: 'Ajuste por temporada',
    });
    expect(second.response.status).toBe(201);

    const history = await request(`/api/suppliers/${supplierId}/prices`);
    expect(history.response.status).toBe(200);
    const prices = history.body as unknown as {
      id: string;
      priceUsd: number;
      isCurrent: boolean;
      validTo?: string;
    }[];
    expect(prices).toHaveLength(2);
    expect(prices.filter((price) => price.isCurrent)).toHaveLength(1);
    const previous = prices.find((price) => price.priceUsd === 1.2);
    expect(previous?.isCurrent).toBe(false);
    expect(previous?.validTo).toBe('2026-10-20');
  });

  it('updates and deletes a supplier', async () => {
    const updated = await request(`/api/suppliers/${supplierId}`, 'PUT', {
      primaryPhone: '+58 414 999 0000',
      notes: 'Actualizado',
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body['primaryPhone']).toBe('+58 414 999 0000');

    const deleted = await request(`/api/suppliers/${supplierId}`, 'DELETE');
    expect(deleted.response.status).toBe(200);

    const list = await request('/api/suppliers');
    const ids = (list.body as unknown as { id: string }[]).map((s) => s.id);
    expect(ids).not.toContain(supplierId);
  });
});

describe('manual production orders', () => {
  let orderId = '';
  let targetUnits = 0;
  let trackedUnits = 0;
  let flavor = '';
  let presentation = '';

  it('lists only manual orders', async () => {
    const { response, body } = await request('/api/production-orders/manual');
    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('forbids non administrators from creating manual orders', async () => {
    const { response } = await request(
      '/api/production-orders/manual',
      'POST',
      { formulas: [{ recipeId: 'rec-1', batchCount: 1 }] },
      { 'X-Demo-Role': 'operator' }
    );
    expect(response.status).toBe(403);
  });

  it('creates a multi-formula draft without touching inventory', async () => {
    const recipes = (await request('/api/recipes')).body as unknown as {
      id: string;
      flavor: string;
      presentation: string;
      batchSizeUnits: number;
    }[];
    expect(recipes.length).toBeGreaterThan(0);
    const recipeA = recipes[0];
    const recipeB = recipes[1] || recipes[0];

    const before = (await request('/api/inventory/finished-goods'))
      .body as unknown as {
      flavor: string;
      presentation: string;
      stockUnits: number;
      reservedUnits: number;
      availableUnits: number;
    }[];
    const beforeGood = before.find(
      (fg) =>
        fg.flavor === recipeA.flavor && fg.presentation === recipeA.presentation
    );

    const { response, body } = await request(
      '/api/production-orders/manual',
      'POST',
      {
        formulas: [
          { recipeId: recipeA.id, batchCount: 1 },
          { recipeId: recipeB.id, batchCount: 1 },
        ],
        lotNumber: 'L-TEST-MANUAL-01',
        commitmentReference: 'Compromiso de prueba',
        operatorNotes: 'Orden de prueba',
      }
    );
    expect(response.status).toBe(201);
    expect(body['mode']).toBe('manual');
    expect(body['status']).toBe('borrador');
    expect((body['formulas'] as unknown[]).length).toBe(2);
    orderId = body['id'] as string;
    targetUnits = body['targetUnits'] as number;
    flavor = body['flavor'] as string;
    presentation = body['presentation'] as string;
    expect(targetUnits).toBeGreaterThan(0);

    // A multi-formula order can produce several finished goods. Track the
    // units produced for the flavor/presentation of the first formula.
    const formulas = body['formulas'] as unknown as {
      flavor: string;
      presentation: string;
      targetUnits: number;
    }[];
    trackedUnits = formulas
      .filter((f) => f.flavor === flavor && f.presentation === presentation)
      .reduce((sum, f) => sum + f.targetUnits, 0);
    expect(trackedUnits).toBeGreaterThan(0);

    const after = (await request('/api/inventory/finished-goods'))
      .body as unknown as typeof before;
    const afterGood = after.find(
      (fg) => fg.flavor === flavor && fg.presentation === presentation
    );
    expect(afterGood?.stockUnits ?? 0).toBe(beforeGood?.stockUnits ?? 0);
    expect(afterGood?.reservedUnits ?? 0).toBe(beforeGood?.reservedUnits ?? 0);
  });

  it('blocks processing when raw materials are insufficient', async () => {
    const created = await request('/api/production-orders/manual', 'POST', {
      formulas: [{ recipeId: 'rec-1', batchCount: 5000 }],
      lotNumber: 'L-TEST-INSUFFICIENT',
    });
    expect(created.response.status).toBe(400);
  });

  it('processes the order and adds committed inventory', async () => {
    const before = (await request('/api/inventory/finished-goods'))
      .body as unknown as {
      flavor: string;
      presentation: string;
      stockUnits: number;
      reservedUnits: number;
      availableUnits: number;
    }[];
    const beforeGood = before.find(
      (fg) => fg.flavor === flavor && fg.presentation === presentation
    );

    const { response, body } = await request(
      `/api/production-orders/manual/${orderId}/process`,
      'POST',
      {}
    );
    expect(response.status).toBe(200);
    expect(body['success']).toBe(true);
    expect((body['order'] as JsonBody)['status']).toBe('completada');

    const after = (await request('/api/inventory/finished-goods'))
      .body as unknown as typeof before;
    const afterGood = after.find(
      (fg) => fg.flavor === flavor && fg.presentation === presentation
    );
    expect(afterGood).toBeTruthy();
    expect((afterGood?.stockUnits ?? 0) - (beforeGood?.stockUnits ?? 0)).toBe(
      trackedUnits
    );
    expect(
      (afterGood?.reservedUnits ?? 0) - (beforeGood?.reservedUnits ?? 0)
    ).toBe(trackedUnits);
    expect(afterGood?.availableUnits).toBe(
      (afterGood?.stockUnits ?? 0) - (afterGood?.reservedUnits ?? 0)
    );
  });

  it('does not process the same manual order twice', async () => {
    const { response } = await request(
      `/api/production-orders/manual/${orderId}/process`,
      'POST',
      {}
    );
    expect(response.status).toBe(400);
  });

  it('annuls the order and reverts inventory', async () => {
    const before = (await request('/api/inventory/finished-goods'))
      .body as unknown as {
      flavor: string;
      presentation: string;
      stockUnits: number;
      reservedUnits: number;
      availableUnits: number;
    }[];
    const beforeGood = before.find(
      (fg) => fg.flavor === flavor && fg.presentation === presentation
    );

    const { response, body } = await request(
      `/api/production-orders/manual/${orderId}/annul`,
      'POST',
      {}
    );
    expect(response.status).toBe(200);
    expect((body['order'] as JsonBody)['status']).toBe('anulada');

    const after = (await request('/api/inventory/finished-goods'))
      .body as unknown as typeof before;
    const afterGood = after.find(
      (fg) => fg.flavor === flavor && fg.presentation === presentation
    );
    expect((beforeGood?.stockUnits ?? 0) - (afterGood?.stockUnits ?? 0)).toBe(
      trackedUnits
    );
    expect(
      (beforeGood?.reservedUnits ?? 0) - (afterGood?.reservedUnits ?? 0)
    ).toBe(trackedUnits);
  });

  it('deletes an annulled manual order', async () => {
    const { response } = await request(
      `/api/production-orders/manual/${orderId}`,
      'DELETE'
    );
    expect(response.status).toBe(200);
  });
});

describe('manual production sheet (physical Lote 72 format)', () => {
  const lotNumber = 'L-TEST-SHEET-01';
  let orderId = '';
  let rawMaterialsBefore: {
    id: string;
    name: string;
    currentStock: number;
  }[] = [];

  const sheetRow = (number: number, overrides: Record<string, unknown> = {}) => ({
    number,
    basketsBase: 1,
    guavaKg: 10,
    sugarKg: 8,
    starchKg: 1,
    chemicalG: 50,
    acidG: 20,
    waterGasOil: 5,
    finishedAt: '14:30',
    obtainedUnits: 1,
    totalKg: 20,
    reprocess: false,
    ...overrides,
  });

  it('rejects non administrators', async () => {
    const { response } = await request(
      '/api/production-orders/manual/sheet',
      'POST',
      {
        lotNumber: 'L-TEST-SHEET-FORBIDDEN',
        productionDate: '2026-11-03',
        marmitas: [1, 2, 3, 4, 5, 6].map((n) => sheetRow(n)),
        packaging: { presentationKg: 20, cunetes: 1, cajas: 0 },
        processImmediately: true,
      },
      { 'X-Demo-Role': 'operator' }
    );
    expect(response.status).toBe(403);
  });

  it('lets the plant supervisor register a draft sheet without consuming stock', async () => {
    const before = (await request('/api/inventory/raw-materials'))
      .body as unknown as { id: string; currentStock: number }[];
    const { response, body } = await request(
      '/api/production-orders/manual/sheet',
      'POST',
      {
        lotNumber: 'L-TEST-SHEET-SUPERVISOR',
        productionDate: '2026-11-03',
        marmitas: [1, 2, 3, 4, 5, 6].map((n) => sheetRow(n)),
        packaging: { presentationKg: 20, cunetes: 1, cajas: 0 },
        // A supervisor cannot process: the server must ignore this flag.
        processImmediately: true,
      },
      { 'X-Demo-Role': 'supervisor_planta' }
    );

    expect(response.status).toBe(201);
    expect(body['status']).toBe('borrador');
    expect(body['mode']).toBe('manual');

    const after = (await request('/api/inventory/raw-materials'))
      .body as unknown as { id: string; currentStock: number }[];
    expect(after).toEqual(before);
  });

  it('derives obtained units from kilos totales when the client omits them', async () => {
    const { response, body } = await request(
      '/api/production-orders/manual/sheet',
      'POST',
      {
        lotNumber: 'L-TEST-SHEET-AUTO-CALC',
        productionDate: '2026-11-03',
        marmitas: [1, 2, 3, 4, 5, 6].map((n) =>
          n === 1
            ? sheetRow(n, { totalKg: 40, obtainedUnits: 0 })
            : sheetRow(n, {
                guavaKg: 0,
                sugarKg: 0,
                starchKg: 0,
                chemicalG: 0,
                acidG: 0,
                waterGasOil: 0,
                obtainedUnits: 0,
                totalKg: 0,
              })
        ),
        packaging: { presentationKg: 20, cunetes: 1, cajas: 0 },
        processImmediately: false,
      },
      { 'X-Demo-Role': 'supervisor_planta' }
    );

    expect(response.status).toBe(201);
    const sheet = body['manualSheet'] as unknown as {
      marmitas: { obtainedUnits: number; totalKg: number }[];
      totals: { obtainedUnits: number; estimatedUnits: number };
    };
    expect(sheet.marmitas[0].totalKg).toBe(40);
    expect(sheet.marmitas[0].obtainedUnits).toBe(2);
    expect(sheet.totals.obtainedUnits).toBe(2);
    expect(sheet.totals.estimatedUnits).toBe(2);
  });

  it('preserves an explicit obtained units override', async () => {
    const { response, body } = await request(
      '/api/production-orders/manual/sheet',
      'POST',
      {
        lotNumber: 'L-TEST-SHEET-MANUAL-UNITS',
        productionDate: '2026-11-03',
        marmitas: [1, 2, 3, 4, 5, 6].map((n) =>
          n === 1
            ? sheetRow(n, { totalKg: 40, obtainedUnits: 1.25 })
            : sheetRow(n, {
                guavaKg: 0,
                sugarKg: 0,
                starchKg: 0,
                chemicalG: 0,
                acidG: 0,
                waterGasOil: 0,
                obtainedUnits: 0,
                totalKg: 0,
              })
        ),
        packaging: { presentationKg: 20, cunetes: 1, cajas: 0 },
        processImmediately: false,
      },
      { 'X-Demo-Role': 'supervisor_planta' }
    );

    expect(response.status).toBe(201);
    const sheet = body['manualSheet'] as unknown as {
      marmitas: { obtainedUnits: number }[];
      totals: { obtainedUnits: number; estimatedUnits: number };
    };
    expect(sheet.marmitas[0].obtainedUnits).toBe(1.25);
    expect(sheet.totals.obtainedUnits).toBe(1.25);
    expect(sheet.totals.estimatedUnits).toBe(2);
  });

  it('validates exactly six marmitas', async () => {
    const { response } = await request(
      '/api/production-orders/manual/sheet',
      'POST',
      {
        lotNumber: 'L-TEST-SHEET-FIVE',
        productionDate: '2026-11-03',
        marmitas: [1, 2, 3, 4, 5].map((n) => sheetRow(n)),
        packaging: { presentationKg: 20, cunetes: 1, cajas: 0 },
        processImmediately: true,
      }
    );
    expect(response.status).toBe(422);
  });

  it('saves the sheet and deducts inputs, packaging and produced units once', async () => {
    rawMaterialsBefore = (
      await request('/api/inventory/raw-materials')
    ).body as unknown as typeof rawMaterialsBefore;

    const { response, body } = await request(
      '/api/production-orders/manual/sheet',
      'POST',
      {
        lotNumber,
        productionDate: '2026-11-03',
        marmitas: [
          sheetRow(1),
          sheetRow(2, {
            guavaKg: 5,
            sugarKg: 4,
            starchKg: 0.5,
            chemicalG: 25,
            acidG: 10,
            waterGasOil: 2.5,
            obtainedUnits: 1,
            totalKg: 10,
          }),
          sheetRow(3, {
            guavaKg: 0,
            sugarKg: 0,
            starchKg: 0,
            chemicalG: 0,
            acidG: 0,
            waterGasOil: 0,
            obtainedUnits: 0,
            totalKg: 0,
          }),
          sheetRow(4, {
            guavaKg: 0,
            sugarKg: 0,
            starchKg: 0,
            chemicalG: 0,
            acidG: 0,
            waterGasOil: 0,
            obtainedUnits: 0,
            totalKg: 0,
          }),
          sheetRow(5, {
            guavaKg: 0,
            sugarKg: 0,
            starchKg: 0,
            chemicalG: 0,
            acidG: 0,
            waterGasOil: 0,
            obtainedUnits: 0,
            totalKg: 0,
          }),
          sheetRow(6, {
            guavaKg: 0,
            sugarKg: 0,
            starchKg: 0,
            chemicalG: 0,
            acidG: 0,
            waterGasOil: 0,
            obtainedUnits: 0,
            totalKg: 0,
          }),
        ],
        packaging: { presentationKg: 20, cunetes: 2, cajas: 1 },
        commitmentReference: 'Lote 72 de prueba',
        processImmediately: true,
      }
    );

    expect(response.status).toBe(201);
    expect(body['status']).toBe('completada');
    expect(body['mode']).toBe('manual');
    expect(body['targetUnits']).toBe(3);
    orderId = body['id'] as string;

    const sheet = body['manualSheet'] as unknown as {
      marmitas: unknown[];
      totals: { guavaKg: number; sugarKg: number; starchKg: number };
      costs: {
        materialsCost: number;
        packagingCost: number;
        productionValue: number;
        valuationRule: string;
      };
      packaging: { cuneteUnitRate: number; cajaUnitRate: number };
    };
    expect(sheet.marmitas).toHaveLength(6);
    expect(sheet.totals.guavaKg).toBe(15);
    expect(sheet.totals.sugarKg).toBe(12);
    expect(sheet.totals.starchKg).toBe(1.5);
    expect(sheet.costs.materialsCost).toBeGreaterThan(0);
    expect(sheet.costs.packagingCost).toBeGreaterThan(0);
    expect(sheet.costs.productionValue).toBeGreaterThan(0);
    expect(sheet.costs.valuationRule).toContain('costo unitario vigente');
    expect(sheet.packaging.cuneteUnitRate).toBeGreaterThan(0);
    expect(sheet.packaging.cajaUnitRate).toBeGreaterThan(0);

    const after = (await request('/api/inventory/raw-materials'))
      .body as unknown as typeof rawMaterialsBefore;
    const stock = (id: string) =>
      after.find((material) => material.id === id)?.currentStock ?? 0;
    const beforeStock = (id: string) =>
      rawMaterialsBefore.find((material) => material.id === id)?.currentStock ??
      0;

    expect(beforeStock('rm-1') - stock('rm-1')).toBe(15);
    expect(beforeStock('rm-2') - stock('rm-2')).toBe(12);
    expect(beforeStock('rm-20') - stock('rm-20')).toBe(1.5);
    expect(beforeStock('rm-3') - stock('rm-3')).toBe(75);
    expect(beforeStock('rm-4') - stock('rm-4')).toBe(30);
    expect(beforeStock('rm-17') - stock('rm-17')).toBe(2);
    expect(beforeStock('rm-18') - stock('rm-18')).toBe(1);

    const finished = (await request('/api/inventory/finished-goods'))
      .body as unknown as {
      flavor: string;
      presentation: string;
      reservedUnits: number;
    }[];
    const cunete = finished.find(
      (good) =>
        good.flavor === 'Guayaba Criolla' &&
        good.presentation === 'pote_20kg'
    );
    const caja = finished.find(
      (good) =>
        good.flavor === 'Guayaba Criolla' && good.presentation === 'caja_20kg'
    );
    expect(cunete?.reservedUnits ?? 0).toBeGreaterThanOrEqual(2);
    expect(caja?.reservedUnits ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('does not deduct twice when the same lot is retried', async () => {
    const before = (await request('/api/inventory/raw-materials'))
      .body as unknown as typeof rawMaterialsBefore;

    const retry = await request('/api/production-orders/manual/sheet', 'POST', {
      lotNumber,
      productionDate: '2026-11-03',
      marmitas: [1, 2, 3, 4, 5, 6].map((n) => sheetRow(n)),
      packaging: { presentationKg: 20, cunetes: 2, cajas: 1 },
      processImmediately: true,
    });
    expect(retry.response.status).toBe(400);

    const after = (await request('/api/inventory/raw-materials'))
      .body as unknown as typeof rawMaterialsBefore;
    expect(after).toEqual(before);
  });

  it('does not persist a partial order when stock is insufficient', async () => {
    const { response } = await request('/api/production-orders/manual/sheet', 'POST', {
      lotNumber: 'L-TEST-SHEET-NO-STOCK',
      productionDate: '2026-11-03',
      marmitas: [1, 2, 3, 4, 5, 6].map((n) =>
        sheetRow(n, { guavaKg: 999_999 })
      ),
      packaging: { presentationKg: 20, cunetes: 1, cajas: 0 },
      processImmediately: true,
    });
    expect(response.status).toBe(400);

    const manualOrders = (await request('/api/production-orders/manual'))
      .body as unknown as { lotNumber: string }[];
    expect(
      manualOrders.some((order) => order.lotNumber === 'L-TEST-SHEET-NO-STOCK')
    ).toBe(false);
  });

  it('exposes the sheet detail and cost by lot', async () => {
    const list = (await request('/api/production-orders/manual'))
      .body as unknown as {
      id: string;
      lotNumber: string;
      manualSheet?: { costs: { totalCost: number; productionValue: number } };
    }[];
    const order = list.find((entry) => entry.id === orderId);
    expect(order?.lotNumber).toBe(lotNumber);
    expect(order?.manualSheet?.costs.totalCost).toBeGreaterThan(0);
    expect(order?.manualSheet?.costs.productionValue).toBeGreaterThan(0);
  });

  it('annuls the sheet and reverts inputs, packaging and production', async () => {
    const { response, body } = await request(
      `/api/production-orders/manual/${orderId}/annul`,
      'POST',
      {}
    );
    expect(response.status).toBe(200);
    expect((body['order'] as JsonBody)['status']).toBe('anulada');

    const after = (await request('/api/inventory/raw-materials'))
      .body as unknown as typeof rawMaterialsBefore;
    expect(
      after.find((material) => material.id === 'rm-1')?.currentStock
    ).toBe(rawMaterialsBefore.find((material) => material.id === 'rm-1')?.currentStock);
    expect(
      after.find((material) => material.id === 'rm-17')?.currentStock
    ).toBe(rawMaterialsBefore.find((material) => material.id === 'rm-17')?.currentStock);
  });
});

describe('sales collection with bank receiver', () => {
  let orderId = '';

  it('registers a collection using an official bank', async () => {
    const orders = (await request('/api/sales/orders')).body as unknown as {
      id: string;
      status: string;
      total: number;
    }[];
    expect(orders.length).toBeGreaterThan(0);
    const order = orders.find((candidate) => candidate.status !== 'cobrado')!;
    expect(order).toBeTruthy();
    orderId = order.id;

    const invalid = await request(`/api/sales/orders/${orderId}/collect`, 'POST', {
      bankCode: '9999',
      paymentMethod: 'transferencia_bancaria',
      reference: 'REF-INVALID',
    });
    expect(invalid.response.status).toBe(422);

    const { response, body } = await request(
      `/api/sales/orders/${orderId}/collect`,
      'POST',
      {
        bankCode: '0108',
        paymentMethod: 'transferencia_bancaria',
        reference: 'REF-PROV-001',
        amountUsd: order.total,
        exchangeRateUsed: 50,
      }
    );
    expect(response.status).toBe(200);
    expect(body['status']).toBe('cobrado');
    const collection = body['collection'] as JsonBody;
    expect(collection['bankCode']).toBe('0108');
    expect(collection['bankName']).toContain('Provincial');
    expect(collection['reference']).toBe('REF-PROV-001');
    expect(collection['amountBs']).toBe(Number((order.total * 50).toFixed(2)));
  });

  it('rejects collecting the same order twice', async () => {
    const { response } = await request(
      `/api/sales/orders/${orderId}/collect`,
      'POST',
      {
        bankCode: '0108',
        paymentMethod: 'pago_movil',
        reference: 'REF-DUP',
      }
    );
    expect(response.status).toBe(400);
  });
});

describe('expense issuing bank validation', () => {
  const baseExpense = {
    date: '2026-10-20',
    concept: 'Pago de servicios de prueba',
    category: 'alquiler_instalaciones',
    categoryLabel: 'Alquiler de Instalaciones / Planta',
    amountUsd: 120,
    exchangeRateUsed: 50,
    amountBs: 6000,
    supplierOrBeneficiary: 'Proveedor de Servicios C.A.',
    documentType: 'factura_fiscal',
    documentNumber: 'FACT-0001',
    paymentReference: 'REF-TEST',
    registeredBy: 'Admin de Prueba (Administrador General)',
    taxCategory: 'con_factura_iva',
    taxRatePercent: 16,
    fiscalBookEligible: true,
  };

  it('requires an issuing bank for bank payments', async () => {
    const { response, body } = await request('/api/expenses', 'POST', {
      ...baseExpense,
      paymentMethod: 'transferencia_bancaria',
    });
    expect(response.status).toBe(422);
    expect(JSON.stringify(body)).toContain('banco emisor');
  });

  it('stores the official bank code and name', async () => {
    const { response, body } = await request('/api/expenses', 'POST', {
      ...baseExpense,
      paymentMethod: 'pago_movil',
      issuingBankCode: '0134',
    });
    expect(response.status).toBe(201);
    expect(body['issuingBankCode']).toBe('0134');
    expect(body['issuingBankName']).toContain('Banesco');
  });

  it('does not require a bank for cash payments', async () => {
    const { response, body } = await request('/api/expenses', 'POST', {
      ...baseExpense,
      concept: 'Compra de insumos de limpieza',
      documentNumber: 'FACT-0002',
      paymentMethod: 'efectivo_usd',
    });
    expect(response.status).toBe(201);
    expect(body['issuingBankCode']).toBeUndefined();
  });
});
