import {FiscalAdjustmentNote, FiscalInvoice, SalesOrder} from '../../core/models/erp.models';
import {
  bucketForDays,
  buildReceivableRows,
  computeTotals,
  filterReceivables,
  sortReceivables,
  summarizeByCustomer,
} from './accounts-receivable.calculations';

const TODAY = new Date(2026, 0, 31);

function makeOrder(overrides: Partial<SalesOrder> = {}): SalesOrder {
  return {
    id: 'order-1',
    orderNumber: 'PED-2026-001',
    customerId: 'customer-1',
    customerName: 'Panadería El Trigal',
    customerTaxId: 'J-123456789-0',
    saleCondition: 'contado',
    creditDays: 0,
    orderDate: '2026-01-01',
    deliveryDate: '2026-01-05',
    status: 'despachado',
    exchangeRateUsed: 50,
    items: [],
    subtotal: 100,
    taxAmount: 0,
    total: 100,
    hasDeliveryNote: false,
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<FiscalInvoice> = {}): FiscalInvoice {
  return {
    id: 'invoice-1',
    serie: 'A',
    invoiceNumber: 42,
    controlNumber: 1,
    saleCondition: 'contado',
    paymentMethod: 'transferencia_bancaria',
    creditDays: 0,
    salesOrderId: 'order-1',
    salesOrderNumber: 'PED-2026-001',
    emitterSnapshot: {} as FiscalInvoice['emitterSnapshot'],
    customerSnapshot: {} as FiscalInvoice['customerSnapshot'],
    items: [],
    subtotal: 100,
    taxAmount: 0,
    total: 100,
    exchangeRateUsed: 50,
    status: 'emitida',
    issuedAt: '2026-01-05T10:00:00.000Z',
    printCount: 0,
    periodYear: 2026,
    periodMonth: 1,
    ...overrides,
  };
}

function makeNote(overrides: Partial<FiscalAdjustmentNote> = {}): FiscalAdjustmentNote {
  return {
    id: 'note-1',
    type: 'nota_credito',
    serie: 'A',
    noteNumber: 1,
    controlNumber: 1,
    fiscalInvoiceId: 'invoice-1',
    invoiceNumber: 'A-42',
    invoiceControlNumber: 1,
    invoiceIssuedAt: '2026-01-05T10:00:00.000Z',
    emitterSnapshot: {} as FiscalAdjustmentNote['emitterSnapshot'],
    customerSnapshot: {} as FiscalAdjustmentNote['customerSnapshot'],
    reason: 'devolucion',
    items: [],
    subtotal: 10,
    taxAmount: 0,
    total: 10,
    exchangeRateUsed: 50,
    issuedAt: '2026-01-10T10:00:00.000Z',
    issuedBy: 'admin',
    printCount: 0,
    periodYear: 2026,
    periodMonth: 1,
    ...overrides,
  };
}

const customers = [{id: 'customer-1', businessName: 'Panadería El Trigal', taxId: 'J-123456789-0', creditLimit: 500}];

describe('accounts receivable calculations', () => {
  it('maps overdue days into aging buckets', () => {
    expect(bucketForDays(0)).toBe('corriente');
    expect(bucketForDays(1)).toBe('1-30');
    expect(bucketForDays(30)).toBe('1-30');
    expect(bucketForDays(31)).toBe('31-60');
    expect(bucketForDays(60)).toBe('31-60');
    expect(bucketForDays(61)).toBe('61-90');
    expect(bucketForDays(91)).toBe('>90');
  });

  it('uses the delivery date as the due date of a cash order', () => {
    const [row] = buildReceivableRows({
      orders: [makeOrder({total: 120})],
      customers,
      invoices: [],
      notes: [],
      today: TODAY,
    });

    expect(row.totalUsd).toBe(120);
    expect(row.balanceUsd).toBe(120);
    expect(row.balanceBs).toBe(6000);
    expect(row.baseDate).toBe('2026-01-05');
    expect(row.dueDate).toBe('2026-01-05');
    expect(row.daysOverdue).toBe(26);
    expect(row.agingBucket).toBe('1-30');
    expect(row.status).toBe('vencido');
  });

  it('adds the agreed credit days to the base date', () => {
    const [row] = buildReceivableRows({
      orders: [makeOrder({saleCondition: 'credito', creditDays: 30})],
      customers,
      invoices: [],
      notes: [],
      today: new Date(2026, 2, 3),
    });

    expect(row.dueDate).toBe('2026-02-04');
    expect(row.daysOverdue).toBe(27);
    expect(row.agingBucket).toBe('1-30');
    expect(row.creditDays).toBe(30);
  });

  it('defaults a credit order without credit days to 30 days', () => {
    const [row] = buildReceivableRows({
      orders: [makeOrder({saleCondition: 'credito', creditDays: 0})],
      customers,
      invoices: [],
      notes: [],
      today: TODAY,
    });

    expect(row.creditDays).toBe(30);
    expect(row.dueDate).toBe('2026-02-04');
  });

  it('reports a collected order with zero balance', () => {
    const [row] = buildReceivableRows({
      orders: [
        makeOrder({
          status: 'cobrado',
          collection: {
            id: 'col-1',
            bankCode: '0108',
            bankName: 'Banco Provincial',
            paymentMethod: 'transferencia_bancaria',
            reference: 'REF-1',
            amountUsd: 100,
            exchangeRateUsed: 50,
            collectedAt: '2026-01-20T10:00:00.000Z',
            collectedBy: 'admin',
          },
        }),
      ],
      customers,
      invoices: [],
      notes: [],
      today: TODAY,
    });

    expect(row.balanceUsd).toBe(0);
    expect(row.collectedUsd).toBe(100);
    expect(row.status).toBe('cobrado');
    expect(row.partialCollection).toBe(false);
    expect(computeTotals([row]).balanceUsd).toBe(0);
  });

  it('flags a collected order whose registered amount does not cover the total', () => {
    const [row] = buildReceivableRows({
      orders: [
        makeOrder({
          status: 'cobrado',
          collection: {
            id: 'col-2',
            bankCode: '0108',
            bankName: 'Banco Provincial',
            paymentMethod: 'transferencia_bancaria',
            reference: 'REF-2',
            amountUsd: 40,
            exchangeRateUsed: 50,
            collectedAt: '2026-01-20T10:00:00.000Z',
            collectedBy: 'admin',
          },
        }),
      ],
      customers,
      invoices: [],
      notes: [],
      today: TODAY,
    });

    expect(row.balanceUsd).toBe(60);
    expect(row.partialCollection).toBe(true);
  });

  it('suma varios abonos y permite filtrar solo cobros parciales', () => {
    const abono = (reference: string, amountUsd: number) => ({
      id: reference,
      bankCode: '0108',
      bankName: 'Banco Provincial',
      paymentMethod: 'transferencia_bancaria' as const,
      reference,
      amountUsd,
      exchangeRateUsed: 50,
      collectedAt: `2026-01-${reference === 'REF-A' ? '20' : '25'}T10:00:00.000Z`,
      collectedBy: 'admin',
    });
    const rows = buildReceivableRows({
      orders: [
        makeOrder({
          id: 'order-abonos',
          status: 'cobrado_parcial',
          collections: [abono('REF-A', 30), abono('REF-B', 20)],
        }),
      ],
      customers,
      invoices: [],
      notes: [],
      today: TODAY,
    });

    expect(rows[0].collectedUsd).toBe(50);
    expect(rows[0].balanceUsd).toBe(50);
    expect(rows[0].partialCollection).toBe(true);
    expect(
      filterReceivables(rows, {
        search: '',
        status: 'parciales',
        bucket: 'todos',
        creditOnly: false,
      }).length
    ).toBe(1);
  });

  it('ignores annulled invoices and uses the order total instead', () => {
    const [row] = buildReceivableRows({
      orders: [makeOrder({total: 100})],
      customers,
      invoices: [makeInvoice({status: 'anulada', total: 999})],
      notes: [makeNote({total: 50})],
      today: TODAY,
    });

    expect(row.hasInvoice).toBe(false);
    expect(row.invoiceNumber).toBeNull();
    expect(row.totalUsd).toBe(100);
    expect(row.creditNotesUsd).toBe(0);
    expect(row.balanceUsd).toBe(100);
  });

  it('uses the active invoice total and applies credit and debit notes', () => {
    const [row] = buildReceivableRows({
      orders: [makeOrder({total: 100})],
      customers,
      invoices: [makeInvoice({total: 200, serie: 'B', invoiceNumber: 7})],
      notes: [
        makeNote({id: 'credit-1', type: 'nota_credito', total: 30}),
        makeNote({id: 'debit-1', type: 'nota_debito', total: 10}),
      ],
      today: TODAY,
    });

    expect(row.hasInvoice).toBe(true);
    expect(row.invoiceNumber).toBe('B-7');
    expect(row.totalUsd).toBe(200);
    expect(row.creditNotesUsd).toBe(30);
    expect(row.debitNotesUsd).toBe(10);
    expect(row.balanceUsd).toBe(180);
  });

  it('never reports a negative receivable and exposes credit balances separately', () => {
    const [row] = buildReceivableRows({
      orders: [makeOrder({total: 100})],
      customers,
      invoices: [makeInvoice({total: 100})],
      notes: [makeNote({type: 'nota_credito', total: 150})],
      today: TODAY,
    });

    expect(row.balanceUsd).toBe(0);
    expect(row.creditBalanceUsd).toBe(50);
    expect(computeTotals([row]).creditBalanceUsd).toBe(50);
  });

  it('groups balances per customer and computes available credit', () => {
    const rows = buildReceivableRows({
      orders: [
        makeOrder({id: 'a', orderNumber: 'PED-A', total: 100, saleCondition: 'credito', creditDays: 30}),
        makeOrder({id: 'b', orderNumber: 'PED-B', total: 50, deliveryDate: '2026-01-20'}),
      ],
      customers,
      invoices: [],
      notes: [],
      today: TODAY,
    });

    const [summary] = summarizeByCustomer(rows, customers);
    expect(summary.documentCount).toBe(2);
    expect(summary.balanceUsd).toBe(150);
    expect(summary.availableCreditUsd).toBe(350);
    expect(summary.oldestDueDate).toBe('2026-01-20');
    expect(summary.maxDaysOverdue).toBe(11);
  });

  it('falls back to order date when delivery date is missing or invalid', () => {
    const rows = buildReceivableRows({
      orders: [
        makeOrder({id: 'a', deliveryDate: '', orderDate: '2026-01-10'}),
        makeOrder({id: 'b', deliveryDate: 'fecha-invalida', orderDate: '2026-01-11'}),
      ],
      customers,
      invoices: [],
      notes: [],
      today: TODAY,
    });

    expect(rows[0].baseDate).toBe('2026-01-10');
    expect(rows[1].baseDate).toBe('2026-01-11');
    expect(rows[1].daysOverdue).toBe(20);
  });

  it('filters by search, status, bucket and credit condition', () => {
    const rows = buildReceivableRows({
      orders: [
        makeOrder({
          id: 'a',
          orderNumber: 'PED-A',
          saleCondition: 'credito',
          creditDays: 1,
          deliveryDate: '2026-01-01',
        }),
        makeOrder({id: 'b', orderNumber: 'PED-B', deliveryDate: '2026-03-01'}),
      ],
      customers,
      invoices: [],
      notes: [],
      today: TODAY,
    });

    expect(
      filterReceivables(rows, {
        search: 'ped-a',
        status: 'todos',
        bucket: 'todos',
        creditOnly: false,
      }).map((row) => row.id)
    ).toEqual(['a']);

    expect(
      filterReceivables(rows, {
        search: '',
        status: 'vencidos',
        bucket: 'todos',
        creditOnly: false,
      }).map((row) => row.id)
    ).toEqual(['a']);

    expect(
      filterReceivables(rows, {
        search: '',
        status: 'todos',
        bucket: 'todos',
        creditOnly: true,
      }).map((row) => row.id)
    ).toEqual(['a']);

    expect(
      filterReceivables(rows, {
        search: '',
        status: 'todos',
        bucket: 'corriente',
        creditOnly: false,
      }).map((row) => row.id)
    ).toEqual(['b']);
  });

  it('sorts overdue documents before newer ones and larger balances first', () => {
    const rows = buildReceivableRows({
      orders: [
        makeOrder({id: 'new-small', deliveryDate: '2026-01-30', total: 10}),
        makeOrder({id: 'old-big', deliveryDate: '2026-01-02', total: 200}),
      ],
      customers,
      invoices: [],
      notes: [],
      today: TODAY,
    });

    expect(sortReceivables(rows).map((row) => row.id)).toEqual(['old-big', 'new-small']);
    expect(sortReceivables(rows, 'balance').map((row) => row.id)).toEqual([
      'old-big',
      'new-small',
    ]);
  });

  it('clasifica facturas fiscales, notas de entrega y notas de crédito/débito', () => {
    const rows = buildReceivableRows({
      orders: [
        makeOrder({id: 'invoice', orderNumber: 'PED-FACT'}),
        makeOrder({
          id: 'delivery',
          orderNumber: 'PED-NE',
          hasDeliveryNote: true,
          deliveryNoteNumber: 'NE-000124',
        }),
        makeOrder({id: 'plain', orderNumber: 'PED-SIN'}),
      ],
      customers,
      invoices: [makeInvoice({id: 'inv-a', salesOrderId: 'invoice'})],
      notes: [
        makeNote({
          id: 'nc-a',
          fiscalInvoiceId: 'inv-a',
          serie: 'A',
          noteNumber: 7,
          reason: 'devolucion',
          type: 'nota_credito',
          total: 10,
        }),
      ],
      today: TODAY,
    });

    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get('invoice')?.documentKind).toBe('factura_fiscal');
    expect(byId.get('invoice')?.documentLabel).toBe('Factura Fiscal A-42');
    expect(byId.get('invoice')?.noteDetails[0]).toContain('NC A-7');
    expect(byId.get('invoice')?.noteDetails[0]).toContain('Devolución');
    expect(byId.get('delivery')?.documentKind).toBe('nota_entrega');
    expect(byId.get('delivery')?.documentLabel).toContain('NE-000124');
    expect(byId.get('delivery')?.hasDeliveryNote).toBe(true);
    expect(byId.get('plain')?.documentKind).toBe('sin_documento');
  });

  it('filtra por tipo de documento incluyendo notas vinculadas a facturas', () => {
    const rows = buildReceivableRows({
      orders: [
        makeOrder({id: 'invoice', orderNumber: 'PED-FACT'}),
        makeOrder({id: 'delivery', hasDeliveryNote: true, deliveryNoteNumber: 'NE-1'}),
        makeOrder({id: 'plain'}),
      ],
      customers,
      invoices: [makeInvoice({id: 'inv-a', salesOrderId: 'invoice'})],
      notes: [makeNote({id: 'nc-a', fiscalInvoiceId: 'inv-a', type: 'nota_credito'})],
      today: TODAY,
    });

    const filterBy = (documentKind: 'factura_fiscal' | 'nota_entrega' | 'nota_credito' | 'nota_debito' | 'sin_documento') =>
      filterReceivables(rows, {
        search: '',
        status: 'todos',
        bucket: 'todos',
        creditOnly: false,
        documentKind,
      }).map((row) => row.id);

    expect(filterBy('factura_fiscal')).toEqual(['invoice']);
    expect(filterBy('nota_credito')).toEqual(['invoice']);
    expect(filterBy('nota_entrega')).toEqual(['delivery']);
    expect(filterBy('sin_documento')).toEqual(['plain']);
    expect(filterBy('nota_debito')).toEqual([]);
  });

  it('computes bucket totals and overdue percentage only from outstanding balances', () => {
    const rows = buildReceivableRows({
      orders: [
        makeOrder({id: 'paid', status: 'cobrado', total: 500, collection: {
          id: 'col-3',
          bankCode: '0108',
          bankName: 'Banco Provincial',
          paymentMethod: 'transferencia_bancaria',
          reference: 'REF-3',
          amountUsd: 500,
          exchangeRateUsed: 50,
          collectedAt: '2026-01-20T10:00:00.000Z',
          collectedBy: 'admin',
        }}),
        makeOrder({id: 'overdue', deliveryDate: '2026-01-01', total: 75}),
        makeOrder({id: 'current', deliveryDate: '2026-02-01', total: 25}),
      ],
      customers,
      invoices: [],
      notes: [],
      today: TODAY,
    });

    const totals = computeTotals(rows);
    expect(totals.balanceUsd).toBe(100);
    expect(totals.overdueUsd).toBe(75);
    expect(totals.overduePercent).toBe(75);
    expect(totals.documentCount).toBe(2);
    expect(totals.buckets['1-30'].usd).toBe(75);
    expect(totals.buckets.corriente.usd).toBe(25);
  });
});
