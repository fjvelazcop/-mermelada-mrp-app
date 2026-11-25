import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, setDbPath } from './database/persistence';
import { loadRelationalState } from './database/relational-persistence';

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
      version: string;
      environment: string;
      uptimeSeconds: number;
      authEnabled: boolean;
      database: { path: string; connected: boolean };
      timestamp: string;
    };

    expect(body.status).toBe('ok');
    expect(body.version).toBeTruthy();
    expect(body.environment).toBeTruthy();
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof body.authEnabled).toBe('boolean');
    expect(body.database.connected).toBe(true);
    expect(body.database.path).toBe(dbPath);
    expect(Date.parse(body.timestamp)).not.toBeNaN();
  });

  it('serves a discoverable API index at /api', async () => {
    const { response, body } = await jsonRequest('/api', 'GET');

    expect(response.status).toBe(200);
    expect(body['name']).toBe('Mermelada ERP API');
    expect(body['health']).toBe('/api/health');
    expect(body['documentation']).toBe('/api/docs');
    expect(body['openapi']).toBe('/api/openapi.json');
    expect(body['login']).toBe('/api/auth/login');
    expect(body['message']).toContain('Bearer');
  });

  it('applies the security headers and hides the framework banner', async () => {
    const response = await fetch(`${baseUrl}/api/health`);

    expect(response.headers.get('x-powered-by')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin'
    );
    expect(response.headers.get('permissions-policy')).toContain(
      'geolocation=()'
    );
    expect(
      response.headers.get('content-security-policy-report-only')
    ).toContain("frame-ancestors 'none'");
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

  it('edita la ficha de un insumo, conserva la existencia y deja auditoría', async () => {
    const createdResponse = await fetch(
      `${baseUrl}/api/inventory/raw-materials`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...payload, code: 'TEST-API-EDIT-001'}),
      }
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {id: string};

    const response = await fetch(
      `${baseUrl}/api/inventory/raw-materials/${created.id}`,
      {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          category: 'quimico',
          name: 'Pectina API editada',
        }),
      }
    );
    expect(response.status).toBe(200);
    const updated = (await response.json()) as {
      category: string;
      currentStock: number;
    };
    expect(updated.category).toBe('quimico');
    expect(updated.currentStock).toBe(payload.currentStock);

    const row = getDb()
      .prepare('SELECT category, current_stock FROM raw_materials WHERE id = ?')
      .get(created.id) as {category: string; current_stock: number} | undefined;
    expect(row).toEqual({category: 'quimico', current_stock: 17});

    const audit = getDb()
      .prepare(
        `SELECT action_type, details_json FROM audit_logs
         WHERE action_type = 'insumo_actualizado' AND details_json LIKE ?`
      )
      .get(`%${created.id}%`) as
      | {action_type: string; details_json: string}
      | undefined;
    expect(audit?.action_type).toBe('insumo_actualizado');
    expect(audit?.details_json).toContain('quimico');
  });

  it('rechaza una categoría inexistente al editar un insumo', async () => {
    const createdResponse = await fetch(
      `${baseUrl}/api/inventory/raw-materials`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...payload, code: 'TEST-API-EDIT-002'}),
      }
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {id: string};

    const response = await fetch(
      `${baseUrl}/api/inventory/raw-materials/${created.id}`,
      {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({category: 'categoria_que_no_existe'}),
      }
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as {error: string};
    expect(body.error).toContain('categoría de materia prima');
    expect(body.error).toContain('no existe o está inactivo');
  });

  it('persiste la fecha elegida y la fecha real de registro del movimiento', async () => {
    const before = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string; name: string }[];
    const material = before[0];
    const effectiveDate = '2026-11-20';

    const response = await jsonRequest('/api/inventory/movements', 'POST', {
      materialId: material.id,
      materialName: material.name,
      type: 'entrada',
      quantity: 2,
      costPerUnit: 1,
      totalCost: 2,
      date: new Date().toISOString().slice(0, 10),
      movementDate: effectiveDate,
      performedBy: 'Test de fechas',
      referenceDoc: 'FECHA-TEST-1',
      paymentCondition: 'contado',
    });
    expect(response.response.status).toBe(201);
    const movementId = response.body['movement']['id'] as string;
    expect(response.body['movement']['movementDate']).toBe(effectiveDate);
    expect(response.body['movement']['registeredAt']).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const row = getDb()
      .prepare(
        'SELECT effective_date, registered_at, movement_date FROM inventory_movements WHERE id = ?'
      )
      .get(movementId) as {
      effective_date: string;
      registered_at: string;
      movement_date: string;
    } | undefined;
    expect(row?.effective_date).toBe(effectiveDate);
    expect(row?.registered_at).toBe(response.body['movement']['registeredAt']);
    expect(row?.movement_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rechaza una fecha de movimiento futura', async () => {
    const materials = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string; name: string }[];
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const response = await jsonRequest('/api/inventory/movements', 'POST', {
      materialId: materials[0].id,
      materialName: materials[0].name,
      type: 'entrada',
      quantity: 1,
      costPerUnit: 1,
      totalCost: 1,
      date: new Date().toISOString().slice(0, 10),
      movementDate: future,
      performedBy: 'Test de fechas',
    });
    expect(response.response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain('no puede ser futura');
  });

  it('audita el cambio de precios sin alterar costo base ni stock', async () => {
    const products = (await (
      await fetch(`${baseUrl}/api/inventory/finished-goods`)
    ).json()) as { id: string; code: string; baseCost: number; stockUnits: number }[];
    const product = products[0];
    expect(product).toBeTruthy();

    const response = await fetch(
      `${baseUrl}/api/inventory/finished-goods/${product.id}`,
      {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          suggestedWholesalePrice: 7.5,
          suggestedRetailPrice: 9,
          suggestedSpecialPrice: 10,
        }),
      }
    );
    expect(response.status).toBe(200);
    const updated = (await response.json()) as {
      baseCost: number;
      stockUnits: number;
      suggestedRetailPrice: number;
    };
    expect(updated.suggestedRetailPrice).toBe(9);
    expect(updated.baseCost).toBe(product.baseCost);
    expect(updated.stockUnits).toBe(product.stockUnits);

    const audit = getDb()
      .prepare(
        `SELECT details_json FROM audit_logs
         WHERE action_type = 'producto_terminado_actualizado' AND details_json LIKE ?`
      )
      .get(`%${product.id}%`) as {details_json: string} | undefined;
    expect(audit?.details_json).toContain('precio detal');
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
    '/api/payables',
    '/api/payables/payments',
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

  it('GET /api/accounting/books generates a provisional book', async () => {
    const { response, body } = await jsonRequest(
      '/api/accounting/books?type=diario&year=2026&month=11',
      'GET'
    );
    expect(response.status).toBe(200);
    expect(body['type']).toBe('diario');
    expect(body['periodKey']).toBe('2026-11');
    expect(Array.isArray(body['rows'])).toBe(true);
    expect((body['metadata'] as Record<string, unknown>)['provisional']).toBe(true);
  });

  it('GET /api/accounting/books generates the VEN-NIF inventory book', async () => {
    const { response, body } = await jsonRequest(
      '/api/accounting/books?type=inventario&year=2026&month=11',
      'GET'
    );
    expect(response.status).toBe(200);
    expect(body['type']).toBe('inventario');
    expect(String(body['title'])).toContain('VEN-NIF');
    expect(String(body['title'])).not.toContain('BORRADOR');
    expect((body['notes'] as unknown[]).join(' ')).toContain('Firmantes: Contador y socios');
    expect((body['metadata'] as Record<string, unknown>)['provisional']).toBe(false);
  });

  it('GET /api/reports/dashboard returns metrics', async () => {
    const response = await fetch(`${baseUrl}/api/reports/dashboard`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body).toBe('object');
  });
});

type JsonBody = Record<string, unknown>;

async function jsonRequest(
  path: string,
  method: string,
  body?: unknown
): Promise<{ response: Response; body: JsonBody }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await response.json()) as JsonBody;
  return { response, body: parsed };
}

describe('API documentation, 404s and auth defaults', () => {
  it('serves the OpenAPI document', async () => {
    const { response, body } = await jsonRequest('/api/openapi.json', 'GET');

    expect(response.status).toBe(200);
    expect(body['openapi']).toBe('3.0.3');
    const paths = body['paths'] as Record<string, unknown>;
    expect(paths['/api/health']).toBeTruthy();
    expect(paths['/api/auth/login']).toBeTruthy();
    expect(paths['/api/inventory/raw-materials']).toBeTruthy();
    expect(paths['/api/expenses/{id}']).toBeTruthy();
    expect(paths['/api/expenses/{id}/fiscal-eligibility']).toBeTruthy();
    expect(paths['/api/payables']).toBeTruthy();
    expect(paths['/api/payables/{id}/payments']).toBeTruthy();
    expect(paths['/api/fiscal-obligations']).toBeTruthy();
    expect(paths['/api/fiscal-obligations/{key}']).toBeTruthy();
    expect(paths['/api/fiscal-reference-catalog']).toBeTruthy();
    expect(paths['/api/fiscal-reference-values']).toBeTruthy();
    expect(paths['/api/accounting/books']).toBeTruthy();

    const components = body['components'] as {
      securitySchemes: { bearerAuth: { type: string; scheme: string } };
    };
    expect(components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });

    const schemas = (body['components'] as {
      schemas: Record<
        string,
        {properties?: Record<string, {enum?: string[]}>}
      >;
    }).schemas;
    expect(schemas['Payable']).toBeTruthy();
    expect(schemas['PayablePaymentResult']).toBeTruthy();
    expect(schemas['FiscalReferenceCatalogEntry']?.properties?.['taxpayerTypes']).toBeTruthy();
    expect(schemas['FiscalReferenceCatalogResponse']?.properties?.['entries']).toBeTruthy();
    expect(
      schemas['FiscalSettings']?.properties?.['digitalInvoicingEnabled']
    ).toBeTruthy();
    expect(
      schemas['FiscalSettings']?.properties?.['digitalInvoicingEnvironment']
        ?.enum
    ).toContain('pruebas');
    const presentationValues =
      schemas['ProductionOrder']?.properties?.['presentation']?.enum ?? [];
    expect(presentationValues).toContain('pequena_300g');
    expect(presentationValues).toContain('caja_6kg');
  });

  it('renders Swagger UI', async () => {
    const response = await fetch(`${baseUrl}/api/docs`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('swagger');
  });

  it('returns a JSON 404 for unknown API routes', async () => {
    const { response, body } = await jsonRequest('/api/does-not-exist', 'GET');
    expect(response.status).toBe(404);
    expect(body['code']).toBe('NOT_FOUND');
  });

  it('keeps auth disabled by default and still validates login credentials', async () => {
    const health = await jsonRequest('/api/health', 'GET');
    expect(health.body['authEnabled']).toBe(false);

    const open = await jsonRequest('/api/inventory/raw-materials', 'GET');
    expect(open.response.status).toBe(200);

    const badLogin = await jsonRequest('/api/auth/login', 'POST', {
      username: 'admin',
      password: 'incorrecta',
    });
    expect(badLogin.response.status).toBe(401);
    expect(badLogin.body['code']).toBe('UNAUTHORIZED');
  });
});

describe('payload validation', () => {
  it('rejects a raw material without a name', async () => {
    const { response, body } = await jsonRequest(
      '/api/inventory/raw-materials',
      'POST',
      {
        code: 'INVALID-1',
        category: 'fruta',
        currentStock: 1,
        minStock: 1,
        unit: 'kg',
        costPerUnit: 1,
        lastRestockDate: '2026-10-26',
      }
    );

    expect(response.status).toBe(422);
    expect(body['code']).toBe('VALIDATION_ERROR');
    const details = body['details'] as { issues: { path: string }[] };
    expect(details.issues.some((issue) => issue.path === 'name')).toBe(true);
  });

  it('rejects negative quantities and invalid enums', async () => {
    const negative = await jsonRequest('/api/inventory/raw-materials', 'POST', {
      code: 'INVALID-2',
      name: 'Stock negativo',
      category: 'fruta',
      currentStock: -5,
      minStock: 1,
      unit: 'kg',
      costPerUnit: 1,
      lastRestockDate: '2026-10-26',
    });
    expect(negative.response.status).toBe(422);

    const badMovement = await jsonRequest('/api/inventory/movements', 'POST', {
      materialId: 'x',
      materialName: 'X',
      type: 'tipo_invalido',
      quantity: 1,
      costPerUnit: 1,
      totalCost: 1,
      date: '2026-10-26',
      performedBy: 'Test',
    });
    expect(badMovement.response.status).toBe(422);
  });

  it('rejects invalid production and costing payloads', async () => {
    const production = await jsonRequest('/api/production-orders', 'POST', {
      recipeId: 'rec-1',
      batchCount: 0,
    });
    expect(production.response.status).toBe(422);

    const costing = await jsonRequest('/api/costing/simulate', 'POST', {
      directMaterial: -1,
    });
    expect(costing.response.status).toBe(422);
  });

  it('rejects out-of-range fiscal settings and exchange rates', async () => {
    const fiscal = await jsonRequest('/api/fiscal-settings', 'PUT', {
      taxRatePercent: 500,
    });
    expect(fiscal.response.status).toBe(422);

    const invalidRegime = await jsonRequest('/api/fiscal-settings', 'PUT', {
      taxRegime: 'inventado',
    });
    expect(invalidRegime.response.status).toBe(422);

    const invalidWithholding = await jsonRequest('/api/fiscal-settings', 'PUT', {
      vatWithholdingPercent: 150,
    });
    expect(invalidWithholding.response.status).toBe(422);

    const rates = await jsonRequest('/api/exchange-rates/update', 'POST', {
      usdRate: 0,
      usdtRate: 0,
    });
    expect(rates.response.status).toBe(422);
  });

  it('rejects an incomplete expense', async () => {
    const { response } = await jsonRequest('/api/expenses', 'POST', {
      concept: 'Sin datos obligatorios',
    });
    expect(response.status).toBe(422);
  });
});

describe('mutating endpoints', () => {
  const ctx: Record<string, string> = {};

  it('updates a raw material', async () => {
    const materials = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string }[];
    ctx['materialId'] = materials[0].id;

    const { response, body } = await jsonRequest(
      `/api/inventory/raw-materials/${ctx['materialId']}`,
      'PUT',
      { minStock: 9 }
    );
    expect(response.status).toBe(200);
    expect(body['minStock']).toBe(9);
  });

  it('returns 404 when updating an unknown raw material or finished good', async () => {
    const material = await jsonRequest(
      '/api/inventory/raw-materials/does-not-exist',
      'PUT',
      { minStock: 3 }
    );
    expect(material.response.status).toBe(404);

    const finished = await jsonRequest(
      '/api/inventory/finished-goods/does-not-exist',
      'PUT',
      { minStock: 3 }
    );
    expect(finished.response.status).toBe(404);
  });

  it('updates a finished good', async () => {
    const goods = (await (
      await fetch(`${baseUrl}/api/inventory/finished-goods`)
    ).json()) as { id: string }[];

    const { response, body } = await jsonRequest(
      `/api/inventory/finished-goods/${goods[0].id}`,
      'PUT',
      { minStock: 4 }
    );
    expect(response.status).toBe(200);
    expect(body['minStock']).toBe(4);
  });

  it('creates a finished good in draft and supports logical deactivation', async () => {
    const { response, body } = await jsonRequest('/api/inventory/finished-goods', 'POST', {
      code: 'PT-API-AREQUIPE',
      flavor: 'Arequipe',
      presentation: 'otra',
      presentationLabel: 'Tarro 500 g',
      weightGrams: 500,
      baseCost: 2.1,
      suggestedWholesalePrice: 3,
      suggestedRetailPrice: 3.8,
      suggestedSpecialPrice: 2.7,
      minStock: 10,
      notes: 'Borrador/prueba #13',
    });
    expect(response.status).toBe(201);
    expect(body['status']).toBe('borrador');
    expect(body['stockUnits']).toBe(0);
    expect(body['presentationLabel']).toBe('Tarro 500 g');
    expect(body['weightGrams']).toBe(500);

    const deactivated = await jsonRequest(
      `/api/inventory/finished-goods/${body['id']}`,
      'PUT',
      {status: 'inactivo'}
    );
    expect(deactivated.response.status).toBe(200);
    expect(deactivated.body['status']).toBe('inactivo');

    const logs = (await (
      await fetch(`${baseUrl}/api/audit-logs?module=inventario`)
    ).json()) as { actionType: string }[];
    expect(logs.map((log) => log.actionType)).toContain('producto_terminado_creado');
    expect(logs.map((log) => log.actionType)).toContain('producto_terminado_actualizado');
  });

  it('rejects duplicate custom presentation labels for draft products', async () => {
    const payload = {
      code: 'PT-API-AREQUIPE-DUP',
      flavor: 'Arequipe',
      presentation: 'otra',
      presentationLabel: 'Tarro 500 g',
      weightGrams: 500,
      baseCost: 2.1,
      suggestedWholesalePrice: 3,
      suggestedRetailPrice: 3.8,
      suggestedSpecialPrice: 2.7,
      minStock: 10,
    };
    const { response } = await jsonRequest('/api/inventory/finished-goods', 'POST', payload);
    expect(response.status).toBe(400);
  });

  it('manages the editable presentation catalog', async () => {
    const initial = (await (
      await fetch(`${baseUrl}/api/presentation-types`)
    ).json()) as { id: string; code: string }[];
    expect(initial.some((item) => item.code === 'pequena_250g')).toBe(true);

    const created = await jsonRequest('/api/presentation-types', 'POST', {
      code: 'frasco_api_500g',
      label: 'Frasco API 500 g',
      weightGrams: 500,
      active: true,
    });
    expect(created.response.status).toBe(201);
    expect(created.body['isSystem']).toBe(false);

    const updated = await jsonRequest(
      `/api/presentation-types/${created.body['id']}`,
      'PUT',
      {label: 'Frasco API 500 g (editado)'}
    );
    expect(updated.response.status).toBe(200);
    expect(updated.body['label']).toBe('Frasco API 500 g (editado)');

    const deleted = await jsonRequest(
      `/api/presentation-types/${created.body['id']}`,
      'DELETE'
    );
    expect(deleted.response.status).toBe(200);
  });

  it('creates a BOM recipe preserving a custom presentation label and weight', async () => {
    const materials = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string; name: string; unit: string }[];
    const material = materials[0];

    const { response, body } = await jsonRequest('/api/recipes', 'POST', {
      code: 'REC-API-AREQUIPE',
      name: 'Arequipe industrial',
      flavor: 'Arequipe',
      presentation: 'otra',
      presentationLabel: 'Tarro API 500 g',
      weightGrams: 500,
      batchSizeUnits: 40,
      items: [
        {
          materialId: material.id,
          materialName: material.name,
          quantity: 10,
          unit: material.unit,
          estimatedCost: 12.5,
        },
      ],
      directLaborMinutes: 45,
      estimatedUtilityCost: 3,
      instructions: 'Cocción lenta.',
    });
    expect(response.status).toBe(201);
    expect(body['presentation']).toBe('otra');
    expect(body['presentationLabel']).toBe('Tarro API 500 g');
    expect(body['weightGrams']).toBe(500);

    const recipes = (await (
      await fetch(`${baseUrl}/api/recipes`)
    ).json()) as { code: string; presentationLabel?: string }[];
    expect(recipes.some((recipe) => recipe.code === 'REC-API-AREQUIPE')).toBe(true);
  });

  it('records inventory movements and updates stock', async () => {
    const before = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string; name: string; unit: string; currentStock: number }[];
    const material = before.find((m) => m.id === ctx['materialId'])!;

    const entry = await jsonRequest('/api/inventory/movements', 'POST', {
      materialId: material.id,
      materialName: material.name,
      type: 'entrada',
      quantity: 3,
      costPerUnit: 2,
      totalCost: 6,
      date: '2026-10-26',
      performedBy: 'Test de integración',
      referenceDoc: 'FACT-TEST-1',
      paymentCondition: 'contado',
      paymentMethod: 'transferencia_bancaria',
      notes: 'Entrada de prueba',
    });
    expect(entry.response.status).toBe(201);
    expect(entry.body['movement']).toBeTruthy();
    expect(entry.body['payable']).toBeNull();
    expect(entry.body['movement']['payableId']).toBeFalsy();

    const exit = await jsonRequest('/api/inventory/movements', 'POST', {
      materialId: material.id,
      materialName: material.name,
      type: 'salida_produccion',
      quantity: 1,
      costPerUnit: 2,
      totalCost: 2,
      date: '2026-10-26',
      performedBy: 'Test de integración',
    });
    expect(exit.response.status).toBe(201);

    const movements = (await (
      await fetch(`${baseUrl}/api/inventory/movements`)
    ).json()) as { id: string }[];
    expect(movements.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps legacy cash entries without payment condition or supplier', async () => {
    const materials = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string; name: string }[];
    const material = materials[0];

    const legacy = await jsonRequest('/api/inventory/movements', 'POST', {
      materialId: material.id,
      materialName: material.name,
      type: 'entrada',
      quantity: 1,
      costPerUnit: 2,
      totalCost: 2,
      date: '2026-10-26',
      performedBy: 'Test compatibilidad',
      referenceDoc: 'ENTRADA-RAPIDA-LEGACY',
      notes: 'Reposición express sin proveedor',
    });
    expect(legacy.response.status).toBe(201);
    expect(legacy.body['movement']['paymentCondition']).toBe('contado');
    expect(legacy.body['payable']).toBeNull();
  });

  it('creates and processes a production order', async () => {
    const materials = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string; name: string; unit: string }[];
    const material = materials[0];

    const recipe = await jsonRequest('/api/recipes', 'POST', {
      code: 'REC-TEST-001',
      name: 'Receta de prueba',
      flavor: 'Guayaba',
      presentation: 'pequena_250g',
      batchSizeUnits: 10,
      items: [
        {
          materialId: material.id,
          materialName: material.name,
          quantity: 0.05,
          unit: material.unit,
          estimatedCost: 0.1,
        },
      ],
      directLaborMinutes: 30,
      estimatedUtilityCost: 5,
      instructions: 'Cocción de prueba',
    });
    expect(recipe.response.status).toBe(201);
    ctx['recipeId'] = (recipe.body['id'] as string);

    const order = await jsonRequest('/api/production-orders', 'POST', {
      recipeId: ctx['recipeId'],
      batchCount: 2,
      lotNumber: 'L-TEST-001',
      operatorNotes: 'Orden de prueba',
    });
    expect(order.response.status).toBe(201);
    const orderBody = order.body as {
      order: { id: string; status: string; targetUnits: number };
    };
    expect(orderBody.order.targetUnits).toBe(20);
    ctx['productionOrderId'] = orderBody.order.id;

    const processed = await jsonRequest(
      `/api/production-orders/${ctx['productionOrderId']}/process`,
      'POST'
    );
    expect(processed.response.status).toBe(200);
    expect((processed.body as { success: boolean }).success).toBe(true);

    const again = await jsonRequest(
      `/api/production-orders/${ctx['productionOrderId']}/process`,
      'POST'
    );
    expect(again.response.status).toBe(400);
  });

  it('returns 400 for business errors on production orders', async () => {
    const unknownRecipe = await jsonRequest('/api/production-orders', 'POST', {
      recipeId: 'missing-recipe',
      batchCount: 1,
    });
    expect(unknownRecipe.response.status).toBe(400);

    const unknownOrder = await jsonRequest(
      '/api/production-orders/missing-order/process',
      'POST'
    );
    expect(unknownOrder.response.status).toBe(400);
  });

  it('creates a customer, a sales order and its delivery note', async () => {
    const customer = await jsonRequest('/api/sales/customers', 'POST', {
      businessName: 'Panadería de Prueba C.A.',
      taxId: 'J-99999999-9',
      contactPerson: 'Cliente Prueba',
      phone: '0414-0000000',
      email: 'prueba@example.com',
      address: 'Caracas',
      clientType: 'panaderia',
      creditLimit: 500,
      paymentTerms: 'Contado',
    });
    expect(customer.response.status).toBe(201);
    const customerId = customer.body['id'] as string;

    const goods = (await (
      await fetch(`${baseUrl}/api/inventory/finished-goods`)
    ).json()) as {
      id: string;
      flavor: string;
      presentation: string;
      presentationLabel: string;
      suggestedWholesalePrice: number;
    }[];
    const good = goods[0];

    const order = await jsonRequest('/api/sales/orders', 'POST', {
      customerId,
      customerName: 'Panadería de Prueba C.A.',
      customerTaxId: 'J-99999999-9',
      orderDate: '2026-10-26',
      deliveryDate: '2026-10-28',
      status: 'pendiente',
      exchangeRateUsed: 50,
      items: [
        {
          finishedGoodId: good.id,
          flavor: good.flavor,
          presentation: good.presentation,
          presentationLabel: good.presentationLabel,
          quantity: 2,
          unitPrice: good.suggestedWholesalePrice,
          subtotal: Number((good.suggestedWholesalePrice * 2).toFixed(2)),
        },
      ],
      subtotal: Number((good.suggestedWholesalePrice * 2).toFixed(2)),
      taxAmount: 0.32,
      total: Number((good.suggestedWholesalePrice * 2 + 0.32).toFixed(2)),
      notes: 'Pedido de prueba',
    });
    expect(order.response.status).toBe(201);
    const salesOrderId = order.body['id'] as string;

    const status = await jsonRequest(
      `/api/sales/orders/${salesOrderId}/status`,
      'PUT',
      { status: 'en_produccion' }
    );
    expect(status.response.status).toBe(200);
    expect(status.body['status']).toBe('en_produccion');

    const mto = await jsonRequest(
      `/api/sales/orders/${salesOrderId}/create-production-order`,
      'POST'
    );
    expect([200, 201]).toContain(mto.response.status);

    const note = await jsonRequest(
      `/api/sales/orders/${salesOrderId}/create-delivery-note`,
      'POST',
      { transporter: 'Camión de prueba' }
    );
    expect(note.response.status).toBe(201);
    expect(note.body['transporter']).toBe('Camión de prueba');
    expect(note.body['noteNumber']).toMatch(/^NE-\d{6}$/);

    const notes = (await (
      await fetch(`${baseUrl}/api/sales/delivery-notes`)
    ).json()) as { id: string }[];
    expect(notes.some((n) => n.id === note.body['id'])).toBe(true);
  });

  it('blocks sales orders when fiscal data is incomplete', async () => {
    const { dbInstance } = await import('./erp-database.js');
    const settings = dbInstance.getFiscalSettings();
    const customer = dbInstance.getCustomers()[0];
    const originalTaxId = customer.taxId;

    const goods = (await (
      await fetch(`${baseUrl}/api/inventory/finished-goods`)
    ).json()) as {
      id: string;
      flavor: string;
      presentation: string;
      presentationLabel: string;
      suggestedWholesalePrice: number;
    }[];
    const good = goods[0];
    const subtotal = Number((good.suggestedWholesalePrice * 2).toFixed(2));

    const buildOrder = (customerId: string) => ({
      customerId,
      customerName: 'Cliente de prueba',
      customerTaxId: 'J-99999999-9',
      orderDate: '2026-10-30',
      deliveryDate: '2026-11-05',
      status: 'pendiente',
      items: [
        {
          finishedGoodId: good.id,
          flavor: good.flavor,
          presentation: good.presentation,
          presentationLabel: good.presentationLabel,
          quantity: 2,
          unitPrice: good.suggestedWholesalePrice,
          subtotal,
        },
      ],
      subtotal,
      taxAmount: 0.32,
      total: Number((subtotal + 0.32).toFixed(2)),
    });

    try {
      dbInstance.updateFiscalSettings({ companyName: '' });
      const noFiscalConfig = await jsonRequest(
        '/api/sales/orders',
        'POST',
        buildOrder(customer.id)
      );
      expect(noFiscalConfig.response.status).toBe(400);
      expect(noFiscalConfig.body['error']).toContain('configuración fiscal');
    } finally {
      dbInstance.updateFiscalSettings({
        companyName: settings.companyName,
      });
    }

    try {
      customer.taxId = '';
      const noTaxId = await jsonRequest(
        '/api/sales/orders',
        'POST',
        buildOrder(customer.id)
      );
      expect(noTaxId.response.status).toBe(400);
      expect(noTaxId.body['error']).toContain('RIF');
    } finally {
      customer.taxId = originalTaxId;
    }

    const unknownCustomer = await jsonRequest(
      '/api/sales/orders',
      'POST',
      buildOrder('missing-customer')
    );
    expect(unknownCustomer.response.status).toBe(404);
    expect(unknownCustomer.body['error']).toContain('Cliente no encontrado');
  });

  it('emits a consecutive fiscal invoice and annuls it without reusing numbers', async () => {
    const fiscalBefore = await jsonRequest('/api/fiscal-settings', 'GET');
    expect(fiscalBefore.response.status).toBe(200);
    const settings = fiscalBefore.body as {
      invoiceSerie: string;
      nextInvoiceNumber: number;
      nextControlNumber: number;
      invoicePrefix: string;
    };

    const customers = (await (
      await fetch(`${baseUrl}/api/sales/customers`)
    ).json()) as {
      id: string;
      businessName: string;
      taxId: string;
    }[];
    const customer = customers[0];

    const goods = (await (
      await fetch(`${baseUrl}/api/inventory/finished-goods`)
    ).json()) as {
      id: string;
      flavor: string;
      presentation: string;
      presentationLabel: string;
      suggestedWholesalePrice: number;
    }[];
    const good = goods[0];
    const subtotal = Number((good.suggestedWholesalePrice * 2).toFixed(2));
    const taxAmount = Number((subtotal * 0.16).toFixed(2));

    const order = await jsonRequest('/api/sales/orders', 'POST', {
      customerId: customer.id,
      customerName: customer.businessName,
      customerTaxId: customer.taxId,
      orderDate: '2026-10-31',
      deliveryDate: '2026-11-05',
      status: 'pendiente',
      exchangeRateUsed: 50,
      items: [
        {
          finishedGoodId: good.id,
          flavor: good.flavor,
          presentation: good.presentation,
          presentationLabel: good.presentationLabel,
          quantity: 2,
          unitPrice: good.suggestedWholesalePrice,
          subtotal,
        },
      ],
      subtotal,
      taxAmount,
      total: Number((subtotal + taxAmount).toFixed(2)),
    });
    expect(order.response.status).toBe(201);

    interface Invoice {
      id: string;
      serie: string;
      invoiceNumber: number;
      controlNumber: number;
      salesOrderId: string;
      status: string;
      saleCondition: string;
      creditDays: number;
      emitterSnapshot: Record<string, unknown>;
      customerSnapshot: { taxId: string };
      annulledBy?: string;
      annulmentReason?: string;
    }

    const invoices = (await (
      await fetch(`${baseUrl}/api/fiscal-invoices`)
    ).json()) as Invoice[];
    const invoice = invoices.find((i) => i.salesOrderId === order.body['id']);
    expect(invoice).toBeTruthy();
    expect(invoice!.serie).toBe(settings.invoiceSerie);
    expect(invoice!.invoiceNumber).toBe(settings.nextInvoiceNumber);
    expect(invoice!.controlNumber).toBe(settings.nextControlNumber);
    expect(invoice!.status).toBe('emitida');
    expect(invoice!.customerSnapshot.taxId).toBe(customer.taxId);
    expect(invoice!.saleCondition).toBe(order.body['saleCondition']);
    expect(invoice!.creditDays).toBe(order.body['creditDays'] ?? 30);
    expect(
      (invoice!.emitterSnapshot as Record<string, unknown>)['printNotes']
    ).toBe((fiscalBefore.body as Record<string, unknown>)['printNotes']);

    const firstPrint = await jsonRequest(
      `/api/fiscal-invoices/${invoice!.id}/print`,
      'POST',
      {}
    );
    expect(firstPrint.response.status).toBe(200);
    expect(firstPrint.body['isDuplicate']).toBe(false);
    expect(
      (firstPrint.body['invoice'] as Record<string, unknown>)['printCount']
    ).toBe(1);

    const secondPrint = await jsonRequest(
      `/api/fiscal-invoices/${invoice!.id}/print`,
      'POST',
      {}
    );
    expect(secondPrint.response.status).toBe(200);
    expect(secondPrint.body['isDuplicate']).toBe(true);
    expect(
      (secondPrint.body['invoice'] as Record<string, unknown>)['printCount']
    ).toBe(2);

    const printAudit = getDb()
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE action_type IN ('factura_impresa', 'factura_reimpresa') AND details_json LIKE ?"
      )
      .get(`%${invoice!.id}%`) as {count: number};
    expect(printAudit.count).toBe(2);
    const printCount = getDb()
      .prepare('SELECT print_count FROM fiscal_invoices WHERE id = ?')
      .get(invoice!.id) as {print_count: number};
    expect(printCount.print_count).toBe(2);

    const fiscalAfter = await jsonRequest('/api/fiscal-settings', 'GET');
    expect(fiscalAfter.body['nextInvoiceNumber']).toBe(
      settings.nextInvoiceNumber + 1
    );
    expect(fiscalAfter.body['nextControlNumber']).toBe(
      settings.nextControlNumber + 1
    );

    const annulled = await jsonRequest(
      `/api/fiscal-invoices/${invoice!.id}/annul`,
      'POST',
      { reason: 'Error en los datos del cliente' }
    );
    expect(annulled.response.status).toBe(200);
    expect(annulled.body['status']).toBe('anulada');
    expect(annulled.body['annulmentReason']).toBe(
      'Error en los datos del cliente'
    );

    const again = await jsonRequest(
      `/api/fiscal-invoices/${invoice!.id}/annul`,
      'POST',
      { reason: 'Segundo intento' }
    );
    expect(again.response.status).toBe(400);

    const persisted = getDb()
      .prepare(
        'SELECT status, annulled_by, annulment_reason FROM fiscal_invoices WHERE id = ?'
      )
      .get(invoice!.id) as Record<string, unknown>;
    expect(persisted['status']).toBe('anulada');
    expect(persisted['annulled_by']).toBeTruthy();
    expect(persisted['annulment_reason']).toBe('Error en los datos del cliente');
  });

  it('validates fiscal identity, BCV conversion and both consecutive numbers before creating an order', async () => {
    const { dbInstance } = await import('./erp-database.js');
    const originalSettings = { ...dbInstance.getFiscalSettings() };
    const originalUsdRate = dbInstance.getExchangeRates().currentUsd;
    const customer = dbInstance.getCustomers()[0];
    const originalTaxId = customer.taxId;
    const good = dbInstance.getFinishedGoods()[0];
    const existingInvoice = dbInstance.getFiscalInvoices()[0];
    expect(existingInvoice).toBeTruthy();

    const subtotal = 20;
    const orderPayload = (customerTaxId = customer.taxId) => ({
      customerId: customer.id,
      customerName: customer.businessName,
      customerTaxId,
      orderDate: new Date().toISOString().slice(0, 10),
      deliveryDate: new Date().toISOString().slice(0, 10),
      status: 'pendiente',
      exchangeRateUsed: 50,
      items: [
        {
          finishedGoodId: good.id,
          flavor: good.flavor,
          presentation: good.presentation,
          presentationLabel: good.presentationLabel,
          quantity: 1,
          unitPrice: subtotal,
          subtotal,
          unitPriceBs: 1,
          subtotalBs: 1,
        },
      ],
      subtotal,
      taxAmount: Number(
        ((subtotal * originalSettings.taxRatePercent) / 100).toFixed(2)
      ),
      total: Number(
        (
          subtotal +
          (subtotal * originalSettings.taxRatePercent) / 100
        ).toFixed(2)
      ),
    });

    try {
      const startingOrderCount = dbInstance.getSalesOrders().length;
      const mismatchedRif = await jsonRequest(
        '/api/sales/orders',
        'POST',
        orderPayload('J-11111111-1')
      );
      expect(mismatchedRif.response.status).toBe(400);
      expect(mismatchedRif.body['error']).toContain('no coincide');

      customer.taxId = 'identificacion-invalida';
      const invalidRif = await jsonRequest(
        '/api/sales/orders',
        'POST',
        orderPayload(customer.taxId)
      );
      expect(invalidRif.response.status).toBe(400);
      expect(invalidRif.body['error']).toContain('RIF venezolano válido');
      customer.taxId = originalTaxId;

      const invalidRate = await jsonRequest('/api/sales/orders', 'POST', {
        ...orderPayload(),
        exchangeRateUsed: 0,
      });
      expect(invalidRate.response.status).toBe(422);

      dbInstance.getExchangeRates().currentUsd = 0;
      const missingBcvRate = await jsonRequest('/api/sales/orders', 'POST', {
        ...orderPayload(),
        exchangeRateUsed: undefined,
      });
      expect(missingBcvRate.response.status).toBe(400);
      expect(missingBcvRate.body['error']).toContain('tasa BCV');
      dbInstance.getExchangeRates().currentUsd = originalUsdRate;

      dbInstance.updateFiscalSettings({
        invoiceSerie: existingInvoice.serie,
        nextInvoiceNumber: existingInvoice.invoiceNumber,
        nextControlNumber: originalSettings.nextControlNumber + 100,
      });
      const duplicateInvoiceNumber = await jsonRequest(
        '/api/sales/orders',
        'POST',
        orderPayload()
      );
      expect(duplicateInvoiceNumber.response.status).toBe(400);
      expect(duplicateInvoiceNumber.body['error']).toContain(
        'ya fue emitido'
      );

      dbInstance.updateFiscalSettings({
        invoiceSerie: 'VALIDATION',
        nextInvoiceNumber: 1,
        nextControlNumber: existingInvoice.controlNumber,
      });
      const duplicateControlNumber = await jsonRequest(
        '/api/sales/orders',
        'POST',
        orderPayload()
      );
      expect(duplicateControlNumber.response.status).toBe(400);
      expect(duplicateControlNumber.body['error']).toContain(
        'número de control'
      );

      expect(dbInstance.getSalesOrders()).toHaveLength(startingOrderCount);
      expect(
        dbInstance.getFiscalInvoices().some(
          (invoice) => invoice.salesOrderId === duplicateInvoiceNumber.body['id']
        )
      ).toBe(false);
    } finally {
      customer.taxId = originalTaxId;
      dbInstance.getExchangeRates().currentUsd = originalUsdRate;
      dbInstance.updateFiscalSettings(originalSettings);
    }

    const accepted = await jsonRequest(
      '/api/sales/orders',
      'POST',
      orderPayload()
    );
    expect(accepted.response.status).toBe(201);
    expect(
      (accepted.body['items'] as { unitPriceBs: number }[])[0].unitPriceBs
    ).toBe(1000);
  });

  it('calculates invoice VAT by line and preserves exempt and non-subject treatments', async () => {
    const customers = (await (
      await fetch(`${baseUrl}/api/sales/customers`)
    ).json()) as { id: string; businessName: string; taxId: string }[];
    const goods = (await (
      await fetch(`${baseUrl}/api/inventory/finished-goods`)
    ).json()) as {
      id: string;
      flavor: string;
      presentation: string;
      presentationLabel: string;
    }[];
    const customer = customers[0];
    const good = goods[0];
    const items = [
      { taxCategory: 'gravado', taxRatePercent: 16.5 },
      { taxCategory: 'gravado', taxRatePercent: 8 },
      { taxCategory: 'exento', taxRatePercent: 16 },
      { taxCategory: 'no_sujeto', taxRatePercent: 16 },
    ].map(({ taxCategory, taxRatePercent }) => ({
      finishedGoodId: good.id,
      flavor: good.flavor,
      presentation: good.presentation,
      presentationLabel: good.presentationLabel,
      quantity: 1,
      unitPrice: 1.01,
      subtotal: 1.01,
      taxCategory,
      taxRatePercent,
    }));

    const order = await jsonRequest('/api/sales/orders', 'POST', {
      customerId: customer.id,
      customerName: customer.businessName,
      customerTaxId: customer.taxId,
      orderDate: '2026-10-31',
      deliveryDate: '2026-11-05',
      status: 'pendiente',
      exchangeRateUsed: 50,
      items,
      subtotal: 4.04,
      taxAmount: 0,
      total: 4.04,
    });
    expect(order.response.status).toBe(201);
    expect(order.body['subtotal']).toBe(4.04);
    expect(order.body['taxAmount']).toBe(0.25);
    expect(order.body['total']).toBe(4.29);

    const invoices = (await (
      await fetch(`${baseUrl}/api/fiscal-invoices`)
    ).json()) as {
      salesOrderId: string;
      subtotal: number;
      taxAmount: number;
      total: number;
      items: {
        taxCategory: string;
        taxRatePercent: number;
        taxAmount: number;
        total: number;
      }[];
    }[];
    const invoice = invoices.find(
      (candidate) => candidate.salesOrderId === order.body['id']
    );
    expect(invoice).toMatchObject({
      subtotal: 4.04,
      taxAmount: 0.25,
      total: 4.29,
    });
    expect(invoice?.items.map((item) => item.taxAmount)).toEqual([
      0.17,
      0.08,
      0,
      0,
    ]);
    expect(invoice?.items.map((item) => item.taxCategory)).toEqual([
      'gravado',
      'gravado',
      'exento',
      'no_sujeto',
    ]);

    const invalidTaxRate = await jsonRequest('/api/sales/orders', 'POST', {
      customerId: customer.id,
      customerName: customer.businessName,
      customerTaxId: customer.taxId,
      orderDate: '2026-10-31',
      deliveryDate: '2026-11-05',
      status: 'pendiente',
      items: [{ ...items[0], taxRatePercent: 0 }],
      subtotal: 1.01,
      taxAmount: 0,
      total: 1.01,
    });
    expect(invalidTaxRate.response.status).toBe(422);
  });

  it('returns 404/400 for unknown sales resources', async () => {
    const missingStatus = await jsonRequest(
      '/api/sales/orders/missing/status',
      'PUT',
      { status: 'pendiente' }
    );
    expect(missingStatus.response.status).toBe(404);

    const missingMto = await jsonRequest(
      '/api/sales/orders/missing/create-production-order',
      'POST'
    );
    expect(missingMto.response.status).toBe(404);

    const missingNote = await jsonRequest(
      '/api/sales/orders/missing/create-delivery-note',
      'POST',
      { transporter: 'X' }
    );
    expect(missingNote.response.status).toBe(400);
  });

  it('registers employees and payroll weeks', async () => {
    const employee = await jsonRequest('/api/payroll/employees', 'POST', {
      fullName: 'Empleado de Prueba',
      nationalId: 'V-00000000',
      roleTitle: 'Operario',
      weeklyBaseSalary: 60,
      hourlyRate: 1.5,
      status: 'activo',
    });
    expect(employee.response.status).toBe(201);
    const employeeId = employee.body['id'] as string;

    const week = await jsonRequest('/api/payroll/weeks', 'POST', {
      weekNumber: 42,
      year: 2026,
      startDate: '2026-10-12',
      endDate: '2026-10-18',
      isActiveProduction: true,
      payments: [
        {
          employeeId,
          employeeName: 'Empleado de Prueba',
          roleTitle: 'Operario',
          baseAmount: 60,
          productionBonus: 5,
          deductions: 1,
          netPaid: 64,
        },
      ],
      totalPayrollPaid: 64,
      fixedAbsorptionCost: 0,
      notes: 'Semana de prueba',
    });
    expect(week.response.status).toBe(201);
    expect(week.body['weekNumber']).toBe(42);
  });

  it('da de baja a un operario con pagos y bloquea su eliminación', async () => {
    const employee = await jsonRequest('/api/payroll/employees', 'POST', {
      fullName: 'Operario Con Pagos',
      nationalId: 'V-TEST-BAJA-1',
      roleTitle: 'Cargo Histórico de Prueba',
      weeklyBaseSalary: 60,
      hourlyRate: 1.5,
      status: 'activo',
    });
    expect(employee.response.status).toBe(201);
    const employeeId = employee.body['id'] as string;

    const week = await jsonRequest('/api/payroll/weeks', 'POST', {
      weekNumber: 52,
      year: 2026,
      startDate: '2026-09-21',
      endDate: '2026-09-27',
      isActiveProduction: true,
      payments: [
        {
          employeeId,
          employeeName: 'Operario Con Pagos',
          roleTitle: 'Cargo Histórico de Prueba',
          baseAmount: 60,
          productionBonus: 5,
          deductions: 1,
          netPaid: 64,
        },
      ],
      totalPayrollPaid: 64,
      fixedAbsorptionCost: 0,
    });
    expect(week.response.status).toBe(201);

    const blocked = await jsonRequest(`/api/payroll/employees/${employeeId}`, 'DELETE');
    expect(blocked.response.status).toBe(409);
    expect(blocked.body['code']).toBe('EMPLOYEE_HAS_PAYMENTS');

    const deactivated = await jsonRequest(`/api/payroll/employees/${employeeId}`, 'PATCH', {
      status: 'inactivo',
    });
    expect(deactivated.response.status).toBe(200);
    expect(deactivated.body['status']).toBe('inactivo');

    const list = await jsonRequest('/api/payroll/employees', 'GET');
    expect(list.body).toEqual(
      expect.arrayContaining([expect.objectContaining({id: employeeId, status: 'inactivo'})])
    );

    const reactivated = await jsonRequest(`/api/payroll/employees/${employeeId}`, 'PATCH', {
      status: 'activo',
    });
    expect(reactivated.body['status']).toBe('activo');
  });

  it('elimina un operario sin pagos registrados', async () => {
    const employee = await jsonRequest('/api/payroll/employees', 'POST', {
      fullName: 'Operario Sin Pagos',
      nationalId: 'V-TEST-BAJA-2',
      roleTitle: 'Cargo Nuevo de Prueba',
      weeklyBaseSalary: 50,
      hourlyRate: 1.25,
      status: 'activo',
    });
    expect(employee.response.status).toBe(201);
    const employeeId = employee.body['id'] as string;

    const deleted = await jsonRequest(`/api/payroll/employees/${employeeId}`, 'DELETE');
    expect(deleted.response.status).toBe(200);

    const list = await jsonRequest('/api/payroll/employees', 'GET');
    expect(list.body).not.toEqual(
      expect.arrayContaining([expect.objectContaining({id: employeeId})])
    );

    const missing = await jsonRequest('/api/payroll/employees/emp-inexistente', 'PATCH', {
      status: 'inactivo',
    });
    expect(missing.response.status).toBe(404);
  });

  it('persiste en SQLite el alta, la baja, la reactivación y la eliminación de operarios', async () => {
    const employee = await jsonRequest('/api/payroll/employees', 'POST', {
      fullName: 'Operario Persistencia',
      nationalId: 'V-TEST-PERSIST-1',
      roleTitle: 'Cargo Persistente',
      weeklyBaseSalary: 55,
      hourlyRate: 1.38,
      status: 'activo',
    });
    expect(employee.response.status).toBe(201);
    const employeeId = employee.body['id'] as string;

    const row = () =>
      getDb().prepare('SELECT status FROM employees WHERE id = ?').get(employeeId) as
        | {status: string}
        | undefined;
    expect(row()?.status).toBe('activo');

    const deactivated = await jsonRequest(`/api/payroll/employees/${employeeId}`, 'PATCH', {
      status: 'inactivo',
    });
    expect(deactivated.response.status).toBe(200);
    expect(row()?.status).toBe('inactivo');
    // Simula el reinicio del servicio: el estado se reconstruye desde SQLite.
    expect(loadRelationalState()?.employees.find((item) => item.id === employeeId)?.status).toBe(
      'inactivo'
    );

    const reactivated = await jsonRequest(`/api/payroll/employees/${employeeId}`, 'PATCH', {
      status: 'activo',
    });
    expect(reactivated.response.status).toBe(200);
    expect(row()?.status).toBe('activo');
    expect(loadRelationalState()?.employees.find((item) => item.id === employeeId)?.status).toBe(
      'activo'
    );

    const deleted = await jsonRequest(`/api/payroll/employees/${employeeId}`, 'DELETE');
    expect(deleted.response.status).toBe(200);
    expect(row()).toBeUndefined();
    expect(loadRelationalState()?.employees.some((item) => item.id === employeeId)).toBe(false);

    const auditRows = getDb()
      .prepare(
        "SELECT action_type AS actionType, details_json AS detailsJson FROM audit_logs WHERE action_type LIKE 'operario_%'"
      )
      .all() as {actionType: string; detailsJson: string | null}[];
    const ownActions = auditRows
      .filter((entry) => (entry.detailsJson || '').includes(employeeId))
      .map((entry) => entry.actionType);
    expect(ownActions).toEqual(
      expect.arrayContaining([
        'operario_inactivado',
        'operario_activado',
        'operario_eliminado',
      ])
    );
  });

  it('marca vacaciones con auditoría propia y las persiste tras reinicio', async () => {
    const employee = await jsonRequest('/api/payroll/employees', 'POST', {
      fullName: 'Operario Vacaciones',
      nationalId: 'V-TEST-VAC-1',
      roleTitle: 'Cargo de Prueba',
      weeklyBaseSalary: 65,
      hourlyRate: 1.63,
      status: 'activo',
    });
    expect(employee.response.status).toBe(201);
    const employeeId = employee.body['id'] as string;

    const vacation = await jsonRequest(`/api/payroll/employees/${employeeId}`, 'PATCH', {
      status: 'vacaciones',
    });
    expect(vacation.response.status).toBe(200);
    expect(vacation.body['status']).toBe('vacaciones');
    expect(
      loadRelationalState()?.employees.find((item) => item.id === employeeId)?.status
    ).toBe('vacaciones');

    const auditRows = getDb()
      .prepare(
        'SELECT action_type AS actionType, details_json AS detailsJson FROM audit_logs WHERE action_type = ?'
      )
      .all('operario_vacaciones') as {actionType: string; detailsJson: string | null}[];
    expect(auditRows.some((entry) => (entry.detailsJson || '').includes(employeeId))).toBe(true);

    const invalid = await jsonRequest(`/api/payroll/employees/${employeeId}`, 'PATCH', {
      status: 'desconocido',
    });
    expect(invalid.response.status).toBe(422);
  });

  it('registers and deletes expenses', async () => {
    const expense = await jsonRequest('/api/expenses', 'POST', {
      date: '2026-10-26',
      concept: 'Gasto de prueba',
      category: 'otros',
      categoryLabel: 'Otros',
      amountUsd: 25,
      exchangeRateUsed: 50,
      supplierOrBeneficiary: 'Proveedor de prueba',
      documentType: 'recibo_pago',
      paymentMethod: 'efectivo_usd',
      registeredBy: 'Test',
      taxCategory: 'no_sujeto',
      fiscalBookEligible: false,
    });
    expect(expense.response.status).toBe(201);
    const expenseId = expense.body['id'] as string;
    const auditCount = (actionType: string) =>
      (getDb()
        .prepare(
          'SELECT COUNT(*) AS count FROM audit_logs WHERE audit_module = ? AND action_type = ? AND details_json LIKE ?'
        )
        .get('gastos', actionType, `%${expenseId}%`) as {count: number}).count;
    expect(auditCount('gasto_registrado')).toBeGreaterThan(0);

    const toggled = await jsonRequest(
      `/api/expenses/${expenseId}/fiscal-eligibility`,
      'PATCH',
      {fiscalBookEligible: true}
    );
    expect(toggled.response.status).toBe(200);
    expect(toggled.body['fiscalBookEligible']).toBe(true);
    const eligibilityAudit = getDb()
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE action_type = 'gasto_elegibilidad_actualizada' AND details_json LIKE ?"
      )
      .get(`%${expenseId}%`) as {count: number};
    expect(eligibilityAudit.count).toBeGreaterThan(0);

    const deleted = await jsonRequest(`/api/expenses/${expenseId}`, 'DELETE');
    expect(deleted.response.status).toBe(200);
    expect(auditCount('gasto_eliminado')).toBeGreaterThan(0);

    const missing = await jsonRequest('/api/expenses/missing', 'DELETE');
    expect(missing.response.status).toBe(404);
  });

  it('derives the USD amount from bolívares using the local rate', async () => {
    const expense = await jsonRequest('/api/expenses', 'POST', {
      date: '2026-10-26',
      concept: 'Gasto capturado en bolívares',
      category: 'otros',
      categoryLabel: 'Otros',
      amountBs: 5000,
      amountUsd: 999,
      exchangeRateUsed: 50,
      supplierOrBeneficiary: 'Proveedor de prueba',
      documentType: 'recibo_pago',
      paymentMethod: 'efectivo_bs',
      registeredBy: 'Test',
      taxCategory: 'no_sujeto',
      fiscalBookEligible: false,
    });

    expect(expense.response.status).toBe(201);
    expect(expense.body['amountBs']).toBe(5000);
    expect(expense.body['amountUsd']).toBe(100);
    expect(expense.body['exchangeRateUsed']).toBe(50);

    await jsonRequest(`/api/expenses/${expense.body['id']}`, 'DELETE');
  });

  it('creates, updates and deletes an expense category', async () => {
    const created = await jsonRequest('/api/expenses/categories', 'POST', {
      name: 'Categoría de prueba',
      icon: 'receipt',
      color: 'sky',
      monthlyBudgetUsd: 100,
      description: 'Categoría creada por tests',
    });
    expect(created.response.status).toBe(201);
    const categoryId = created.body['id'] as string;
    const categoryAuditCount = (actionType: string) =>
      (getDb()
        .prepare(
          'SELECT COUNT(*) AS count FROM audit_logs WHERE audit_module = ? AND action_type = ? AND details_json LIKE ?'
        )
        .get('gastos', actionType, `%${categoryId}%`) as {count: number}).count;
    expect(categoryAuditCount('categoria_gasto_creada')).toBeGreaterThan(0);

    const updated = await jsonRequest(
      `/api/expenses/categories/${categoryId}`,
      'PUT',
      { monthlyBudgetUsd: 250 }
    );
    expect(updated.response.status).toBe(200);
    expect(updated.body['monthlyBudgetUsd']).toBe(250);
    expect(categoryAuditCount('categoria_gasto_actualizada')).toBeGreaterThan(0);

    const deleted = await jsonRequest(
      `/api/expenses/categories/${categoryId}`,
      'DELETE'
    );
    expect(deleted.response.status).toBe(200);
    expect(categoryAuditCount('categoria_gasto_eliminada')).toBeGreaterThan(0);

    const missingUpdate = await jsonRequest(
      '/api/expenses/categories/missing',
      'PUT',
      { monthlyBudgetUsd: 1 }
    );
    expect(missingUpdate.response.status).toBe(404);

    const missingDelete = await jsonRequest(
      '/api/expenses/categories/missing',
      'DELETE'
    );
    expect(missingDelete.response.status).toBe(404);
  });

  it('updates fiscal settings, exchange rates and costing simulations', async () => {
    const fiscal = await jsonRequest('/api/fiscal-settings', 'PUT', {
      taxRatePercent: 16.5,
      printNotes: 'Notas de prueba',
    });
    expect(fiscal.response.status).toBe(200);
    expect(fiscal.body['taxRatePercent']).toBe(16.5);

    const rates = await jsonRequest('/api/exchange-rates/update', 'POST', {
      usdRate: 49.1,
      usdtRate: 53.2,
      source: 'Test',
      notes: 'Tasa de prueba',
    });
    expect(rates.response.status).toBe(200);
    expect(rates.body['currentUsd']).toBe(49.1);

    const live = await jsonRequest('/api/exchange-rates', 'GET');
    expect(live.response.status).toBe(200);
    expect(live.body['currentUsdt']).toBe(53.2);

    const simulation = await jsonRequest('/api/costing/simulate', 'POST', {
      directMaterial: 1,
      directPackaging: 0.5,
      directLabor: 0.3,
      utilityCost: 0.1,
      inactiveWeeksCount: 2,
      targetMarginWholesale: 30,
      targetMarginRetail: 45,
    });
    expect(simulation.response.status).toBe(200);
    expect(simulation.body['totalUnitCost']).toBe(2.27);
  });

  it('persists the extended fiscal settings and restricts writes to admin', async () => {
    const denied = await fetch(`${baseUrl}/api/fiscal-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-demo-role': 'operator',
      },
      body: JSON.stringify({ companyName: 'No autorizado C.A.' }),
    });
    expect(denied.status).toBe(403);

    const payload = {
      companyPhone: '+58 412-1234567',
      companyEmail: 'fiscal@mermeladasdelvalle.com',
      economicActivity: 'Fabricación de conservas de frutas',
      taxRegime: 'especial',
      invoiceSerie: 'B',
      controlPrefix: 'CTRL-B-',
      nextControlNumber: 500,
      authorizationValidUntil: '2027-04-18',
      branchName: 'Sucursal Maracay',
      branchAddress: 'Av. Bolívar, Maracay',
      vatWithholdingAgent: true,
      vatWithholdingPercent: 75,
      islrWithholdingAgent: true,
      islrWithholdingPercent: 5,
      specialTaxpayer: true,
      booksFormat: 'pdf',
      historicalOrdersTreatment: 'no_emitir',
      authorizationCode: 'AUTH-SECRET-DO-NOT-LOG',
      digitalInvoicingEnabled: true,
      digitalInvoicingProvider: 'Proveedor Digital Prueba',
      digitalInvoicingProviderTaxId: 'J-12345678-9',
      digitalInvoicingApiUrl: 'https://digital.example.com/api',
      digitalInvoicingEnvironment: 'pruebas',
      digitalInvoicingStartDate: '2027-04-01',
      digitalInvoicingNotes: 'Borrador de configuración',
    };

    const updated = await jsonRequest(
      '/api/fiscal-settings',
      'PUT',
      payload
    );
    expect(updated.response.status).toBe(200);
    for (const [key, value] of Object.entries(payload)) {
      expect(updated.body[key]).toEqual(value);
    }

    const read = await jsonRequest('/api/fiscal-settings', 'GET');
    expect(read.response.status).toBe(200);
    expect(read.body).toMatchObject(payload);

    const row = getDb()
      .prepare(
        `SELECT company_phone, tax_regime, invoice_serie, next_control_number,
                special_taxpayer, books_format, digital_invoicing_enabled,
                digital_invoicing_provider, digital_invoicing_environment,
                digital_invoicing_start_date
           FROM fiscal_settings WHERE id = 1`
      )
      .get() as Record<string, unknown>;
    expect(row).toMatchObject({
      company_phone: payload.companyPhone,
      tax_regime: 'especial',
      invoice_serie: 'B',
      next_control_number: 500,
      special_taxpayer: 1,
      books_format: 'pdf',
      digital_invoicing_enabled: 1,
      digital_invoicing_provider: payload.digitalInvoicingProvider,
      digital_invoicing_environment: 'pruebas',
      digital_invoicing_start_date: '2027-04-01',
    });

    const auditLogs = (await (
      await fetch(`${baseUrl}/api/audit-logs?module=ventas`)
    ).json()) as {
      actionType: string;
      userId: string;
      userRole: string;
      details?: { changes?: string[] };
    }[];
    const settingsAudit = auditLogs.find(
      (entry) => entry.actionType === 'configuracion_fiscal_actualizada'
    );
    expect(settingsAudit).toMatchObject({
      userId: 'usr-admin',
      userRole: 'admin',
    });
    expect(settingsAudit?.details?.changes).toContain(
      'taxRegime: "ordinario" → "especial"'
    );
    expect(
      settingsAudit?.details?.changes?.find((change) =>
        change.startsWith('authorizationCode:')
      )
    ).toBe('authorizationCode: [oculto] → [oculto]');
    expect(JSON.stringify(settingsAudit)).not.toContain(
      'AUTH-SECRET-DO-NOT-LOG'
    );

    const persistedAudit = getDb()
      .prepare(
        'SELECT user_id, user_role, details_json FROM audit_logs WHERE action_type = ? ORDER BY rowid DESC LIMIT 1'
      )
      .get('configuracion_fiscal_actualizada') as {
      user_id: string;
      user_role: string;
      details_json: string;
    };
    expect(persistedAudit.user_id).toBe('usr-admin');
    expect(persistedAudit.user_role).toBe('admin');
    expect(persistedAudit.details_json).not.toContain(
      'AUTH-SECRET-DO-NOT-LOG'
    );
  });

  it('rejects an incomplete digital invoicing configuration when marked ready', async () => {
    const {response, body} = await jsonRequest('/api/fiscal-settings', 'PUT', {
      digitalInvoicingEnabled: true,
      digitalInvoicingProvider: '',
    });
    expect(response.status).toBe(422);
    expect(JSON.stringify(body)).toContain('digitalInvoicingProvider');
  });

  it('auto-marks SPE agents on ordinario -> especial without enabling withholdings', async () => {
    const reset = await jsonRequest('/api/fiscal-settings', 'PUT', {
      taxRegime: 'ordinario',
      specialTaxpayer: false,
      vatWithholdingAgent: false,
      islrWithholdingAgent: false,
    });
    expect(reset.response.status).toBe(200);

    const transition = await jsonRequest('/api/fiscal-settings', 'PUT', {
      taxRegime: 'especial',
    });
    expect(transition.response.status).toBe(200);
    expect(transition.body['taxRegime']).toBe('especial');
    expect(transition.body['specialTaxpayer']).toBe(true);
    expect(transition.body['vatWithholdingAgent']).toBe(true);
    expect(transition.body['islrWithholdingAgent']).toBe(true);
    expect(transition.body['vatWithholdingEnabled']).toBe(false);
    expect(transition.body['islrWithholdingEnabled']).toBe(false);

    const row = getDb()
      .prepare(
        `SELECT tax_regime, special_taxpayer, vat_withholding_agent,
                islr_withholding_agent, vat_withholding_enabled,
                islr_withholding_enabled
           FROM fiscal_settings WHERE id = 1`
      )
      .get() as Record<string, unknown>;
    expect(row).toMatchObject({
      tax_regime: 'especial',
      special_taxpayer: 1,
      vat_withholding_agent: 1,
      islr_withholding_agent: 1,
      vat_withholding_enabled: 0,
      islr_withholding_enabled: 0,
    });

    const logs = (await (
      await fetch(`${baseUrl}/api/audit-logs?module=ventas`)
    ).json()) as { details?: { autoSpecialTaxpayerTransition?: boolean } }[];
    expect(
      logs.some((entry) => entry.details?.autoSpecialTaxpayerTransition === true)
    ).toBe(true);
  });

  it('records fiscal obligation decisions and keeps a separate history for admins', async () => {
    const deniedRead = await fetch(`${baseUrl}/api/fiscal-obligations`, {
      headers: { 'x-demo-role': 'operator' },
    });
    expect(deniedRead.status).toBe(403);

    const initial = await jsonRequest('/api/fiscal-obligations', 'GET');
    expect(initial.response.status).toBe(200);
    expect((initial.body['obligations'] as unknown[]).length).toBeGreaterThan(0);

    const deniedUpdate = await fetch(
      `${baseUrl}/api/fiscal-obligations/vat_withholding`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-demo-role': 'operator',
        },
        body: JSON.stringify({
          applicability: 'aplica',
          normativeReference: 'Providencia aplicable',
          reviewedAt: '2026-10-31',
          notes: 'Confirmado por contador',
        }),
      }
    );
    expect(deniedUpdate.status).toBe(403);

    const update = await jsonRequest('/api/fiscal-obligations/vat_withholding', 'PUT', {
      applicability: 'aplica',
      normativeReference: 'Constancia revisada por contador',
      reviewedAt: '2026-10-31',
      notes: 'La empresa no fue designada agente de retención.',
    });
    expect(update.response.status).toBe(200);
    expect(update.body).toMatchObject({
      key: 'vat_withholding',
      applicability: 'aplica',
      updatedBy: 'Administrador (demo)',
      updatedByRole: 'admin',
    });

    const updatedState = await jsonRequest('/api/fiscal-obligations', 'GET');
    const history = updatedState.body['history'] as {
      obligationKey: string;
      previous: { applicability: string };
      current: { applicability: string };
      userRole: string;
    }[];
    expect(history[0]).toMatchObject({
      obligationKey: 'vat_withholding',
      previous: { applicability: 'no_aplica' },
      current: { applicability: 'aplica' },
      userRole: 'admin',
    });

    const persistedHistory = getDb()
      .prepare(
        'SELECT obligation_key, previous_json, current_json, user_role FROM fiscal_obligation_history ORDER BY rowid DESC LIMIT 1'
      )
      .get() as {
      obligation_key: string;
      previous_json: string;
      current_json: string;
      user_role: string;
    };
    expect(persistedHistory.obligation_key).toBe('vat_withholding');
    expect(JSON.parse(persistedHistory.previous_json)).toMatchObject({
      applicability: 'no_aplica',
    });
    expect(JSON.parse(persistedHistory.current_json)).toMatchObject({
      applicability: 'aplica',
    });
    expect(persistedHistory.user_role).toBe('admin');

    const invalid = await jsonRequest('/api/fiscal-obligations/unknown', 'PUT', {
      applicability: 'aplica',
      normativeReference: '',
      reviewedAt: '',
      notes: '',
    });
    expect(invalid.response.status).toBe(422);

    const missingEvidence = await jsonRequest(
      '/api/fiscal-obligations/igtf',
      'PUT',
      {
        applicability: 'aplica',
        normativeReference: '',
        reviewedAt: '',
        notes: '',
      }
    );
    expect(missingEvidence.response.status).toBe(422);
  });

  it('serves costing and dashboard reports', async () => {
    const costing = await jsonRequest('/api/costing/summary', 'GET');
    expect(costing.response.status).toBe(200);
    expect(costing.body['costBreakdownByPresentation']).toBeTruthy();

    const dashboard = await jsonRequest('/api/reports/dashboard', 'GET');
    expect(dashboard.response.status).toBe(200);
    expect(dashboard.body['monthlySales']).toBeTruthy();
    expect(dashboard.body['inventoryTurnover']).toBeTruthy();
  });

  it('records and filters audit logs', async () => {
    const created = await jsonRequest('/api/audit-logs', 'POST', {
      module: 'gastos',
      actionType: 'gasto_registrado',
      title: 'Gasto de prueba auditado',
      description: 'Registro creado por la suite de integración',
      userId: 'usr-admin',
      userName: 'Administrador',
      userRole: 'admin',
      severity: 'info',
      details: { targetId: 'test', costUsd: 25 },
    });
    expect(created.response.status).toBe(201);
    expect(created.body['id']).toBeTruthy();

    const filtered = (await (
      await fetch(`${baseUrl}/api/audit-logs?module=gastos`)
    ).json()) as { module: string }[];
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((entry) => entry.module === 'gastos')).toBe(true);
  });

  it('refreshes exchange rates from the external feed or fallback', async () => {
    const { response, body } = await jsonRequest(
      '/api/exchange-rates/refresh',
      'POST'
    );
    expect(response.status).toBe(200);
    expect(typeof body['currentUsd']).toBe('number');
  });

  it('registers payables, rejects overpayment and generates one expense on full payment', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const expensesBefore = (
      (await (await fetch(`${baseUrl}/api/expenses`)).json()) as unknown[]
    ).length;

    const created = await jsonRequest('/api/payables', 'POST', {
      supplierName: 'Insumos del Llano C.A.',
      taxId: 'J-12345678-9',
      invoiceNumber: 'F-CXP-001',
      issueDate: today,
      dueDate: today,
      amountUsd: 100,
      exchangeRateUsed: 50,
      category: 'materia_prima',
    });
    expect(created.response.status).toBe(201);
    expect(created.body['payableNumber']).toBe(`FAP-${year}-001`);
    expect(created.body['status']).toBe('pendiente');
    const payableId = created.body['id'] as string;

    const badBank = await jsonRequest(`/api/payables/${payableId}/payments`, 'POST', {
      bankCode: '9999',
      paymentMethod: 'transferencia_bancaria',
      reference: 'CXP-BAD-BANK',
      amountUsd: 10,
    });
    expect(badBank.response.status).toBe(422);

    const partial = await jsonRequest(`/api/payables/${payableId}/payments`, 'POST', {
      bankCode: '0108',
      paymentMethod: 'transferencia_bancaria',
      reference: 'CXP-REF-001',
      amountUsd: 40,
    });
    expect(partial.response.status).toBe(201);
    expect(partial.body['payment']).toMatchObject({amountUsd: 40, bankCode: '0108'});
    expect((partial.body['payable'] as {status: string}).status).toBe('parcial');
    expect(partial.body['expense']).toBeUndefined();

    const duplicate = await jsonRequest(`/api/payables/${payableId}/payments`, 'POST', {
      bankCode: '0108',
      paymentMethod: 'transferencia_bancaria',
      reference: 'cxp-ref-001',
      amountUsd: 1,
    });
    expect(duplicate.response.status).toBe(400);

    const overpayment = await jsonRequest(`/api/payables/${payableId}/payments`, 'POST', {
      bankCode: '0108',
      paymentMethod: 'transferencia_bancaria',
      reference: 'CXP-REF-OVER',
      amountUsd: 61,
    });
    expect(overpayment.response.status).toBe(400);

    const history = await jsonRequest(`/api/payables/${payableId}/payments`, 'GET');
    expect(history.response.status).toBe(200);
    expect((history.body as unknown[]).length).toBe(1);

    const paid = await jsonRequest(`/api/payables/${payableId}/payments`, 'POST', {
      bankCode: '0108',
      paymentMethod: 'transferencia_bancaria',
      reference: 'CXP-REF-002',
      amountUsd: 60,
    });
    expect(paid.response.status).toBe(201);
    expect((paid.body['payable'] as {status: string}).status).toBe('pagada');
    const expense = paid.body['expense'] as {id: string; payableId: string} | undefined;
    expect(expense?.payableId).toBe(payableId);

    const expensesAfter = (
      (await (await fetch(`${baseUrl}/api/expenses`)).json()) as unknown[]
    ).length;
    expect(expensesAfter).toBe(expensesBefore + 1);

    const books = await jsonRequest(`/api/fiscal-books/${year}/${month}`, 'GET');
    expect(books.response.status).toBe(200);
    const purchaseRows = books.body['purchaseRows'] as {documentNumber: string}[];
    expect(purchaseRows.some((row) => row.documentNumber.includes('F-CXP-001'))).toBe(true);

    const annulPaid = await jsonRequest(`/api/payables/${payableId}`, 'PATCH', {
      status: 'anulada',
    });
    expect(annulPaid.response.status).toBe(400);

    const second = await jsonRequest('/api/payables', 'POST', {
      supplierName: 'Servicios Industriales C.A.',
      invoiceNumber: 'F-CXP-002',
      issueDate: today,
      dueDate: today,
      amountUsd: 25,
      exchangeRateUsed: 50,
      category: 'otros',
    });
    expect(second.response.status).toBe(201);
    const annulled = await jsonRequest(
      `/api/payables/${second.body['id'] as string}`,
      'PATCH',
      {status: 'anulada'}
    );
    expect(annulled.response.status).toBe(200);
    expect(annulled.body['status']).toBe('anulada');

    const audits = await jsonRequest('/api/audit-logs?module=gastos', 'GET');
    const actions = (audits.body as {actionType: string}[]).map((entry) => entry.actionType);
    expect(actions).toContain('payable_registrado');
    expect(actions).toContain('payable_pago_registrado');
    expect(actions).toContain('payable_anulado');
  });

  it('creates a payable for credit inventory purchases and rejects duplicates', async () => {
    const supplier = await jsonRequest('/api/suppliers', 'POST', {
      businessName: 'Insumos Integración CxP C.A.',
      taxId: 'J-77889900-1',
      primaryContact: 'Prueba CxP',
      primaryPhone: '+58 414 555 0199',
      fiscalAddress: 'Zona Industrial, Barquisimeto',
      supplierType: 'envases',
      paymentTerms: 'Crédito a 15 días',
      status: 'activo',
    });
    expect(supplier.response.status).toBe(201);
    const supplierId = supplier.body['id'] as string;
    const materials = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string; name: string; currentStock: number }[];
    const material = materials[0];
    const stockBefore = material.currentStock;
    const referenceDoc = `FACT-CXP-${Date.now()}`;

    const creditPurchase = await jsonRequest('/api/inventory/movements', 'POST', {
      materialId: material.id,
      materialName: material.name,
      type: 'entrada',
      quantity: 2,
      costPerUnit: 5,
      totalCost: 10,
      date: '2026-10-26',
      performedBy: 'Test CxP',
      paymentCondition: 'credito',
      supplierId,
      referenceDoc,
      dueDate: '2026-11-10',
      creditDays: 15,
    });
    expect(creditPurchase.response.status).toBe(201);
    const payable = creditPurchase.body['payable'] as {
      id: string;
      payableNumber: string;
      invoiceNumber: string;
      amountUsd: number;
    } | null;
    expect(payable).toBeTruthy();
    expect(payable!.invoiceNumber).toBe(referenceDoc);
    expect(payable!.amountUsd).toBe(10);
    expect(creditPurchase.body['movement']['payableId']).toBe(payable!.id);
    expect(creditPurchase.body['movement']['payableNumber']).toBe(payable!.payableNumber);

    const materialsAfter = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string; currentStock: number }[];
    expect(materialsAfter.find((item) => item.id === material.id)!.currentStock).toBe(stockBefore + 2);

    const accountingEntries = (await (
      await fetch(`${baseUrl}/api/accounting/entries`)
    ).json()) as {sourceType: string; sourceId: string; status: string; lines: {accountCode: string}[]}[];
    const movementEntry = accountingEntries.find(
      (entry) =>
        entry.sourceType === 'inventario' &&
        entry.sourceId === creditPurchase.body['movement']['id']
    );
    expect(movementEntry?.status).toBe('confirmado');
    expect(movementEntry?.lines.map((line) => line.accountCode)).toEqual(['1.03.01', '2.01.01']);

    const payables = (await (
      await fetch(`${baseUrl}/api/payables`)
    ).json()) as { id: string; invoiceNumber: string }[];
    expect(payables.some((item) => item.id === payable!.id)).toBe(true);

    const repeatedLine = await jsonRequest('/api/inventory/movements', 'POST', {
      materialId: material.id,
      materialName: material.name,
      type: 'entrada',
      quantity: 2,
      costPerUnit: 5,
      totalCost: 10,
      date: '2026-10-26',
      performedBy: 'Test CxP',
      paymentCondition: 'credito',
      supplierId,
      referenceDoc,
    });
    expect(repeatedLine.response.status).toBe(201);
    expect(repeatedLine.body['reused']).toBe(true);
    expect(repeatedLine.body['payable']['amountUsd']).toBe(10);
    expect(repeatedLine.body['movement']['id']).toBe(
      creditPurchase.body['movement']['id']
    );

    const materialsAfterReuse = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string; currentStock: number }[];
    expect(materialsAfterReuse.find((item) => item.id === material.id)!.currentStock).toBe(
      stockBefore + 2
    );

    const missingReference = await jsonRequest('/api/inventory/movements', 'POST', {
      materialId: material.id,
      materialName: material.name,
      type: 'entrada',
      quantity: 1,
      costPerUnit: 5,
      totalCost: 5,
      date: '2026-10-26',
      performedBy: 'Test CxP',
      paymentCondition: 'credito',
      supplierId,
    });
    expect(missingReference.response.status).toBe(422);
    expect(missingReference.body['code']).toBe('MISSING_CREDIT_REFERENCE');

    await jsonRequest(`/api/payables/${payable!.id}`, 'PATCH', {status: 'anulada'});
  });

  it('does not change stock when a credit purchase collides with an existing manual CxP', async () => {
    const suffix = Date.now().toString(36);
    const supplier = await jsonRequest('/api/suppliers', 'POST', {
      businessName: `Proveedor Manual First ${suffix} C.A.`,
      taxId: `J-${suffix.slice(-7).toUpperCase()}-2`,
      primaryContact: 'Prueba colisión CxP',
      primaryPhone: '+58 414 555 0197',
      fiscalAddress: 'Zona Industrial, Barquisimeto',
      supplierType: 'envases',
      paymentTerms: 'Crédito a 15 días',
      status: 'activo',
    });
    expect(supplier.response.status).toBe(201);
    const supplierId = supplier.body['id'] as string;
    const materials = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string; name: string; currentStock: number }[];
    const material = materials[0];
    const stockBefore = material.currentStock;
    const referenceDoc = `FACT-MANUAL-FIRST-${suffix}`;

    const manual = await jsonRequest('/api/payables', 'POST', {
      supplierId,
      supplierName: supplier.body['businessName'],
      invoiceNumber: referenceDoc,
      issueDate: '2026-10-28',
      dueDate: '2026-11-12',
      amountUsd: 15,
      exchangeRateUsed: 50,
      category: 'materia_prima',
    });
    expect(manual.response.status).toBe(201);

    const collision = await jsonRequest('/api/inventory/movements', 'POST', {
      materialId: material.id,
      materialName: material.name,
      type: 'entrada',
      quantity: 4,
      costPerUnit: 5,
      totalCost: 20,
      date: '2026-10-28',
      performedBy: 'Test CxP',
      paymentCondition: 'credito',
      supplierId,
      referenceDoc,
      dueDate: '2026-11-12',
      creditDays: 15,
    });
    expect(collision.response.status).toBe(409);
    expect(collision.body['code']).toBe('DUPLICATE_PAYABLE');
    expect(collision.body['origin']).toBe('manual');

    const materialsAfter = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string; currentStock: number }[];
    expect(materialsAfter.find((item) => item.id === material.id)!.currentStock).toBe(stockBefore);
  });

  it('groups inventory credit lines into one payable and keeps manual CxP separate', async () => {
    const suffix = Date.now().toString(36);
    const supplier = await jsonRequest('/api/suppliers', 'POST', {
      businessName: `Proveedor Unificado ${suffix} C.A.`,
      taxId: `J-${suffix.slice(-7).toUpperCase()}-1`,
      primaryContact: 'Prueba CxP unificada',
      primaryPhone: '+58 414 555 0198',
      fiscalAddress: 'Zona Industrial, Barquisimeto',
      supplierType: 'envases',
      paymentTerms: 'Crédito a 15 días',
      status: 'activo',
    });
    expect(supplier.response.status).toBe(201);
    const supplierId = supplier.body['id'] as string;
    const supplierName = supplier.body['businessName'] as string;
    const materials = (await (
      await fetch(`${baseUrl}/api/inventory/raw-materials`)
    ).json()) as { id: string; name: string }[];
    const [firstMaterial, secondMaterial] = materials;
    const referenceDoc = `FACT-UNIFICADA-${suffix}`;

    const purchase = async (material: {id: string; name: string}, quantity: number, totalCost: number) =>
      jsonRequest('/api/inventory/movements', 'POST', {
        materialId: material.id,
        materialName: material.name,
        type: 'entrada',
        quantity,
        costPerUnit: totalCost / quantity,
        totalCost,
        date: '2026-10-27',
        performedBy: 'Test CxP unificada',
        paymentCondition: 'credito',
        supplierId,
        referenceDoc,
        dueDate: '2026-11-11',
        creditDays: 15,
      });

    const first = await purchase(firstMaterial, 2, 20);
    expect(first.response.status).toBe(201);
    const payable = first.body['payable'] as {id: string; payableNumber: string; amountUsd: number; origin: string};
    expect(payable.origin).toBe('compra_inventario');
    expect(payable.amountUsd).toBe(20);

    const second = await purchase(secondMaterial, 3, 30);
    expect(second.response.status).toBe(201);
    expect(second.body['reused']).toBe(false);
    expect(second.body['updated']).toBe(true);
    expect(second.body['payable']['id']).toBe(payable.id);
    expect(second.body['payable']['amountUsd']).toBe(50);

    const repeated = await purchase(firstMaterial, 2, 20);
    expect(repeated.response.status).toBe(201);
    expect(repeated.body['reused']).toBe(true);
    expect(repeated.body['payable']['amountUsd']).toBe(50);
    expect(repeated.body['movement']['id']).toBe(first.body['movement']['id']);

    const payables = (await (
      await fetch(`${baseUrl}/api/payables`)
    ).json()) as {id: string; origin?: string; linkedMovementCount?: number}[];
    const unified = payables.find((item) => item.id === payable.id)!;
    expect(unified.origin).toBe('compra_inventario');
    expect(unified.linkedMovementCount).toBe(2);

    const manualDuplicate = await jsonRequest('/api/payables', 'POST', {
      supplierId,
      supplierName,
      invoiceNumber: referenceDoc,
      issueDate: '2026-10-27',
      dueDate: '2026-11-11',
      amountUsd: 50,
      exchangeRateUsed: 50,
      category: 'materia_prima',
    });
    expect(manualDuplicate.response.status).toBe(409);
    expect(manualDuplicate.body['code']).toBe('DUPLICATE_PAYABLE');
    expect(manualDuplicate.body['origin']).toBe('compra_inventario');
    expect(manualDuplicate.body['payableNumber']).toBe(payable.payableNumber);

    const manual = await jsonRequest('/api/payables', 'POST', {
      supplierId,
      supplierName,
      invoiceNumber: `FACT-MANUAL-${suffix}`,
      issueDate: '2026-10-27',
      dueDate: '2026-11-11',
      amountUsd: 12,
      exchangeRateUsed: 50,
      category: 'materia_prima',
    });
    expect(manual.response.status).toBe(201);
    expect(manual.body['origin']).toBe('manual');

    const partial = await jsonRequest(`/api/payables/${payable.id}/payments`, 'POST', {
      bankCode: '0108',
      paymentMethod: 'transferencia_bancaria',
      reference: `PAGO-${suffix}`,
      amountUsd: 10,
      paidAt: '2026-11-05',
    });
    expect(partial.response.status).toBe(201);
    expect(partial.body['payable']['status']).toBe('parcial');
    expect(partial.body['payable']['origin']).toBe('compra_inventario');

    await jsonRequest(`/api/payables/${payable.id}`, 'PATCH', {status: 'anulada'});
    await jsonRequest(`/api/payables/${manual.body['id'] as string}`, 'PATCH', {status: 'anulada'});
  });

  it('issues adjustment notes, reports fiscal books and locks a closed period', async () => {
    const fiscalResponse = await jsonRequest('/api/fiscal-settings', 'GET');
    const fiscal = fiscalResponse.body as {
      taxRatePercent: number;
      nextCreditNoteNumber: number;
      nextDebitNoteNumber: number;
      nextControlNumber: number;
    };
    const customers = (await (
      await fetch(`${baseUrl}/api/sales/customers`)
    ).json()) as {
      id: string;
      businessName: string;
      taxId: string;
    }[];
    const goods = (await (
      await fetch(`${baseUrl}/api/inventory/finished-goods`)
    ).json()) as {
      id: string;
      flavor: string;
      presentation: string;
      presentationLabel: string;
    }[];
    const customer = customers[0];
    const good = goods[0];
    const subtotal = 20.25;
    const taxAmount = Number(
      ((subtotal * fiscal.taxRatePercent) / 100).toFixed(2)
    );
    const today = new Date().toISOString().slice(0, 10);
    const orderPayload = {
      customerId: customer.id,
      customerName: customer.businessName,
      customerTaxId: customer.taxId,
      customerNit: '123456789',
      saleCondition: 'contado',
      paymentMethod: 'efectivo_bs',
      orderDate: today,
      deliveryDate: today,
      status: 'pendiente',
      items: [
        {
          finishedGoodId: good.id,
          flavor: good.flavor,
          presentation: good.presentation,
          presentationLabel: good.presentationLabel,
          quantity: 1,
          unitPrice: subtotal,
          subtotal,
          taxRatePercent: fiscal.taxRatePercent,
        },
      ],
      subtotal,
      taxAmount,
      total: Number((subtotal + taxAmount).toFixed(2)),
    };
    const order = await jsonRequest('/api/sales/orders', 'POST', orderPayload);
    expect(order.response.status).toBe(201);

    const invoices = (await (
      await fetch(`${baseUrl}/api/fiscal-invoices`)
    ).json()) as {
      id: string;
      salesOrderId: string;
      issuedAt: string;
      periodYear: number;
      periodMonth: number;
      saleCondition: string;
      paymentMethod: string;
      customerSnapshot: { nit?: string };
      items: { subtotal: number; taxRatePercent: number }[];
    }[];
    const invoice = invoices.find(
      (candidate) => candidate.salesOrderId === order.body['id']
    );
    expect(invoice).toMatchObject({
      saleCondition: 'contado',
      paymentMethod: 'efectivo_bs',
      customerSnapshot: { nit: '123456789' },
    });
    expect(invoice?.items[0]).toMatchObject({
      subtotal,
      taxRatePercent: fiscal.taxRatePercent,
    });

    const adjustmentItem = (amount: number) => ({
      description: 'Ajuste fiscal de prueba',
      subtotal: amount,
      taxCategory: 'gravado',
      taxRatePercent: fiscal.taxRatePercent,
    });
    const credit = await jsonRequest('/api/fiscal-adjustment-notes', 'POST', {
      type: 'nota_credito',
      fiscalInvoiceId: invoice!.id,
      reason: 'descuento',
      items: [adjustmentItem(10)],
    });
    expect(credit.response.status).toBe(201);
    expect(credit.body['serie']).toBe('NC');
    expect(credit.body['noteNumber']).toBe(fiscal.nextCreditNoteNumber);

    const debit = await jsonRequest('/api/fiscal-adjustment-notes', 'POST', {
      type: 'nota_debito',
      fiscalInvoiceId: invoice!.id,
      reason: 'error_precio',
      items: [adjustmentItem(1)],
    });
    expect(debit.response.status).toBe(201);
    expect(debit.body['serie']).toBe('ND');
    expect(debit.body['noteNumber']).toBe(fiscal.nextDebitNoteNumber);
    expect(debit.body['controlNumber']).toBe(
      (credit.body['controlNumber'] as number) + 1
    );

    const overCredit = await jsonRequest(
      '/api/fiscal-adjustment-notes',
      'POST',
      {
        type: 'nota_credito',
        fiscalInvoiceId: invoice!.id,
        reason: 'devolucion',
        items: [adjustmentItem(10.26)],
      }
    );
    expect(overCredit.response.status).toBe(400);

    const printed = await jsonRequest(
      `/api/fiscal-adjustment-notes/${credit.body['id']}/print`,
      'POST'
    );
    expect(printed.response.status).toBe(200);
    expect(printed.body['isDuplicate']).toBe(false);
    const reprinted = await jsonRequest(
      `/api/fiscal-adjustment-notes/${credit.body['id']}/print`,
      'POST'
    );
    expect(reprinted.response.status).toBe(200);
    expect(reprinted.body['isDuplicate']).toBe(true);
    const persistedNote = getDb()
      .prepare(
        'SELECT note_number, print_count FROM fiscal_adjustment_notes WHERE id = ?'
      )
      .get(credit.body['id']) as {
      note_number: number;
      print_count: number;
    };
    expect(persistedNote).toMatchObject({
      note_number: fiscal.nextCreditNoteNumber,
      print_count: 2,
    });

    const noteList = await jsonRequest(
      `/api/fiscal-adjustment-notes?year=${invoice!.periodYear}&month=${invoice!.periodMonth}`,
      'GET'
    );
    expect(noteList.response.status).toBe(200);
    expect((noteList.body as unknown[]).length).toBeGreaterThanOrEqual(2);

    const expense = await jsonRequest('/api/expenses', 'POST', {
      date: `${invoice!.periodYear}-${String(invoice!.periodMonth).padStart(2, '0')}-15`,
      concept: 'Gasto incluido en el libro fiscal',
      category: 'otros',
      categoryLabel: 'Otros',
      amountUsd: 12,
      exchangeRateUsed: 50,
      supplierOrBeneficiary: 'Proveedor de prueba',
      documentType: 'recibo_pago',
      paymentMethod: 'efectivo_usd',
      registeredBy: 'Test',
      taxCategory: 'no_sujeto',
      fiscalBookEligible: true,
    });
    expect(expense.response.status).toBe(201);

    const taxableExpense = await jsonRequest('/api/expenses', 'POST', {
      date: `${invoice!.periodYear}-${String(invoice!.periodMonth).padStart(2, '0')}-16`,
      concept: 'Gasto con IVA incluido en el libro fiscal',
      category: 'otros',
      categoryLabel: 'Otros',
      amountUsd: 12,
      exchangeRateUsed: 50,
      supplierOrBeneficiary: 'Proveedor gravado',
      documentType: 'factura_fiscal',
      paymentMethod: 'efectivo_usd',
      registeredBy: 'Test',
      taxCategory: 'con_factura_iva',
      taxRatePercent: 16,
      taxAmountUsd: 1.92,
      fiscalBookEligible: true,
    });
    expect(taxableExpense.response.status).toBe(201);

    const period = `${invoice!.periodYear}/${invoice!.periodMonth}`;
    const books = await jsonRequest(`/api/fiscal-books/${period}`, 'GET');
    expect(books.response.status).toBe(200);
    const salesRows = books.body['salesRows'] as { id: string }[];
    expect(salesRows.some((row) => row.id === invoice!.id)).toBe(true);
    expect(salesRows.some((row) => row.id === credit.body['id'])).toBe(true);
    expect(salesRows.some((row) => row.id === debit.body['id'])).toBe(true);
    expect(books.body['purchaseRows']).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: expense.body['id'] })])
    );
    const reconciliation = books.body['reconciliation'] as {
      salesDifference: number;
      purchaseDifference: number;
      taxDebit: number;
      taxCredit: number;
      netTaxPayable: number;
    };
    expect(reconciliation).toMatchObject({
      salesDifference: 0,
      purchaseDifference: 0,
    });
    expect(reconciliation.taxDebit).toBeCloseTo(
      (books.body['salesTotals'] as {taxAmount: number}).taxAmount,
      2
    );
    expect(reconciliation.taxCredit).toBeGreaterThanOrEqual(1.92);
    expect(reconciliation.netTaxPayable).toBeCloseTo(
      reconciliation.taxDebit - reconciliation.taxCredit,
      2
    );

    const exportedBooks = await jsonRequest(
      `/api/fiscal-books/${period}/export`,
      'POST'
    );
    expect(exportedBooks.response.status).toBe(200);
    expect(
      (exportedBooks.body['report'] as Record<string, unknown>)['salesRows']
    ).toEqual(salesRows);
    const exportAudit = exportedBooks.body['audit'] as Record<string, unknown>;
    expect(exportAudit['actionType']).toBe('libro_fiscal_exportado');
    expect(
      (exportAudit['details'] as Record<string, unknown>)['snapshotHash']
    ).toMatch(/^[a-f0-9]{64}$/);
    const persistedExport = getDb()
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE action_type = 'libro_fiscal_exportado' AND details_json LIKE ?"
      )
      .get(`%${period.replace('/', '-')}%`) as {count: number};
    expect(persistedExport.count).toBeGreaterThan(0);

    const close = await jsonRequest(`/api/fiscal-books/${period}/close`, 'POST');
    expect(close.response.status).toBe(201);
    expect(close.body['snapshotHash']).toMatch(/^[a-f0-9]{64}$/);
    const persistedClosure = getDb()
      .prepare(
        'SELECT snapshot_hash FROM fiscal_period_closures WHERE year = ? AND month = ?'
      )
      .get(invoice!.periodYear, invoice!.periodMonth) as {
      snapshot_hash: string;
    };
    expect(persistedClosure.snapshot_hash).toBe(close.body['snapshotHash']);

    const closedBooks = await jsonRequest(`/api/fiscal-books/${period}`, 'GET');
    expect(closedBooks.body['isClosed']).toBe(true);
    expect(closedBooks.body['closure']).toMatchObject({
      snapshotHash: close.body['snapshotHash'],
    });

    const rejectedExpenseDelete = await jsonRequest(
      `/api/expenses/${expense.body['id']}`,
      'DELETE'
    );
    expect(rejectedExpenseDelete.response.status).toBe(400);
    const rejectedEligibility = await jsonRequest(
      `/api/expenses/${expense.body['id']}/fiscal-eligibility`,
      'PATCH',
      {fiscalBookEligible: false}
    );
    expect(rejectedEligibility.response.status).toBe(400);
    const rejectedAdjustment = await jsonRequest(
      '/api/fiscal-adjustment-notes',
      'POST',
      {
        type: 'nota_debito',
        fiscalInvoiceId: invoice!.id,
        reason: 'otro',
        reasonDetails: 'Prueba posterior al cierre',
        items: [adjustmentItem(1)],
      }
    );
    expect(rejectedAdjustment.response.status).toBe(400);
    const rejectedInvoice = await jsonRequest(
      '/api/sales/orders',
      'POST',
      orderPayload
    );
    expect(rejectedInvoice.response.status).toBe(400);
  });
});

describe('Fase 0 — valores fiscales de referencia y parámetros de libros (HTTP)', () => {
  it('sirve el catálogo de referencia solo a administrador o master', async () => {
    const response = await jsonRequest('/api/fiscal-reference-catalog', 'GET');
    expect(response.response.status).toBe(200);
    const entries = response.body['entries'] as JsonBody[];
    expect(response.body['utReference']).toBe(43);
    expect(entries).toHaveLength(9);
    expect(entries.filter((item) => item['group'] === 'iva').map((item) => item['ratePercent'])).toEqual([16, 0, 8]);
    expect(entries.filter((item) => item['group'] === 'islr')).toHaveLength(6);
    expect(entries.every((item) => item['status'] === 'referencia' && item['confirmedByAccountant'] === false)).toBe(true);
    expect(entries.filter((item) => item['group'] === 'islr').every((item) => item['sustraendo'] === null)).toBe(true);

    const denied = await fetch(`${baseUrl}/api/fiscal-reference-catalog`, {
      headers: {'x-demo-role': 'operator'},
    });
    expect(denied.status).toBe(403);
  });

  it('sirve los valores sembrados y permite CRUD con anulación lógica', async () => {
    const initial = await jsonRequest('/api/fiscal-reference-values', 'GET');
    expect(initial.response.status).toBe(200);
    const values = initial.body['values'] as JsonBody[];
    expect(values.some((item) => item['kind'] === 'iva' && item['value'] === 16)).toBe(true);
    expect(values.some((item) => item['kind'] === 'ut' && item['value'] === 43)).toBe(true);
    expect(initial.body['activeIva']).toMatchObject({value: 16, status: 'referencia'});

    const created = await jsonRequest('/api/fiscal-reference-values', 'POST', {
      kind: 'ut',
      value: 45,
      valueUnit: 'bs',
      effectiveFrom: '2026-05-01',
      effectiveTo: '',
      conceptCode: '',
      conceptLabel: '',
      taxpayerType: '',
      sustraendoUt: null,
      instrumentType: 'providencia',
      instrumentNumber: 'SNAT/PRUEBA',
      officialGazette: 'G.O. de prueba',
      publicationDate: '2026-05-01',
      legalBasis: 'Prueba HTTP',
      notes: 'Solo referencia',
      status: 'referencia',
      confirmedByAccountant: false,
      supportDocument: '',
    });
    expect(created.response.status).toBe(201);
    const createdId = String(created.body['id']);

    const afterCreate = await jsonRequest('/api/fiscal-reference-values', 'GET');
    const previous = (afterCreate.body['values'] as JsonBody[]).find(
      (item) => item['id'] === 'frv-ut-43-2025'
    );
    expect(previous).toMatchObject({effectiveTo: '2026-04-30', status: 'historico'});
    const closedAudit = getDb()
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_logs WHERE action_type = 'valor_fiscal_referencia_vigencia_cerrada'"
      )
      .get() as {count: number};
    expect(closedAudit.count).toBeGreaterThan(0);

    const active = await jsonRequest(
      '/api/fiscal-reference-values/active?kind=ut&date=2026-05-02',
      'GET'
    );
    expect(active.body['value']).toBe(45);

    const updated = await jsonRequest(
      `/api/fiscal-reference-values/${createdId}`,
      'PUT',
      {
        kind: 'ut',
        value: 45,
        valueUnit: 'bs',
        effectiveFrom: '2026-05-01',
        effectiveTo: '',
        conceptCode: '',
        conceptLabel: '',
        taxpayerType: '',
        sustraendoUt: null,
        instrumentType: 'providencia',
        instrumentNumber: 'SNAT/PRUEBA',
        officialGazette: 'G.O. de prueba',
        publicationDate: '2026-05-01',
        legalBasis: 'Prueba HTTP',
        notes: 'Confirmado por contador de prueba',
        status: 'confirmado',
        confirmedByAccountant: true,
        supportDocument: 'SOP-1',
      }
    );
    expect(updated.body['status']).toBe('confirmado');
    expect(updated.body['confirmedByAccountant']).toBe(true);

    const annulled = await jsonRequest(
      `/api/fiscal-reference-values/${createdId}/annul`,
      'POST',
      {reason: 'Anulación de pruebaHTTP'}
    );
    expect(annulled.body['status']).toBe('anulado');
    expect(annulled.body['annulledReason']).toBe('Anulación de pruebaHTTP');
    const after = await jsonRequest('/api/fiscal-reference-values?kind=ut', 'GET');
    expect((after.body['values'] as JsonBody[]).some((item) => item['id'] === createdId)).toBe(true);
    expect(after.body['activeUt']).toBeNull();
    const historical = await jsonRequest(
      '/api/fiscal-reference-values/active?kind=ut&date=2026-04-30',
      'GET'
    );
    expect(historical.body['value']).toBe(43);
  });

  it('registra histórico ISLR por concepto, persona y vigencia sin activar retenciones', async () => {
    const beforeSettings = await jsonRequest('/api/fiscal-settings', 'GET');
    const created = await jsonRequest('/api/fiscal-reference-values', 'POST', {
      kind: 'islr',
      value: 15,
      valueUnit: 'percent',
      conceptCode: 'ISR-HON-N',
      conceptLabel: 'Honorarios profesionales (persona natural)',
      taxpayerType: 'natural',
      sustraendoUt: 10,
      effectiveFrom: '2026-01-01',
      effectiveTo: '',
      instrumentType: 'decreto',
      instrumentNumber: '1.808 art. 9',
      officialGazette: 'G.O. de prueba',
      publicationDate: '2026-01-01',
      legalBasis: 'Art. 9 Decreto 1.808',
      notes: 'Carga de prueba del contador',
      status: 'confirmado',
      confirmedByAccountant: true,
      supportDocument: 'SOP-ISR-1',
    });
    expect(created.response.status).toBe(201);
    expect(created.body['conceptCode']).toBe('ISR-HON-N');
    expect(created.body['sustraendoUt']).toBe(10);

    const filtered = await jsonRequest('/api/fiscal-reference-values?kind=islr', 'GET');
    expect(
      (filtered.body['values'] as JsonBody[]).filter(
        (item) => item['id'] === created.body['id']
      )
    ).toHaveLength(1);

    const active = await jsonRequest(
      '/api/fiscal-reference-values/active?kind=islr&date=2026-02-01',
      'GET'
    );
    expect(active.body['id']).toBe(created.body['id']);

    const settings = await jsonRequest('/api/fiscal-settings', 'GET');
    for (const flag of [
      'vatWithholdingEnabled',
      'islrWithholdingEnabled',
      'digitalInvoicingEnabled',
    ]) {
      expect(settings.body[flag]).toBe(beforeSettings.body[flag]);
    }
  });

  it('guarda parámetros de libros y bloquea el acceso a operadores', async () => {
    const initial = await jsonRequest('/api/accounting-book-settings', 'GET');
    expect(initial.response.status).toBe(200);
    expect(initial.body['approvedFormats']).toBe('xlsx,pdf');
    expect(initial.body['auxiliaryFormat']).toBe('csv');

    const updated = await jsonRequest('/api/accounting-book-settings', 'PUT', {
      approvedFormats: 'xlsx,pdf',
      auxiliaryFormat: 'csv',
      pagination: '1 al 99 HTTP',
      signatureText: 'Firma HTTP',
      signatureRole: 'Contador y socios',
      accountantSigner: 'Contador HTTP',
      partnerSigners: 'Socios HTTP',
      bookPageNumbering: 'Libro 1 / página 1 HTTP',
      ratificationInstrument: 'SOP-HTTP 25/11/2026',
      exchangeRatePolicy: 'documento_con_fallback',
      notes: 'Notas HTTP',
      approvedAt: '2026-11-22',
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body['pagination']).toBe('1 al 99 HTTP');
    expect(updated.body['bookPageNumbering']).toBe('Libro 1 / página 1 HTTP');
    expect(updated.body['ratificationInstrument']).toBe('SOP-HTTP 25/11/2026');
    expect(updated.body['updatedBy']).toBe('Administrador (demo)');

    const operatorRead = await fetch(`${baseUrl}/api/fiscal-reference-values`, {
      headers: {'x-demo-role': 'operator'},
    });
    expect(operatorRead.status).toBe(403);
    const operatorWrite = await fetch(`${baseUrl}/api/accounting-book-settings`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json', 'x-demo-role': 'operator'},
      body: JSON.stringify(updated.body),
    });
    expect(operatorWrite.status).toBe(403);
  });
});
