import {computeInvoiceDueDate} from './fiscal-invoice-dates';

const baseInvoice = {
  saleCondition: 'credito' as const,
  creditDays: 30,
  salesOrderId: 'so-1',
  issuedAt: '2026-11-01T12:00:00.000Z',
};

describe('computeInvoiceDueDate', () => {
  it('usa la fecha de entrega del pedido vinculado', () => {
    expect(
      computeInvoiceDueDate(baseInvoice, [
        {id: 'so-1', deliveryDate: '2026-11-05', orderDate: '2026-11-01'},
      ])
    ).toBe('05-12-2026');
  });

  it('cae a la fecha del pedido y luego a la emisión', () => {
    expect(
      computeInvoiceDueDate(baseInvoice, [{id: 'so-1', orderDate: '2026-11-10'}])
    ).toBe('10-12-2026');
    expect(computeInvoiceDueDate(baseInvoice)).toBe('01-12-2026');
  });

  it('devuelve null para contado o plazo cero', () => {
    expect(computeInvoiceDueDate({...baseInvoice, saleCondition: 'contado'})).toBeNull();
    expect(computeInvoiceDueDate({...baseInvoice, creditDays: 0})).toBeNull();
  });
});
