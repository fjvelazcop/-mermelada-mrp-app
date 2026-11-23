import {
  AgingBucket,
  BuildReceivableRowsInput,
  ReceivableCustomerSummary,
  ReceivableDocumentKindFilter,
  ReceivableFilters,
  ReceivableRow,
  ReceivableTotals,
} from './accounts-receivable.model';
import {outstandingForOrder} from '../sales/sales-collections';

const EMPTY_BUCKETS = (): Record<AgingBucket, {count: number; usd: number}> => ({
  corriente: {count: 0, usd: 0},
  '1-30': {count: 0, usd: 0},
  '31-60': {count: 0, usd: 0},
  '61-90': {count: 0, usd: 0},
  '>90': {count: 0, usd: 0},
});

function roundMoney(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

const NOTE_REASON_LABELS: Record<string, string> = {
  devolucion: 'Devolución',
  descuento: 'Descuento',
  bonificacion: 'Bonificación',
  error_precio: 'Error de precio',
  anulacion_parcial: 'Anulación parcial',
  otro: 'Otro',
};

/** Etiqueta corta y trazable de una nota de crédito/débito. */
function describeNote(note: BuildReceivableRowsInput['notes'][number]): string {
  const prefix = note.type === 'nota_credito' ? 'NC' : 'ND';
  const number = [note.serie, note.noteNumber === undefined ? null : String(note.noteNumber)]
    .filter(Boolean)
    .join('-');
  const reason = note.reason
    ? NOTE_REASON_LABELS[note.reason] || note.reasonDetails || note.reason
    : note.reasonDetails || '';
  const amount = roundMoney(note.total).toFixed(2).replace('.', ',');
  return `${prefix}${number ? ` ${number}` : ''}${reason ? ` · ${reason}` : ''} ($${amount})`;
}

/** Parsea fechas ISO (yyyy-mm-dd o ISO con hora) usando hora local para evitar desfases UTC. */
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

function daysBetween(today: Date, dueDate: Date): number {
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dueUtc = Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  return Math.max(0, Math.round((todayUtc - dueUtc) / 86_400_000));
}

export function bucketForDays(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'corriente';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '>90';
}

/**
 * Construye una fila por pedido de venta. Incluye pedidos cobrados (saldo 0)
 * para que la vista pueda mostrarlos, pero los totales solo cuentan saldo > 0.
 */
export function buildReceivableRows(input: BuildReceivableRowsInput): ReceivableRow[] {
  const today = input.today ?? new Date();
  const fallbackRate = input.exchangeRateUsd || 48.35;

  const customersById = new Map(
    input.customers.map((customer) => [
      customer.id,
      {name: customer.businessName, taxId: customer.taxId},
    ])
  );

  // Una factura anulada no representa deuda: se ignora junto con sus notas.
  const activeInvoices = input.invoices.filter((invoice) => invoice.status !== 'anulada');
  const invoiceById = new Map(activeInvoices.map((invoice) => [invoice.id, invoice]));
  const invoicesByOrder = new Map<string, BuildReceivableRowsInput['invoices'][number]>();
  for (const invoice of [...activeInvoices].sort(
    (a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime()
  )) {
    if (invoice.salesOrderId && !invoicesByOrder.has(invoice.salesOrderId)) {
      invoicesByOrder.set(invoice.salesOrderId, invoice);
    }
  }

  const notesByInvoice = new Map<string, BuildReceivableRowsInput['notes']>();
  for (const note of input.notes) {
    if (!invoiceById.has(note.fiscalInvoiceId)) continue;
    const list = notesByInvoice.get(note.fiscalInvoiceId) ?? [];
    list.push(note);
    notesByInvoice.set(note.fiscalInvoiceId, list);
  }

  return input.orders.map((order) => {
    const customer = customersById.get(order.customerId);
    const invoice = invoicesByOrder.get(order.id);
    const orderNotes = invoice ? notesByInvoice.get(invoice.id) ?? [] : [];
    const adjustmentTypes = [...new Set(orderNotes.map((note) => note.type))];
    const hasDeliveryNote = !!order.hasDeliveryNote || !!order.deliveryNoteNumber;
    const invoiceLabel = invoice
      ? [invoice.serie, invoice.invoiceNumber].filter(Boolean).join('-')
      : null;
    const documentKind = invoice
      ? 'factura_fiscal'
      : hasDeliveryNote
        ? 'nota_entrega'
        : 'sin_documento';
    const documentLabel = invoice
      ? `Factura Fiscal ${invoiceLabel}`
      : hasDeliveryNote
        ? `Nota de entrega ${order.deliveryNoteNumber || order.orderNumber}`
        : 'Sin documento fiscal';

    const outstanding = outstandingForOrder(order, input.invoices, input.notes);
    const {
      totalUsd,
      collectedUsd,
      creditNotesUsd,
      debitNotesUsd,
      balanceUsd,
      creditBalanceUsd,
    } = outstanding;

    const baseDate = parseDate(order.deliveryDate) ?? parseDate(order.orderDate);
    const saleCondition = order.saleCondition ?? 'contado';
    const creditDays =
      saleCondition === 'credito' ? Math.max(0, Math.floor(order.creditDays || 30)) : 0;
    const dueDate = baseDate ? addDays(baseDate, creditDays) : null;
    const daysOverdue = dueDate ? daysBetween(today, dueDate) : 0;
    const agingBucket = bucketForDays(daysOverdue);

    const exchangeRateUsed = Number(order.exchangeRateUsed) || fallbackRate;
    const partialCollection = outstanding.hasPartialCollection;
    const status =
      order.status === 'cobrado' && balanceUsd === 0
        ? 'cobrado'
        : daysOverdue > 0
          ? 'vencido'
          : 'vigente';

    return {
      id: order.id,
      order,
      customerId: order.customerId,
      customerName: customer?.name || order.customerName,
      customerTaxId: customer?.taxId || order.customerTaxId,
      orderNumber: order.orderNumber,
      invoiceNumber: invoice
        ? [invoice.serie, invoice.invoiceNumber].filter(Boolean).join('-')
        : null,
      saleCondition,
      creditDays,
      baseDate: baseDate ? toIsoDate(baseDate) : null,
      dueDate: dueDate ? toIsoDate(dueDate) : null,
      daysOverdue,
      agingBucket,
      totalUsd,
      collectedUsd,
      creditNotesUsd,
      debitNotesUsd,
      balanceUsd,
      creditBalanceUsd,
      balanceBs: roundMoney(balanceUsd * exchangeRateUsed),
      exchangeRateUsed,
      status,
      partialCollection,
      hasInvoice: !!invoice,
      documentKind,
      documentLabel,
      noteDetails: orderNotes.map(describeNote),
      adjustmentTypes,
      hasDeliveryNote,
    };
  });
}

function matchesSearch(row: ReceivableRow, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [
    row.customerName,
    row.customerTaxId,
    row.orderNumber,
    row.invoiceNumber ?? '',
    row.documentLabel,
    row.order.deliveryNoteNumber ?? '',
    ...row.noteDetails,
  ].some((value) => value.toLowerCase().includes(term));
}

function matchesDocumentKind(
  row: ReceivableRow,
  filter: ReceivableDocumentKindFilter | undefined
): boolean {
  if (!filter || filter === 'todos') return true;
  if (row.documentKind === filter) return true;
  return (
    (filter === 'nota_credito' || filter === 'nota_debito') &&
    row.adjustmentTypes.includes(filter)
  );
}

/** Aplica búsqueda, estado, bucket y filtro de crédito a las filas calculadas. */
export function filterReceivables(rows: ReceivableRow[], filters: ReceivableFilters): ReceivableRow[] {
  return rows.filter((row) => {
    if (!matchesSearch(row, filters.search)) return false;

    if (filters.status === 'vigentes' && !(row.balanceUsd > 0 && row.daysOverdue === 0)) {
      return false;
    }
    if (filters.status === 'vencidos' && !(row.daysOverdue > 0 && row.balanceUsd > 0)) {
      return false;
    }
    if (filters.status === 'parciales' && !row.partialCollection) {
      return false;
    }
    if (filters.bucket !== 'todos' && row.agingBucket !== filters.bucket) return false;
    if (!matchesDocumentKind(row, filters.documentKind)) return false;
    if (filters.creditOnly && row.saleCondition !== 'credito') return false;

    return true;
  });
}

export type ReceivableSort = 'dueDate' | 'balance' | 'customer';

export function sortReceivables(rows: ReceivableRow[], sort: ReceivableSort = 'dueDate'): ReceivableRow[] {
  const sorted = [...rows];
  if (sort === 'balance') {
    sorted.sort((a, b) => b.balanceUsd - a.balanceUsd || b.daysOverdue - a.daysOverdue);
  } else if (sort === 'customer') {
    sorted.sort(
      (a, b) =>
        a.customerName.localeCompare(b.customerName) ||
        (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
    );
  } else {
    sorted.sort(
      (a, b) => b.daysOverdue - a.daysOverdue || b.balanceUsd - a.balanceUsd
    );
  }
  return sorted;
}

function isOutstanding(row: ReceivableRow): boolean {
  return row.balanceUsd > 0 || row.creditBalanceUsd > 0 || row.partialCollection;
}

/** Agrupa por cliente las filas con saldo (o con saldo a favor / cobro parcial). */
export function summarizeByCustomer(
  rows: ReceivableRow[],
  customers: {id: string; creditLimit: number}[]
): ReceivableCustomerSummary[] {
  const creditLimits = new Map(customers.map((customer) => [customer.id, customer.creditLimit]));
  const grouped = new Map<string, ReceivableRow[]>();

  for (const row of rows.filter(isOutstanding)) {
    const list = grouped.get(row.customerId) ?? [];
    list.push(row);
    grouped.set(row.customerId, list);
  }

  return [...grouped.entries()]
    .map(([customerId, customerRows]) => {
      const first = customerRows[0];
      const balanceUsd = roundMoney(
        customerRows.reduce((sum, row) => sum + row.balanceUsd, 0)
      );
      const overdueUsd = roundMoney(
        customerRows
          .filter((row) => row.daysOverdue > 0)
          .reduce((sum, row) => sum + row.balanceUsd, 0)
      );
      const dueDates = customerRows
        .filter((row) => row.balanceUsd > 0 && row.dueDate)
        .map((row) => row.dueDate as string)
        .sort();
      const creditLimitUsd = roundMoney(creditLimits.get(customerId) ?? 0);

      return {
        customerId,
        customerName: first.customerName,
        customerTaxId: first.customerTaxId,
        creditLimitUsd,
        availableCreditUsd: roundMoney(creditLimitUsd - balanceUsd),
        balanceUsd,
        overdueUsd,
        documentCount: customerRows.length,
        oldestDueDate: dueDates[0] ?? null,
        maxDaysOverdue: Math.max(0, ...customerRows.map((row) => row.daysOverdue)),
      };
    })
    .sort((a, b) => b.balanceUsd - a.balanceUsd || a.customerName.localeCompare(b.customerName));
}

/** Totales de la vista filtrada; los pedidos cobrados no aportan saldo. */
export function computeTotals(rows: ReceivableRow[]): ReceivableTotals {
  const outstanding = rows.filter(isOutstanding);
  const buckets = EMPTY_BUCKETS();

  for (const row of outstanding) {
    if (row.balanceUsd <= 0) continue;
    buckets[row.agingBucket].count += 1;
    buckets[row.agingBucket].usd = roundMoney(buckets[row.agingBucket].usd + row.balanceUsd);
  }

  const balanceUsd = roundMoney(outstanding.reduce((sum, row) => sum + row.balanceUsd, 0));
  const overdueRows = outstanding.filter((row) => row.daysOverdue > 0);
  const overdueUsd = roundMoney(
    overdueRows.reduce((sum, row) => sum + row.balanceUsd, 0)
  );

  return {
    balanceUsd,
    balanceBs: roundMoney(outstanding.reduce((sum, row) => sum + row.balanceBs, 0)),
    overdueUsd,
    overdueBs: roundMoney(overdueRows.reduce((sum, row) => sum + row.balanceBs, 0)),
    overduePercent: balanceUsd > 0 ? roundMoney((overdueUsd / balanceUsd) * 100) : 0,
    customerCount: new Set(outstanding.map((row) => row.customerId)).size,
    documentCount: outstanding.length,
    creditBalanceUsd: roundMoney(
      outstanding.reduce((sum, row) => sum + row.creditBalanceUsd, 0)
    ),
    buckets,
  };
}
