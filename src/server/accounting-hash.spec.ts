import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, setDbPath } from './database/persistence.js';
import type { ErpDatabase as ErpDatabaseType } from './erp-database.js';

const workDir = mkdtempSync(join(tmpdir(), 'mermelada-hash-'));
let dbInstance: ErpDatabaseType;

beforeAll(async () => {
  setDbPath(join(workDir, 'erp.db'));
  const module = await import('./erp-database.js');
  dbInstance = module.dbInstance;
});

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe('Cadena hash autorizada de asientos (#13)', () => {
  it('asigna hash y secuencia a los asientos creados', () => {
    const entry = dbInstance.createAccountingEntry({
      date: '2026-11-23',
      description: 'Asiento de prueba hash',
      lines: [
        {accountCode: '1.01.01', debit: 10},
        {accountCode: '5.01.02', credit: 10},
      ],
    });
    expect(entry.hashSequence).toBeGreaterThan(0);
    expect(entry.entryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.previousHash).toBe('');
  });

  it('encadena cada asiento con el hash del anterior y verifica la integridad', () => {
    const first = dbInstance.createAccountingEntry({
      date: '2026-11-23',
      description: 'Primero',
      lines: [
        {accountCode: '1.01.02', debit: 5},
        {accountCode: '5.01.02', credit: 5},
      ],
    });
    const second = dbInstance.createAccountingEntry({
      date: '2026-11-23',
      description: 'Segundo',
      lines: [
        {accountCode: '1.01.02', debit: 7},
        {accountCode: '5.01.02', credit: 7},
      ],
    });
    expect(second.previousHash).toBe(first.entryHash);
    expect(second.hashSequence).toBe((first.hashSequence || 0) + 1);
    expect(dbInstance.verifyAccountingHashes().valid).toBe(true);
  });

  it('detecta cambios en un asiento y repara la cadena', () => {
    const entries = dbInstance.getAccountingEntries();
    const target = entries[entries.length - 1];
    target.description = 'Modificado sin autorización';
    const before = dbInstance.verifyAccountingHashes();
    expect(before.valid).toBe(false);
    expect(before.repairedEntries).toBeGreaterThan(0);
    const after = dbInstance.verifyAccountingHashes(true);
    expect(after.valid).toBe(true);
    expect(after.repairedEntries).toBeGreaterThan(0);
  });
});
