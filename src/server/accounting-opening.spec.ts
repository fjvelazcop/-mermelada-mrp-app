import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, setDbPath } from './database/persistence.js';
import type { ErpDatabase as ErpDatabaseType } from './erp-database.js';

const workDir = mkdtempSync(join(tmpdir(), 'mermelada-opening-'));
const dbPath = join(workDir, 'erp.db');
let ErpDatabase: typeof ErpDatabaseType;
let dbInstance: ErpDatabaseType;

beforeAll(async () => {
  setDbPath(dbPath);
  const module = await import('./erp-database.js');
  ErpDatabase = module.ErpDatabase;
  dbInstance = module.dbInstance;
});

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe('Apertura provisional #13', () => {
  it('siembra Banco 30.000 USD en 1.01.02 y el resto en cero', () => {
    const opening = dbInstance.getAccountingOpening();
    const bank = opening.auxiliaryBalances.find((item) => item.kind === 'banco');
    expect(opening.status).toBe('borrador');
    expect(opening.postingStatus).toBe('borrador_provisional');
    expect(bank).toMatchObject({accountCode: '1.01.02', amountUsd: 30000});
    expect(opening.auxiliaryBalances.filter((item) => item.kind !== 'banco').every((item) => item.amountUsd === 0)).toBe(true);
    expect(opening.generalBalances.every((item) => item.amountUsd === 0)).toBe(true);
    expect(opening.adjustments).toHaveLength(0);
  });

  it('cuadra en USD y Bs con la tasa de cada línea y mantiene el asiento borrador', () => {
    const opening = dbInstance.getAccountingOpening();
    const updated = dbInstance.updateAccountingOpening({
      legalEntity: {
        ...opening.legalEntity,
        currentName: 'Empresa original',
        convertedName: 'Sociedad convertida',
        legalForm: 'S.R.L.',
      },
      cutoffDate: '2026-11-23',
      generalBalances: opening.generalBalances,
      auxiliaryBalances: opening.auxiliaryBalances.map((item) =>
        item.kind === 'banco'
          ? {
              ...item,
              exchangeRateUsed: 40,
              rateSource: 'Tasa capturada en apertura' as const,
            }
          : item
      ),
      shareholders: [
        {
          id: 'ob-acc-test',
          name: 'Accionista de prueba',
          accountCode: '3.01',
          amountUsd: 30000,
          exchangeRateUsed: 40,
          rateSource: 'Tasa capturada en apertura',
        },
      ],
      notes: 'Prueba de apertura bilingüe',
    });

    expect(updated.cutoffDate).toBe('2026-11-23');
    expect(updated.auxiliaryBalances.find((item) => item.kind === 'banco')?.amountBs).toBe(1200000);
    expect(updated.openingEntryId).toBeTruthy();

    const entry = dbInstance.getAccountingEntry(updated.openingEntryId!)!;
    expect(entry.status).toBe('borrador');
    expect(entry.sourceType).toBe('apertura');
    expect(entry.sourceId).toBe('apertura-13');
    expect(entry.totalDebit).toBe(30000);
    expect(entry.totalCredit).toBe(30000);
    expect(entry.lines).toHaveLength(2);
    expect(() => dbInstance.confirmAccountingEntry(entry.id)).toThrow(/autorización contable expresa/);
  });

  it('suma ajustes financieros al cuadre y al asiento provisional', () => {
    const adjustmentsBefore = dbInstance.getAccountingOpening().adjustments.length;
    const adjusted = dbInstance.recordOpeningAdjustment({
      date: '2026-11-23',
      accountCode: '1.01.01',
      description: 'Efectivo en caja incorporado',
      direction: 'debito',
      amountUsd: 100,
      exchangeRateUsed: 40,
      rateSource: 'Tasa capturada en apertura',
    });

    expect(adjusted.adjustments).toHaveLength(1);
    expect(adjusted.adjustments[0]).toMatchObject({amountUsd: 100, amountBs: 4000});
    const entry = dbInstance.getAccountingEntry(adjusted.openingEntryId!)!;
    expect(entry.totalDebit).toBe(30100);
    expect(entry.totalCredit).toBe(30000);
    expect(entry.status).toBe('borrador');
    expect(entry.lines.some((line) => line.memo?.includes('ajuste'))).toBe(true);
    expect(adjustmentsBefore).toBe(0);
  });

  it('persiste la apertura tras recargar la base y conserva las banderas Fase 0', () => {
    const reloaded = new ErpDatabase();
    const opening = reloaded.getAccountingOpening();
    expect(opening.cutoffDate).toBe('2026-11-23');
    expect(opening.adjustments).toHaveLength(1);
    expect(opening.auxiliaryBalances.find((item) => item.kind === 'banco')?.amountBs).toBe(1200000);

    const settings = reloaded.getFiscalSettings();
    expect(settings.vatWithholdingEnabled).toBe(false);
    expect(settings.islrWithholdingEnabled).toBe(false);
    expect(settings.digitalInvoicingEnabled).toBe(false);
    expect(settings.taxRegime).toBe('ordinario');
  });
});
