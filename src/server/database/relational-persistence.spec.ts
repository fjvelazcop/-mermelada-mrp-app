import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, setDbPath } from './persistence';
import { loadRelationalState } from './relational-persistence';
import type { ErpDatabase as ErpDatabaseType } from '../erp-database';

/**
 * Integration tests for the normalized relational persistence layer.
 *
 * These tests use a real SQLite file (not an in-memory database) so they also
 * cover migrations, transactions and persistence across connections.
 */

const workDir = mkdtempSync(join(tmpdir(), 'mermelada-relational-'));
const dbPath = join(workDir, 'erp.db');

let ErpDatabase: typeof ErpDatabaseType;
let dbInstance: ErpDatabaseType;

function rowCount(table: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number };
  return row.count;
}

beforeAll(async () => {
  setDbPath(dbPath);
  const module = await import('../erp-database.js');
  ErpDatabase = module.ErpDatabase;
  dbInstance = module.dbInstance;
});

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe('normalized SQLite schema', () => {
  it('creates every entity table and records all migrations', () => {
    const db = getDb();
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'schema_migrations',
        'supplier_types',
        'material_categories',
        'presentation_types',
        'raw_materials',
        'inventory_movements',
        'finished_goods',
        'recipes',
        'recipe_items',
        'production_orders',
        'production_order_materials',
        'customers',
        'sales_orders',
        'sales_order_items',
        'delivery_notes',
        'delivery_note_items',
        'employees',
        'payroll_weeks',
        'payroll_payments',
        'expenses',
        'expense_categories',
        'payables',
        'payable_payments',
        'accounts',
        'accounting_entries',
        'accounting_entry_lines',
        'accounting_periods',
        'fiscal_reference_values',
        'accounting_book_settings',
        'fiscal_settings',
        'exchange_rates',
        'exchange_rate_history',
        'audit_logs',
        'auth_users',
        'auth_roles',
        'auth_role_permissions',
        'tunnel_sessions',
        'notification_recipients',
        'notification_log',
        'activation_records',
      ])
    );

    const versions = (
      db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as { version: number }[]
    ).map((row) => row.version);

    expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);

    const fiscalColumns = (
      db.prepare('PRAGMA table_info(fiscal_reference_values)').all() as {name: string}[]
    ).map((row) => row.name);
    expect(fiscalColumns).toEqual(
      expect.arrayContaining(['concept_code', 'concept_label', 'taxpayer_type', 'sustraendo_ut'])
    );
    const bookColumns = (
      db.prepare('PRAGMA table_info(accounting_book_settings)').all() as {name: string}[]
    ).map((row) => row.name);
    expect(bookColumns).toEqual(
      expect.arrayContaining([
        'accountant_signer',
        'partner_signers',
        'book_page_numbering',
        'ratification_instrument',
      ])
    );
  });

  it('persiste un histórico ISLR con vigencia, sustraendo y soporte por concepto', () => {
    dbInstance.createFiscalReferenceValue(
      {
        kind: 'islr',
        value: 15,
        valueUnit: 'percent',
        conceptCode: 'ISR-HON-N',
        conceptLabel: 'Honorarios profesionales',
        taxpayerType: 'natural',
        sustraendoUt: 10,
        effectiveFrom: '2026-01-01',
        effectiveTo: '',
        instrumentType: 'decreto',
        instrumentNumber: '1.808',
        officialGazette: 'G.O.',
        publicationDate: '2026-01-01',
        legalBasis: 'Art. 9',
        notes: 'Prueba de persistencia ISLR',
        status: 'confirmado',
        confirmedByAccountant: true,
        supportDocument: 'SOP-ISR',
      },
      {userId: 'u-1', userName: 'Admin', userRole: 'admin'}
    );
    dbInstance.persist();
    closeDb();
    setDbPath(dbPath);
    const persisted = loadRelationalState();
    const entry = persisted?.fiscalReferenceValues.find(
      (item) => item.conceptCode === 'ISR-HON-N'
    );
    expect(entry).toMatchObject({
      value: 15,
      sustraendoUt: 10,
      taxpayerType: 'natural',
      supportDocument: 'SOP-ISR',
    });
  });

  it('persists the fiscal invoice credit days introduced by migration v11', () => {
    const customer = dbInstance.getCustomers()[0];
    const good = dbInstance.getFinishedGoods()[0];
    const order = dbInstance.addSalesOrder({
      customerId: customer.id,
      customerName: customer.businessName,
      customerTaxId: customer.taxId,
      orderDate: '2026-11-10',
      deliveryDate: '2026-11-12',
      status: 'pendiente',
      saleCondition: 'credito',
      paymentMethod: 'credito',
      creditDays: 45,
      exchangeRateUsed: 50,
      items: [
        {
          finishedGoodId: good.id,
          flavor: good.flavor,
          presentation: good.presentation,
          presentationLabel: good.presentationLabel,
          quantity: 1,
          unitPrice: good.suggestedWholesalePrice,
          subtotal: good.suggestedWholesalePrice,
          taxCategory: 'exento',
          taxRatePercent: 0,
        },
      ],
      subtotal: good.suggestedWholesalePrice,
      taxAmount: 0,
      total: good.suggestedWholesalePrice,
    } as Parameters<typeof dbInstance.addSalesOrder>[0]);

    const invoice = dbInstance
      .getFiscalInvoices()
      .find((entry) => entry.salesOrderId === order.id)!;
    expect(invoice).toBeTruthy();
    expect(invoice.creditDays).toBe(45);

    const row = getDb()
      .prepare('SELECT credit_days FROM fiscal_invoices WHERE id = ?')
      .get(invoice.id) as { credit_days: number };
    expect(row.credit_days).toBe(45);
  });

  it('persists supplier links added by migration v13 on expenses and inventory movements', () => {
    const supplier = dbInstance.getSuppliers()[0];
    const material = dbInstance.getRawMaterials()[0];

    const expense = dbInstance.addExpense({
      date: '2026-11-15',
      concept: 'Compra de insumos con proveedor maestro',
      category: 'alquiler_instalaciones',
      categoryLabel: 'Alquileres de Planta de Producción',
      amountUsd: 100,
      exchangeRateUsed: 50,
      amountBs: 5000,
      supplierOrBeneficiary: supplier.businessName,
      supplierId: supplier.id,
      taxId: supplier.taxId,
      documentType: 'factura_fiscal',
      paymentMethod: 'transferencia_bancaria',
      registeredBy: 'Prueba',
      taxCategory: 'con_factura_iva',
      fiscalBookEligible: true,
    } as Parameters<typeof dbInstance.addExpense>[0]);

    const movement = dbInstance.addInventoryMovement({
      materialId: material.id,
      materialName: material.name,
      type: 'entrada',
      quantity: 2,
      costPerUnit: 50,
      totalCost: 100,
      exchangeRateUsed: 50,
      referenceDoc: 'F-TEST-001',
      supplierId: supplier.id,
      supplierNameSnapshot: supplier.businessName,
      supplierTaxIdSnapshot: supplier.taxId,
      date: '2026-11-15',
      performedBy: 'Prueba',
    } as Parameters<typeof dbInstance.addInventoryMovement>[0]);

    dbInstance.persist();

    const state = loadRelationalState()!;
    expect(state.expenses.find((e) => e.id === expense.id)).toMatchObject({
      supplierId: supplier.id,
      supplierOrBeneficiary: supplier.businessName,
      taxId: supplier.taxId,
    });
    expect(state.inventoryMovements.find((m) => m.id === movement.id)).toMatchObject({
      supplierId: supplier.id,
      supplierNameSnapshot: supplier.businessName,
      supplierTaxIdSnapshot: supplier.taxId,
    });

    const expenseRow = getDb()
      .prepare('SELECT supplier_id FROM expenses WHERE id = ?')
      .get(expense.id) as { supplier_id: string };
    const movementRow = getDb()
      .prepare(
        'SELECT supplier_id, supplier_name_snapshot, supplier_tax_id_snapshot FROM inventory_movements WHERE id = ?'
      )
      .get(movement.id) as {
      supplier_id: string;
      supplier_name_snapshot: string;
      supplier_tax_id_snapshot: string;
    };
    expect(expenseRow.supplier_id).toBe(supplier.id);
    expect(movementRow.supplier_id).toBe(supplier.id);
    expect(movementRow.supplier_name_snapshot).toBe(supplier.businessName);
    expect(movementRow.supplier_tax_id_snapshot).toBe(supplier.taxId);
  });

  it('persiste la condición de pago y la CxP vinculada de los movimientos de inventario', () => {
    const material = dbInstance.getRawMaterials()[0];
    const supplier = dbInstance.getSuppliers()[0];
    const suffix = Date.now().toString(36);

    const cash = dbInstance.addInventoryMovement({
      materialId: material.id,
      materialName: material.name,
      type: 'entrada',
      quantity: 1,
      costPerUnit: 20,
      totalCost: 20,
      exchangeRateUsed: 50,
      referenceDoc: `F-COND-CASH-${suffix}`,
      supplierId: supplier.id,
      supplierNameSnapshot: supplier.businessName,
      notes: 'Compra cancelada el mismo día',
      date: '2026-11-16',
      performedBy: 'Prueba',
      paymentCondition: 'contado',
      paymentMethod: 'transferencia_bancaria',
      bankCode: '0134',
      bankName: 'Banco de Venezuela',
      paymentReference: `TRANSF-${suffix}`,
    } as Parameters<typeof dbInstance.addInventoryMovement>[0]);

    const credit = dbInstance.addInventoryMovement({
      materialId: material.id,
      materialName: material.name,
      type: 'entrada',
      quantity: 3,
      costPerUnit: 10,
      totalCost: 30,
      exchangeRateUsed: 50,
      referenceDoc: `F-COND-CRED-${suffix}`,
      supplierId: supplier.id,
      supplierNameSnapshot: supplier.businessName,
      date: '2026-11-17',
      performedBy: 'Prueba',
      paymentCondition: 'credito',
      creditDays: 30,
      dueDate: '2026-12-17',
    } as Parameters<typeof dbInstance.addInventoryMovement>[0]);
    const linked = dbInstance.upsertPayableForInventoryPurchase(credit);
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;

    dbInstance.persist();
    const state = loadRelationalState()!;

    expect(state.inventoryMovements.find((m) => m.id === cash.id)).toMatchObject({
      paymentCondition: 'contado',
      paymentMethod: 'transferencia_bancaria',
      bankCode: '0134',
      bankName: 'Banco de Venezuela',
      paymentReference: `TRANSF-${suffix}`,
      notes: 'Compra cancelada el mismo día',
    });
    expect(state.inventoryMovements.find((m) => m.id === credit.id)).toMatchObject({
      paymentCondition: 'credito',
      creditDays: 30,
      dueDate: '2026-12-17',
      payableId: linked.payable.id,
      payableNumber: linked.payable.payableNumber,
    });

    // La derivación del origen CxP debe sobrevivir al reinicio (misma regla que en vivo).
    const reloaded = new ErpDatabase();
    const origin = reloaded.describePayableOrigin(linked.payable);
    expect(origin.origin).toBe('compra_inventario');
    expect(origin.linkedMovementCount).toBe(1);
  });

  it('persists bank account metadata, provisional balance and transaction account choice', () => {
    const account = dbInstance.addAccount({
      code: '1.01.02.98',
      name: 'Banco Persistente',
      type: 'activo',
      nature: 'debito',
      parentCode: '1.01.02',
      active: true,
      kind: 'banco',
      bankCode: '0134',
      bankName: 'Banesco',
      accountNumber: '778899',
      currency: 'USD',
      referenceBalanceUsd: 3456.78,
      referenceBalanceNote: 'Conciliación pendiente #13',
    });
    const material = dbInstance.getRawMaterials()[0];
    const movement = dbInstance.addInventoryMovement({
      materialId: material.id,
      materialName: material.name,
      type: 'entrada',
      quantity: 1,
      costPerUnit: 10,
      totalCost: 10,
      exchangeRateUsed: 50,
      referenceDoc: 'F-PERSIST-ACCOUNT',
      date: '2026-07-21',
      performedBy: 'Prueba',
      paymentCondition: 'contado',
      paymentAccountCode: account.code,
    } as Parameters<typeof dbInstance.addInventoryMovement>[0]);
    dbInstance.persist();

    const state = loadRelationalState()!;
    expect(state.accounts.find((item) => item.id === account.id)).toMatchObject({
      kind: 'banco',
      bankCode: '0134',
      bankName: 'Banesco',
      accountNumber: '778899',
      currency: 'USD',
      referenceBalanceUsd: 3456.78,
      referenceBalanceNote: 'Conciliación pendiente #13',
    });
    expect(
      state.inventoryMovements.find((item) => item.id === movement.id)?.paymentAccountCode
    ).toBe(account.code);
  });

  it('persists accounts, double-entry lines and periods added by migration v14', () => {
    const account = dbInstance.addAccount({
      code: '5.01.04',
      name: 'Papelería y Oficina',
      type: 'gasto',
      nature: 'debito',
      parentCode: '5.01',
      active: true,
    });

    const entry = dbInstance.createAccountingEntry({
      date: '2026-07-20',
      description: 'Asiento de prueba v14',
      lines: [
        {accountCode: account.code, debit: 100},
        {accountCode: '1.01.02', credit: 100},
      ],
    });
    dbInstance.confirmAccountingEntry(entry.id);
    dbInstance.closeAccountingPeriod('2026-07');
    dbInstance.persist();

    const state = loadRelationalState()!;
    expect(state.accounts.find((item) => item.id === account.id)).toMatchObject({
      code: '5.01.04',
      isSystem: false,
    });
    const stored = state.accountingEntries.find((item) => item.id === entry.id);
    expect(stored).toMatchObject({
      entryNumber: entry.entryNumber,
      status: 'confirmado',
      totalDebit: 100,
      totalCredit: 100,
      periodKey: '2026-07',
    });
    expect(stored?.lines).toHaveLength(2);
    expect(state.accountingPeriods.find((item) => item.key === '2026-07')?.status).toBe('cerrado');

    const lines = getDb()
      .prepare('SELECT COUNT(*) AS count FROM accounting_entry_lines WHERE entry_id = ?')
      .get(entry.id) as { count: number };
    expect(lines.count).toBe(2);
  });

  it('writes the seed data into the relational tables', () => {
    expect(rowCount('supplier_types')).toBe(dbInstance.getSupplierTypes().length);
    expect(rowCount('material_categories')).toBe(dbInstance.getMaterialCategories().length);
    expect(rowCount('presentation_types')).toBe(dbInstance.getPresentationTypes().length);
    expect(rowCount('raw_materials')).toBe(dbInstance.getRawMaterials().length);
    expect(rowCount('finished_goods')).toBe(dbInstance.getFinishedGoods().length);

    expect(dbInstance.getRawMaterials()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({code: 'MP-EMP-15', category: 'envases'}),
        expect.objectContaining({code: 'MP-EMP-16', category: 'cajas'}),
      ])
    );
    expect(dbInstance.getFinishedGoods()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({code: 'PT-GUA-300', presentation: 'pequena_300g'}),
        expect.objectContaining({code: 'PT-GUA-6KG', presentation: 'caja_6kg'}),
      ])
    );
    expect(rowCount('recipes')).toBe(dbInstance.getRecipes().length);
    expect(rowCount('customers')).toBe(dbInstance.getCustomers().length);
    expect(rowCount('sales_orders')).toBe(dbInstance.getSalesOrders().length);
    expect(rowCount('delivery_notes')).toBe(dbInstance.getDeliveryNotes().length);
    expect(rowCount('employees')).toBe(dbInstance.getEmployees().length);
    expect(rowCount('payroll_weeks')).toBe(dbInstance.getPayrollWeeks().length);
    expect(rowCount('expenses')).toBe(dbInstance.getExpenses().length);
    expect(rowCount('expense_categories')).toBe(
      dbInstance.getExpenseCategories().length
    );
    expect(rowCount('audit_logs')).toBe(dbInstance.getAuditLogs().length);

    // Child tables prove the 1:N relationships are populated.
    const recipeItems = dbInstance
      .getRecipes()
      .reduce((total, recipe) => total + recipe.items.length, 0);
    expect(rowCount('recipe_items')).toBe(recipeItems);

    const payrollPayments = dbInstance
      .getPayrollWeeks()
      .reduce((total, week) => total + week.payments.length, 0);
    expect(rowCount('payroll_payments')).toBe(payrollPayments);

    expect(rowCount('fiscal_settings')).toBe(1);
    expect(rowCount('exchange_rates')).toBe(1);
    expect(rowCount('exchange_rate_history')).toBe(
      dbInstance.getExchangeRates().history.length
    );
  });

  it('roundtrips the complete state without losing data', () => {
    const state = loadRelationalState();
    expect(state).not.toBeNull();

    expect(state?.supplierTypes).toEqual(dbInstance.getSupplierTypes());
    expect(state?.materialCategories).toEqual(dbInstance.getMaterialCategories());
    expect(state?.rawMaterials).toEqual(dbInstance.getRawMaterials());
    expect(state?.inventoryMovements).toEqual(dbInstance.getMovements());
    expect(state?.finishedGoods).toEqual(dbInstance.getFinishedGoods());
    expect(state?.recipes).toEqual(dbInstance.getRecipes());
    expect(state?.productionOrders).toEqual(dbInstance.getProductionOrders());
    expect(state?.customers).toEqual(dbInstance.getCustomers());
    expect(state?.salesOrders).toEqual(dbInstance.getSalesOrders());
    expect(state?.deliveryNotes).toEqual(dbInstance.getDeliveryNotes());
    expect(state?.employees).toEqual(dbInstance.getEmployees());
    expect(state?.payrollWeeks).toEqual(dbInstance.getPayrollWeeks());
    expect(state?.expenses).toEqual(dbInstance.getExpenses());
    expect(state?.expenseCategories).toEqual(dbInstance.getExpenseCategories());
    expect(state?.payables).toEqual(dbInstance.getPayables());
    expect(state?.payablePayments).toEqual(dbInstance.getPayablePayments());
    expect(state?.fiscalSettings).toEqual(dbInstance.getFiscalSettings());
    // `getExchangeRates()` recalculates the active time window in memory, so
    // only the persisted/stored fields are compared here.
    const liveRates = dbInstance.getExchangeRates();
    expect(state?.exchangeRates.currentUsd).toBe(liveRates.currentUsd);
    expect(state?.exchangeRates.currentUsdt).toBe(liveRates.currentUsdt);
    expect(state?.exchangeRates.lastUpdated).toBe(liveRates.lastUpdated);
    expect(state?.exchangeRates.history).toEqual(liveRates.history);
    expect(state?.auditLogs).toEqual(dbInstance.getAuditLogs());
  });

  it('backfills presentation finished goods into an existing relational database', () => {
    getDb()
      .prepare("DELETE FROM finished_goods WHERE code IN ('PT-GUA-300', 'PT-GUA-6KG')")
      .run();

    const reopened = new ErpDatabase();
    const codes = reopened.getFinishedGoods().map((item) => item.code);

    expect(codes).toContain('PT-GUA-300');
    expect(codes).toContain('PT-GUA-6KG');
    expect(
      getDb()
        .prepare(
          "SELECT COUNT(*) AS count FROM finished_goods WHERE code IN ('PT-GUA-300', 'PT-GUA-6KG')"
        )
        .get()
    ).toEqual({count: 2});
  });
});

describe('mutations and restart persistence', () => {
  const testMaterial = {
    code: 'TEST-REL-001',
    name: 'Materia prima de integración',
    category: 'fruta' as const,
    currentStock: 42,
    minStock: 5,
    unit: 'kg' as const,
    costPerUnit: 1.5,
    supplier: 'Proveedor de pruebas',
    lastRestockDate: '2026-10-26',
  };

  it('persists a mutation made through the dbInstance proxy', () => {
    const before = dbInstance.getRawMaterials().length;
    const created = dbInstance.addRawMaterial(testMaterial);

    expect(dbInstance.getRawMaterials().length).toBe(before + 1);

    const row = getDb()
      .prepare('SELECT code, name, current_stock FROM raw_materials WHERE id = ?')
      .get(created.id) as
      | { code: string; name: string; current_stock: number }
      | undefined;

    expect(row).toEqual({
      code: testMaterial.code,
      name: testMaterial.name,
      current_stock: testMaterial.currentStock,
    });
  });

  it('persists the partial collection history added by migration v10', () => {
    const order = dbInstance
      .getSalesOrders()
      .find((candidate) => !candidate.collection && candidate.total >= 10)!;
    expect(order).toBeTruthy();

    const updated = dbInstance.collectSalesOrder(order.id, {
      bankCode: '0108',
      bankName: 'Banco Provincial (BBVA)',
      paymentMethod: 'transferencia_bancaria',
      reference: 'REF-PERSIST-001',
      amountUsd: 5,
    });
    expect(updated.status).toBe('cobrado_parcial');
    expect(updated.collections?.length).toBe(1);

    const row = getDb()
      .prepare('SELECT collections_json FROM sales_orders WHERE id = ?')
      .get(order.id) as { collections_json: string };
    expect(JSON.parse(row.collections_json).length).toBe(1);

    const reloaded = loadRelationalState();
    const persisted = reloaded?.salesOrders.find((candidate) => candidate.id === order.id);
    expect(persisted?.collections?.length).toBe(1);
    expect(persisted?.collection?.reference).toBe('REF-PERSIST-001');
  });

  it('persists payables, payments and the generated expense linkage', () => {
    const payable = dbInstance.addPayable({
      supplierId: '',
      supplierName: 'Insumos del Llano C.A.',
      taxId: 'J-12345678-9',
      invoiceNumber: 'F-REL-001',
      issueDate: '2026-11-01',
      dueDate: '2026-12-01',
      amountUsd: 100,
      exchangeRateUsed: 50,
      amountBs: 5000,
      category: 'materia_prima',
      status: 'pendiente',
    });

    const partial = dbInstance.recordPayablePayment(payable.id, {
      bankCode: '0108',
      bankName: 'Banco Provincial (BBVA)',
      paymentMethod: 'transferencia_bancaria',
      reference: 'REF-REL-001',
      amountUsd: 40,
    });
    expect(partial.expense).toBeUndefined();

    const final = dbInstance.recordPayablePayment(payable.id, {
      bankCode: '0108',
      bankName: 'Banco Provincial (BBVA)',
      paymentMethod: 'transferencia_bancaria',
      reference: 'REF-REL-002',
      amountUsd: 60,
    });
    expect(final.expense).toBeTruthy();
    expect(final.payable.status).toBe('pagada');

    expect(rowCount('payables')).toBe(dbInstance.getPayables().length);
    expect(rowCount('payable_payments')).toBe(2);
    const expenseRow = getDb()
      .prepare('SELECT payable_id FROM expenses WHERE payable_id = ?')
      .get(payable.id) as { payable_id: string } | undefined;
    expect(expenseRow?.payable_id).toBe(payable.id);

    const reloaded = loadRelationalState();
    expect(reloaded?.payables.find((item) => item.id === payable.id)?.status).toBe('pagada');
    expect(reloaded?.payablePayments.length).toBe(2);
    expect(reloaded?.expenses.find((item) => item.id === final.expense?.id)?.payableId).toBe(
      payable.id
    );
  });

  it('reloads the state from disk after closing the connection', () => {
    const expectedMaterials = dbInstance.getRawMaterials().length;
    const expectedRecipes = loadRelationalState()?.recipes;

    closeDb();

    // A fresh instance simulates a server restart and must read from SQLite.
    const reloaded = new ErpDatabase();
    expect(reloaded.getRawMaterials().length).toBe(expectedMaterials);
    expect(reloaded.getRawMaterials().some((m) => m.code === testMaterial.code)).toBe(
      true
    );
    expect(reloaded.getRecipes()).toEqual(expectedRecipes);
  });
});
