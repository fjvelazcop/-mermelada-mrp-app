import {
  buildPayableRows,
  computePayableTotals,
  filterPayables,
  payableOutstanding,
  paymentTermsToDays,
  summarizeBySupplier,
} from './payables.calculations';
import {Payable, PayablePayment} from './payables.model';

const TODAY = new Date(2026, 10, 21);

function makePayable(overrides: Partial<Payable> = {}): Payable {
  return {
    id: 'pay-1',
    payableNumber: 'FAP-2026-001',
    supplierId: 'sup-1',
    supplierName: 'Insumos del Llano C.A.',
    taxId: 'J-12345678-9',
    invoiceNumber: 'F-001',
    issueDate: '2026-10-01',
    dueDate: '2026-11-20',
    amountUsd: 100,
    exchangeRateUsed: 50,
    amountBs: 5000,
    category: 'materia_prima',
    status: 'pendiente',
    ...overrides,
  };
}

function makePayment(overrides: Partial<PayablePayment> = {}): PayablePayment {
  return {
    id: 'p-1',
    payableId: 'pay-1',
    bankCode: '0108',
    bankName: 'Banco Provincial',
    paymentMethod: 'transferencia_bancaria',
    reference: 'REF-1',
    amountUsd: 40,
    amountBs: 2000,
    exchangeRateUsed: 50,
    paidAt: '2026-11-15T10:00:00.000Z',
    paidBy: 'admin',
    ...overrides,
  };
}

describe('payables calculations', () => {
  it('suma pagos parciales, marca vencida y calcula aging', () => {
    const row = buildPayableRows({
      payables: [makePayable()],
      payments: [makePayment()],
      today: TODAY,
    })[0];
    expect(row.paidUsd).toBe(40);
    expect(row.balanceUsd).toBe(60);
    expect(row.balanceBs).toBe(3000);
    expect(row.daysOverdue).toBe(1);
    expect(row.agingBucket).toBe('1-30');
    expect(row.status).toBe('vencida');
    expect(row.partialPayment).toBe(true);
  });

  it('marca pagada sin saldo y excluye anuladas de los totales', () => {
    const rows = buildPayableRows({
      payables: [
        makePayable({id: 'paid', status: 'pagada'}),
        makePayable({id: 'annulled', status: 'anulada', amountUsd: 500}),
      ],
      payments: [makePayment({payableId: 'paid', amountUsd: 100})],
      today: TODAY,
    });
    expect(rows.find((row) => row.id === 'paid')?.status).toBe('pagada');
    expect(rows.find((row) => row.id === 'annulled')?.balanceUsd).toBe(0);
    expect(computePayableTotals(rows, TODAY).balanceUsd).toBe(0);
  });

  it('filtra por estado, bucket y proveedor', () => {
    const rows = buildPayableRows({
      payables: [
        makePayable({id: 'partial'}),
        makePayable({id: 'current', dueDate: '2026-12-15', amountUsd: 20}),
      ],
      payments: [makePayment({payableId: 'partial'})],
      today: TODAY,
    });
    expect(
      filterPayables(rows, {
        search: '',
        status: 'parciales',
        bucket: 'todos',
      }).map((row) => row.id)
    ).toEqual(['partial']);
    expect(
      filterPayables(rows, {
        search: 'insumos',
        status: 'todos',
        bucket: 'corriente',
        supplierId: 'sup-1',
      }).map((row) => row.id)
    ).toEqual(['current']);
  });

  it('resume por proveedor y calcula próximos a vencer', () => {
    const rows = buildPayableRows({
      payables: [
        makePayable({id: 'late', dueDate: '2026-11-01', amountUsd: 100}),
        makePayable({id: 'soon', dueDate: '2026-12-01', amountUsd: 50}),
      ],
      payments: [],
      today: TODAY,
    });
    const summary = summarizeBySupplier(rows);
    expect(summary.length).toBe(1);
    expect(summary[0].balanceUsd).toBe(150);
    expect(summary[0].overdueUsd).toBe(100);
    expect(summary[0].oldestDueDate).toBe('2026-11-01');
    expect(computePayableTotals(rows, TODAY).dueSoonUsd).toBe(50);
  });

  it('precarga el saldo y parsea condiciones de pago', () => {
    const payable = makePayable();
    expect(payableOutstanding(payable, [makePayment({amountUsd: 40})])).toBe(60);
    expect(paymentTermsToDays('Pago a 15 días')).toBe(15);
    expect(paymentTermsToDays('Contado')).toBe(0);
  });

  it('deriva el origen desde los movimientos vinculados y cuenta las líneas', () => {
    const rows = buildPayableRows({
      payables: [
        makePayable({id: 'from-inventory', origin: undefined}),
        makePayable({id: 'manual', invoiceNumber: 'F-002', origin: undefined}),
      ],
      payments: [],
      movements: [
        {
          id: 'mov-1',
          payableId: 'from-inventory',
          paymentCondition: 'credito',
          referenceDoc: 'F-001',
          materialName: 'Guayaba',
        },
        {
          id: 'mov-2',
          payableId: 'from-inventory',
          paymentCondition: 'credito',
          referenceDoc: 'F-001',
          materialName: 'Azúcar',
        },
        {
          id: 'mov-3',
          payableId: 'from-inventory',
          paymentCondition: 'contado',
          referenceDoc: 'F-001',
        },
      ],
      today: TODAY,
    });
    const inventory = rows.find((row) => row.id === 'from-inventory')!;
    expect(inventory.origin).toBe('compra_inventario');
    expect(inventory.movementId).toBe('mov-1');
    expect(inventory.linkedMovementCount).toBe(2);
    expect(rows.find((row) => row.id === 'manual')?.origin).toBe('manual');
  });

  it('filtra por origen y busca por el documento del movimiento vinculado', () => {
    const rows = buildPayableRows({
      payables: [
        makePayable({id: 'from-inventory'}),
        makePayable({id: 'manual', invoiceNumber: 'F-002'}),
      ],
      payments: [],
      movements: [
        {
          id: 'mov-1',
          payableId: 'from-inventory',
          paymentCondition: 'credito',
          referenceDoc: 'F-INV-777',
        },
      ],
      today: TODAY,
    });
    expect(
      filterPayables(rows, {search: '', status: 'todos', bucket: 'todos', origin: 'compra_inventario'}).map(
        (row) => row.id
      )
    ).toEqual(['from-inventory']);
    expect(
      filterPayables(rows, {search: '', status: 'todos', bucket: 'todos', origin: 'manual'}).map(
        (row) => row.id
      )
    ).toEqual(['manual']);
    expect(
      filterPayables(rows, {search: 'F-INV-777', status: 'todos', bucket: 'todos'}).map((row) => row.id)
    ).toEqual(['from-inventory']);
  });
});
