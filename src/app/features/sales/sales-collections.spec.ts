import {FiscalAdjustmentNote, FiscalInvoice, SalesCollection, SalesOrder} from '../../core/models/erp.models';
import {collectionsForOrder, outstandingForOrder} from './sales-collections';

function makeOrder(overrides: Partial<SalesOrder> = {}): SalesOrder {
  return {
    id: 'order-1',
    orderNumber: 'PED-2026-044',
    customerId: 'customer-1',
    customerName: 'El Trigal',
    customerTaxId: 'J-123',
    status: 'despachado',
    total: 125.63,
    exchangeRateUsed: 50,
    items: [],
    subtotal: 104.66,
    taxAmount: 20.97,
    orderDate: '2026-01-01',
    deliveryDate: '2026-01-05',
    hasDeliveryNote: false,
    ...overrides,
  };
}

function makeCollection(overrides: Partial<SalesCollection> = {}): SalesCollection {
  return {
    id: 'col-1',
    bankCode: '0108',
    bankName: 'Banco Provincial',
    paymentMethod: 'transferencia_bancaria',
    reference: 'REF-1',
    amountUsd: 50,
    exchangeRateUsed: 50,
    collectedAt: '2026-01-10T10:00:00.000Z',
    collectedBy: 'admin',
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<FiscalInvoice> = {}): FiscalInvoice {
  return {
    id: 'inv-1',
    salesOrderId: 'order-1',
    serie: 'A',
    invoiceNumber: 1,
    status: 'emitida',
    total: 125.63,
    issuedAt: '2026-01-06',
    ...overrides,
  } as unknown as FiscalInvoice;
}

function makeNote(overrides: Partial<FiscalAdjustmentNote>): FiscalAdjustmentNote {
  return {
    id: 'note-1',
    fiscalInvoiceId: 'inv-1',
    type: 'nota_credito',
    total: 10,
    ...overrides,
  } as unknown as FiscalAdjustmentNote;
}

describe('collectionsForOrder', () => {
  it('usan collections y ordenan por fecha', () => {
    const order = makeOrder({
      collections: [
        makeCollection({id: 'col-2', collectedAt: '2026-02-01T10:00:00.000Z'}),
        makeCollection({id: 'col-1', collectedAt: '2026-01-01T10:00:00.000Z'}),
      ],
    });
    expect(collectionsForOrder(order).map((entry) => entry.id)).toEqual(['col-1', 'col-2']);
  });

  it('hacen backfill de pedidos que solo tienen collection', () => {
    const legacy = makeCollection();
    expect(collectionsForOrder(makeOrder({collection: legacy})).map((entry) => entry.id)).toEqual([
      'col-1',
    ]);
  });

  it('no duplican el último abono cuando ambas propiedades están presentes', () => {
    const last = makeCollection();
    const order = makeOrder({collections: [last], collection: last});
    expect(collectionsForOrder(order).length).toBe(1);
  });
});

describe('outstandingForOrder', () => {
  it('suma varios abonos y marca el cobro parcial', () => {
    const order = makeOrder({
      status: 'cobrado_parcial',
      collections: [
        makeCollection({id: 'col-1', amountUsd: 50}),
        makeCollection({id: 'col-2', amountUsd: 25.63, reference: 'REF-2'}),
      ],
    });
    const result = outstandingForOrder(order);

    expect(result.collectedUsd).toBe(75.63);
    expect(result.balanceUsd).toBe(50);
    expect(result.hasPartialCollection).toBe(true);
    expect(result.lastCollection?.id).toBe('col-2');
  });

  it('da saldo cero cuando los abonos cubren el total', () => {
    const order = makeOrder({
      status: 'cobrado',
      collection: makeCollection({amountUsd: 125.63}),
    });
    const result = outstandingForOrder(order);
    expect(result.balanceUsd).toBe(0);
    expect(result.hasPartialCollection).toBe(false);
  });

  it('usa la factura vigente y aplica notas de crédito/débito', () => {
    const order = makeOrder({total: 999});
    const result = outstandingForOrder(
      order,
      [makeInvoice({total: 200})],
      [
        makeNote({id: 'n-1', type: 'nota_credito', total: 20}),
        makeNote({id: 'n-2', type: 'nota_debito', total: 5}),
        makeNote({id: 'n-3', type: 'nota_credito', total: 100, fiscalInvoiceId: 'otra'}),
      ]
    );
    expect(result.totalUsd).toBe(200);
    expect(result.creditNotesUsd).toBe(20);
    expect(result.debitNotesUsd).toBe(5);
    expect(result.balanceUsd).toBe(185);
  });

  it('ignora facturas anuladas y reporta saldo a favor', () => {
    const order = makeOrder({total: 100});
    const result = outstandingForOrder(
      order,
      [makeInvoice({status: 'anulada', total: 999})],
      [],
      [makeCollection({amountUsd: 120})]
    );
    expect(result.totalUsd).toBe(100);
    expect(result.balanceUsd).toBe(0);
    expect(result.creditBalanceUsd).toBe(20);
  });
});
