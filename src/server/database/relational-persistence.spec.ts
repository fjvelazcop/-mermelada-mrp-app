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
        'fiscal_settings',
        'exchange_rates',
        'exchange_rate_history',
        'audit_logs',
      ])
    );

    const versions = (
      db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as { version: number }[]
    ).map((row) => row.version);

    expect(versions).toEqual([1, 2]);
  });

  it('writes the seed data into the relational tables', () => {
    expect(rowCount('raw_materials')).toBe(dbInstance.getRawMaterials().length);
    expect(rowCount('finished_goods')).toBe(dbInstance.getFinishedGoods().length);
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
