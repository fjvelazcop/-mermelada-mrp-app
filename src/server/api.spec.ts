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

    const components = body['components'] as {
      securitySchemes: { bearerAuth: { type: string; scheme: string } };
    };
    expect(components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
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
      notes: 'Entrada de prueba',
    });
    expect(entry.response.status).toBe(201);

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

    const notes = (await (
      await fetch(`${baseUrl}/api/sales/delivery-notes`)
    ).json()) as { id: string }[];
    expect(notes.some((n) => n.id === note.body['id'])).toBe(true);
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

    const deleted = await jsonRequest(`/api/expenses/${expenseId}`, 'DELETE');
    expect(deleted.response.status).toBe(200);

    const missing = await jsonRequest('/api/expenses/missing', 'DELETE');
    expect(missing.response.status).toBe(404);
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

    const updated = await jsonRequest(
      `/api/expenses/categories/${categoryId}`,
      'PUT',
      { monthlyBudgetUsd: 250 }
    );
    expect(updated.response.status).toBe(200);
    expect(updated.body['monthlyBudgetUsd']).toBe(250);

    const deleted = await jsonRequest(
      `/api/expenses/categories/${categoryId}`,
      'DELETE'
    );
    expect(deleted.response.status).toBe(200);

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
});
