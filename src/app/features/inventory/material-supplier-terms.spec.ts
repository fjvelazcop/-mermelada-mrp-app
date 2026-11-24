import {describe, expect, it} from 'vitest';
import {addDaysToIsoDate, deriveMaterialSupplierTerms} from './material-supplier-terms';

describe('Condición de pago del proveedor habitual de un insumo', () => {
  it('muestra solo contado cuando el proveedor no tiene días de crédito', () => {
    expect(deriveMaterialSupplierTerms('Contado', '2026-11-23')).toEqual({
      paymentCondition: 'contado',
      creditDays: 0,
      paymentDueDate: '',
    });
    expect(deriveMaterialSupplierTerms(undefined, '2026-11-23').paymentCondition).toBe('contado');
  });

  it('deriva crédito y vencimiento desde paymentTerms', () => {
    expect(deriveMaterialSupplierTerms('15 días', '2026-11-23')).toEqual({
      paymentCondition: 'credito',
      creditDays: 15,
      paymentDueDate: '2026-12-08',
    });
  });

  it('recalcula el vencimiento al ajustar los días de crédito', () => {
    expect(addDaysToIsoDate('2026-01-31', 30)).toBe('2026-03-02');
    expect(addDaysToIsoDate('2026-11-23', 0)).toBe('2026-11-23');
  });
});
