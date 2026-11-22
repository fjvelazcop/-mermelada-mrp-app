import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, setDbPath } from './database/persistence.js';
import type { ErpDatabase as ErpDatabaseType } from './erp-database.js';

const workDir = mkdtempSync(join(tmpdir(), 'mermelada-accounting-'));
let ErpDatabase: typeof ErpDatabaseType;
let dbInstance: ErpDatabaseType;

beforeAll(async () => {
  setDbPath(join(workDir, 'erp.db'));
  const module = await import('./erp-database.js');
  ErpDatabase = module.ErpDatabase;
  dbInstance = module.dbInstance;
});

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe('Fase 1 — plan de cuentas y asientos', () => {
  it('siembra un plan de cuentas base con cuentas de control fiscales', () => {
    const accounts = dbInstance.getAccounts();
    expect(accounts).toHaveLength(35);
    expect(accounts.every((account) => account.active && account.isSystem)).toBe(true);
    expect(dbInstance.getAccountByCode('1.04.01')?.name).toBe('Crédito Fiscal IVA');
    expect(dbInstance.getAccountByCode('2.02.02')?.name).toBe('Retenciones por Pagar');
    expect(dbInstance.getAccountByCode('5.02.01')?.name).toBe('Sueldos y Salarios');
    expect(dbInstance.getAccountByCode('6.01.01')?.name).toBe('Materia Prima Consumida');
  });

  it('rechaza asientos desbalanceados y líneas con débito y crédito a la vez', () => {
    expect(() =>
      dbInstance.createAccountingEntry({
        date: '2026-10-05',
        description: 'Asiento desbalanceado',
        lines: [
          {accountCode: '1.01.01', debit: 100},
          {accountCode: '1.01.02', credit: 90},
        ],
      })
    ).toThrow(/balanceado/);

    expect(() =>
      dbInstance.createAccountingEntry({
        date: '2026-10-05',
        description: 'Línea inválida',
        lines: [
          {accountCode: '1.01.01', debit: 100, credit: 100},
          {accountCode: '1.01.02', credit: 100},
        ],
      })
    ).toThrow(/débito o crédito/);
  });

  it('crea, confirma y anula un asiento manual con auditoría', () => {
    const before = dbInstance.getAccountingEntries().length;
    const entry = dbInstance.createAccountingEntry({
      date: '2026-10-06',
      description: 'Aporte de capital de prueba',
      lines: [
        {accountCode: '1.01.02', debit: 500},
        {accountCode: '3.01', credit: 500},
      ],
    });
    expect(entry.status).toBe('borrador');
    expect(entry.totalDebit).toBe(500);
    expect(entry.totalCredit).toBe(500);
    expect(dbInstance.getAccountingEntries().length).toBe(before + 1);

    const confirmed = dbInstance.confirmAccountingEntry(entry.id);
    expect(confirmed.status).toBe('confirmado');
    expect(confirmed.confirmedAt).toBeTruthy();

    const annulled = dbInstance.annulAccountingEntry(entry.id, 'Prueba de anulación');
    expect(annulled.status).toBe('anulado');
    expect(annulled.annulmentReason).toBe('Prueba de anulación');
    const contabilidadLogs = dbInstance.getAuditLogs().filter((log) => log.module === 'contabilidad');
    expect(contabilidadLogs.map((log) => log.details?.entryNumber)).toContain(entry.entryNumber);
  });

  it('bloquea asientos en períodos cerrados y permite reabrirlos', () => {
    dbInstance.closeAccountingPeriod('2026-09');
    expect(() =>
      dbInstance.createAccountingEntry({
        date: '2026-09-15',
        description: 'Asiento en período cerrado',
        lines: [
          {accountCode: '1.01.01', debit: 10},
          {accountCode: '1.01.02', credit: 10},
        ],
      })
    ).toThrow(/cerrado/);

    dbInstance.openAccountingPeriod('2026-09');
    const entry = dbInstance.createAccountingEntry({
      date: '2026-09-15',
      description: 'Asiento tras reapertura',
      lines: [
        {accountCode: '1.01.01', debit: 10},
        {accountCode: '1.01.02', credit: 10},
      ],
    });
    expect(entry.periodKey).toBe('2026-09');
  });

  it('genera un asiento automático balanceado por gasto y no lo duplica', () => {
    const material = dbInstance.getRawMaterials()[0];
    const movement = dbInstance.addInventoryMovement({
      materialId: material.id,
      materialName: material.name,
      type: 'entrada',
      quantity: 1,
      costPerUnit: 70,
      totalCost: 70,
      exchangeRateUsed: 50,
      referenceDoc: 'F-CONT-001',
      date: '2026-08-11',
      performedBy: 'Prueba',
    } as Parameters<typeof dbInstance.addInventoryMovement>[0]);

    const entries = dbInstance.getAccountingEntries().filter((entry) =>
      entry.sourceType === 'inventario' && entry.sourceId === movement.id
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('confirmado');
    expect(entries[0].totalDebit).toBe(70);
    expect(entries[0].totalCredit).toBe(70);
    expect(entries[0].lines[0].accountCode).toBe('1.03.01');
  });

  it('respeta el flag accountingEnabled deshabilitado', () => {
    const fresh = new ErpDatabase();
    const settings = fresh.getFiscalSettings();
    fresh.updateFiscalSettings({...settings, accountingEnabled: false});
    expect(() =>
      fresh.createAccountingEntry({
        date: '2026-10-10',
        description: 'No debería crearse',
        lines: [
          {accountCode: '1.01.01', debit: 1},
          {accountCode: '1.01.02', credit: 1},
        ],
      })
    ).toThrow(/deshabilitado/);
  });
});

describe('Libros contables provisionales', () => {
  it('genera Diario, Mayor y Balance de Comprobación cuadrados', () => {
    const entry = dbInstance.createAccountingEntry({
      date: '2026-11-05',
      description: 'Venta de prueba para libros',
      lines: [
        {accountCode: '1.01.02', debit: 100},
        {accountCode: '4.01.01', credit: 100},
      ],
    });
    dbInstance.confirmAccountingEntry(entry.id);

    const diario = dbInstance.getAccountingBook('diario', 2026, 11);
    expect(diario.periodKey).toBe('2026-11');
    expect(diario.metadata.provisional).toBe(true);
    expect(diario.totals.find((item) => item.label === 'Diferencia')?.value).toBe(0);
    expect(diario.rows.some((item) => item.cells.includes('Venta de prueba para libros'))).toBe(true);

    const mayor = dbInstance.getAccountingBook('mayor', 2026, 11);
    expect(mayor.headers).toContain('Saldo final');
    expect(mayor.totals.find((item) => item.label === 'Débitos')?.value).toBe(100);

    const balance = dbInstance.getAccountingBook('balance_comprobacion', 2026, 11);
    expect(balance.totals.find((item) => item.label === 'Diferencia')?.value).toBe(0);
  });

  it('genera Inventario en modo borrador con cuentas de control provisionales', () => {
    const book = dbInstance.getAccountingBook('inventario', 2026, 11);
    expect(book.type).toBe('inventario');
    expect(book.title).toContain('BORRADOR / PRUEBA');
    expect(book.headers).toContain('Cuenta provisional');
    expect(book.rows.some((item) => item.cells.includes('1.03.01'))).toBe(true);
    expect(book.rows.some((item) => item.cells.includes('1.03.02'))).toBe(true);
    expect(book.notes.join(' ')).toContain('PENDIENTE DE VALIDACIÓN CONTABLE');
    expect(
      book.totals.find((item) => item.label === 'Valoración provisional')?.value
    ).toBeGreaterThan(0);
  });

  it('incluye columnas Bs. pareadas, trazabilidad de tasa y totales en dos monedas', () => {
    const entry = dbInstance.createAccountingEntry({
      date: '2026-11-07',
      description: 'Prueba columnas Bs.',
      lines: [
        {accountCode: '1.01.02', debit: 10},
        {accountCode: '4.01.01', credit: 10},
      ],
    });
    dbInstance.confirmAccountingEntry(entry.id);

    const book = dbInstance.getAccountingBook('diario', 2026, 11);
    expect(book.headers).toContain('Débito USD');
    expect(book.headers).toContain('Débito Bs.');
    expect(book.headers).toContain('Crédito Bs.');
    expect(book.headers.at(-2)).toBe('Tasa Bs./USD');
    expect(book.headers.at(-1)).toBe('Origen de la tasa');
    expect(book.metadata.secondaryCurrency).toBe('BS');
    expect(book.metadata.exchangeRatePolicy).toBe('documento_con_fallback');
    expect(book.totals.every((item) => typeof item.valueBs === 'number')).toBe(true);

    const row = book.rows.find((item) => item.cells.includes('Prueba columnas Bs.'));
    expect(row).toBeDefined();
    const debitIndex = book.headers.indexOf('Débito USD');
    expect(row?.cells[debitIndex]).toBe(10);
    expect(row?.cells[debitIndex + 1]).toBe(
      Math.round(10 * book.metadata.exchangeRateUsed * 100) / 100
    );
    expect(row?.cells.at(-1)).toBe('currentUsd (referencia)');
  });

  it('mantiene Retenciones vacío y no activa banderas fiscales', () => {
    const book = dbInstance.getAccountingBook('retenciones', 2026, 11);
    expect(book.notes.join(' ')).toContain('SIN OPERACIONES');
    expect(book.notes.join(' ')).toContain('NO APLICA');
    expect(book.notes.join(' ')).toContain('control documental');
    expect(book.notes.join(' ')).toContain('Saldos de apertura');
    expect(book.rows.some((item) => item.cells.includes('Recibida (cliente SPE)'))).toBe(true);
    expect(book.totals.find((item) => item.label === 'Retenciones practicadas')?.value).toBe(0);
    expect(book.totals.find((item) => item.label === 'Retenciones recibidas')?.value).toBe(0);

    const settings = dbInstance.getFiscalSettings();
    expect(settings.vatWithholdingEnabled).toBe(false);
    expect(settings.islrWithholdingEnabled).toBe(false);
  });
});

describe('Fase 0 — valores fiscales de referencia y parámetros de libros', () => {
  const actor = {
    userId: 'usr-test',
    userName: 'Prueba',
    userRole: 'admin',
  };

  const referenceInput = (kind: 'iva' | 'ut', value: number, effectiveFrom: string) => ({
    kind,
    value,
    valueUnit: kind === 'iva' ? ('percent' as const) : ('bs' as const),
    effectiveFrom,
    effectiveTo: '',
    instrumentType: kind === 'iva' ? 'decreto' : 'providencia',
    instrumentNumber: 'PRUEBA',
    officialGazette: 'G.O. de prueba',
    publicationDate: effectiveFrom,
    legalBasis: 'Prueba',
    notes: 'Solo referencia',
    status: 'referencia' as const,
    confirmedByAccountant: false,
    supportDocument: '',
  });

  it('siembra IVA 16% y UT Bs. 43,00 como referencia pendiente de confirmación', () => {
    const iva = dbInstance.getActiveFiscalReferenceValue('iva', '2025-06-02');
    const ut = dbInstance.getActiveFiscalReferenceValue('ut', '2025-06-02');
    expect(iva?.value).toBe(16);
    expect(iva?.effectiveFrom).toBe('2020-01-01');
    expect(iva?.status).toBe('referencia');
    expect(iva?.confirmedByAccountant).toBe(false);
    expect(ut?.value).toBe(43);
    expect(ut?.effectiveFrom).toBe('2025-06-02');
  });

  it('registra al ordinario fabricante de mermelada y retenciones practicadas como no aplica', () => {
    const obligations = dbInstance.getFiscalObligations();
    const byKey = (key: string) => obligations.find((item) => item.key === key);
    expect(byKey('tax_regime')).toMatchObject({applicability: 'aplica'});
    expect(byKey('tax_regime')?.notes).toContain('fabricación de mermelada');
    for (const key of ['special_taxpayer', 'vat_withholding', 'islr_withholding']) {
      expect(byKey(key)).toMatchObject({applicability: 'no_aplica', reviewedAt: '2026-11-22'});
    }
    expect(byKey('vat_withholding')?.notes).toContain('comprobantes de retención');
    expect(byKey('vat_withholding')?.notes).toContain('cuenta definitiva para retenciones recibidas');
    expect(byKey('islr_withholding')?.notes).toContain('comprobantes de retención');
    expect(byKey('islr_withholding')?.notes).toContain('clientes SPE al cobrar');
    expect(byKey('islr_withholding')?.notes).toContain('no se crean cuentas ni se alteran asientos');
    expect(byKey('igtf')).toMatchObject({applicability: 'no_aplica'});
    const bookSettings = dbInstance.getAccountingBookSettings();
    expect(bookSettings.notes).toContain('35 cuentas');
    expect(bookSettings.notes).toContain('retenciones recibidas');
    const ivaReference = dbInstance.getActiveFiscalReferenceValue('iva', '2025-06-02');
    const utReference = dbInstance.getActiveFiscalReferenceValue('ut', '2025-06-02');
    expect(ivaReference?.notes).toContain('mermelada procesada/envasada');
    expect(ivaReference?.notes).toContain('azúcar');
    expect(ivaReference?.notes).toContain('supuestos taxativos');
    expect(utReference?.notes).toContain('conceptos de ISLR');
    expect(utReference?.notes).toContain('arrendamientos');
    expect(utReference?.notes).toContain('sustraendo');
  });

  it('cierra la vigencia anterior automáticamente y conserva auditoría', () => {
    const created = dbInstance.createFiscalReferenceValue(
      referenceInput('iva', 15, '2026-01-01'),
      actor
    );
    const previous = dbInstance
      .getFiscalReferenceValues('iva')
      .find((item) => item.id === 'frv-iva-16-2020');
    expect(previous?.effectiveTo).toBe('2025-12-31');
    expect(previous?.status).toBe('historico');
    expect(dbInstance.getActiveFiscalReferenceValue('iva', '2025-12-31')?.value).toBe(16);
    expect(dbInstance.getActiveFiscalReferenceValue('iva', '2026-01-01')?.value).toBe(15);
    expect(
      dbInstance.getAuditLogs().some((log) => log.actionType === 'valor_fiscal_referencia_vigencia_cerrada')
    ).toBe(true);

    const annulled = dbInstance.annulFiscalReferenceValue(created.id, 'Prueba de anulación', actor);
    expect(annulled?.status).toBe('anulado');
    expect(annulled?.annulledReason).toBe('Prueba de anulación');
    expect(dbInstance.getFiscalReferenceValues('iva').some((item) => item.id === created.id)).toBe(true);
    expect(dbInstance.getActiveFiscalReferenceValue('iva', '2026-01-01')).toBeNull();
  });

  it('deja explícita la referencia provisional de IVA 0%/8% en Compras y Ventas', () => {
    const ventas = dbInstance.getAccountingBook('ventas', 2026, 11);
    const compras = dbInstance.getAccountingBook('compras', 2026, 11);
    expect(ventas.notes.join(' ')).toContain('0%/8%');
    expect(ventas.notes.join(' ')).toContain('base imponible, exento e impuesto');
    expect(compras.notes.join(' ')).toContain('supuestos taxativos');
    expect(compras.notes.join(' ')).toContain('sin cálculo');
  });

  it('guarda parámetros de libros y refleja la firma en los metadatos', () => {
    const updated = dbInstance.updateAccountingBookSettings(
      {
        approvedFormats: 'xlsx,pdf',
        auxiliaryFormat: 'csv',
        pagination: 'Pendiente',
        signatureText: 'Firma de prueba',
        signatureRole: 'Contador',
        exchangeRatePolicy: 'documento_con_fallback',
        notes: 'Parámetros de prueba',
        approvedAt: '2026-11-22',
      },
      actor
    );
    expect(updated.pagination).toBe('Pendiente');
    const book = dbInstance.getAccountingBook('diario', 2026, 11);
    expect(book.metadata.signatureLabel).toBe('Firma de prueba');
    expect(book.notes.join(' ')).toContain('Paginación: Pendiente');
  });
});
