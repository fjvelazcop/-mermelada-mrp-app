import {describe, expect, it} from 'vitest';
import {
  LEGACY_TO_VEN_NIF,
  VEN_NIF_ACCOUNTS,
  VEN_NIF_ACCOUNT_MAP,
  findVenNifAccount,
} from './ven-nif-accounts';

describe('Plan de cuentas VEN-NIF de 167 cuentas', () => {
  it('carga el catálogo completo y sin códigos duplicados', () => {
    expect(VEN_NIF_ACCOUNTS).toHaveLength(167);
    expect(new Set(VEN_NIF_ACCOUNTS.map((account) => account.code)).size).toBe(167);
    expect(findVenNifAccount('1.1.04.02')?.name).toContain('Materia Prima');
  });

  it('define los códigos definitivos usados por el ERP', () => {
    expect(VEN_NIF_ACCOUNT_MAP.cash).toBe('1.1.01.01');
    expect(VEN_NIF_ACCOUNT_MAP.banks).toBe('1.1.01.03');
    expect(VEN_NIF_ACCOUNT_MAP.accountsReceivable).toBe('1.1.03.01');
    expect(VEN_NIF_ACCOUNT_MAP.accountsPayable).toBe('2.1.02.01');
    expect(VEN_NIF_ACCOUNT_MAP.rawMaterialInventory).toBe('1.1.04.02');
    expect(VEN_NIF_ACCOUNT_MAP.finishedGoodsInventory).toBe('1.1.04.04');
    expect(VEN_NIF_ACCOUNT_MAP.vatCredit).toBe('1.1.05.01');
    expect(VEN_NIF_ACCOUNT_MAP.vatDebit).toBe('2.1.04.01');
    for (const code of Object.values(VEN_NIF_ACCOUNT_MAP)) {
      expect(findVenNifAccount(code)).toBeDefined();
    }
  });

  it('correlaciona los códigos provisionales 1.03.01 y 1.03.02', () => {
    expect(LEGACY_TO_VEN_NIF['1.03.01']).toBe('1.1.04.02');
    expect(LEGACY_TO_VEN_NIF['1.03.02']).toBe('1.1.04.04');
  });
});
