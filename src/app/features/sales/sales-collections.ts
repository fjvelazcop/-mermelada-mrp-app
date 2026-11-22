import {
  FiscalAdjustmentType,
  SalesCollection,
  SalesOrder,
} from '../../core/models/erp.models';

/** Campos mínimos necesarios para calcular el saldo (acepta entidades completas). */
export interface InvoiceForBalance {
  id: string;
  salesOrderId?: string;
  status: string;
  total: number;
  issuedAt: string;
}

export interface NoteForBalance {
  fiscalInvoiceId: string;
  type: FiscalAdjustmentType;
  total: number;
}

/** Saldo canónico de un pedido, calculado siempre en USD. */
export interface OrderOutstanding {
  /** Total facturado vigente (factura fiscal activa o total del pedido). */
  totalUsd: number;
  /** Suma de todos los abonos registrados. */
  collectedUsd: number;
  creditNotesUsd: number;
  debitNotesUsd: number;
  /** Lo que aún se debe; nunca negativo. */
  balanceUsd: number;
  /** Exceso pagado o notas de crédito posteriores; se reporta aparte. */
  creditBalanceUsd: number;
  collections: SalesCollection[];
  lastCollection: SalesCollection | null;
  /** Hubo abonos pero todavía queda saldo por cobrar. */
  hasPartialCollection: boolean;
}

export function roundMoney(value: number): number {
  return Number.isFinite(value) ? Math.round(Number(value) * 100) / 100 : 0;
}

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Historial ordenado cronológicamente. Acepta pedidos antiguos que solo tienen
 * `collection` (backfill v10) y evita contar dos veces el último abono cuando
 * ambas propiedades están presentes.
 */
export function collectionsForOrder(
  order: SalesOrder,
  explicit?: SalesCollection[]
): SalesCollection[] {
  const list = [...(explicit ?? order.collections ?? [])];
  const legacy = order.collection;
  if (
    legacy &&
    !list.some(
      (entry) =>
        entry.id === legacy.id ||
        (entry.reference === legacy.reference &&
          entry.amountUsd === legacy.amountUsd &&
          entry.collectedAt === legacy.collectedAt)
    )
  ) {
    list.push(legacy);
  }
  return list.sort((a, b) => (a.collectedAt || '').localeCompare(b.collectedAt || ''));
}

/**
 * Regla única de saldo para Ventas y Cuentas por Cobrar:
 * total vigente + notas de débito − notas de crédito − abonos acumulados.
 */
export function outstandingForOrder(
  order: SalesOrder,
  invoices: InvoiceForBalance[] = [],
  notes: NoteForBalance[] = [],
  collections?: SalesCollection[]
): OrderOutstanding {
  const activeInvoice = [...invoices]
    .filter((invoice) => invoice.salesOrderId === order.id && invoice.status !== 'anulada')
    .sort((a, b) => (b.issuedAt || '').localeCompare(a.issuedAt || ''))[0];

  const totalUsd = roundMoney(money(activeInvoice ? activeInvoice.total : order.total));
  const invoiceNotes = activeInvoice
    ? notes.filter((note) => note.fiscalInvoiceId === activeInvoice.id)
    : [];
  const creditNotesUsd = roundMoney(
    invoiceNotes
      .filter((note) => note.type === 'nota_credito')
      .reduce((sum, note) => sum + money(note.total), 0)
  );
  const debitNotesUsd = roundMoney(
    invoiceNotes
      .filter((note) => note.type === 'nota_debito')
      .reduce((sum, note) => sum + money(note.total), 0)
  );

  const history = collectionsForOrder(order, collections);
  const collectedUsd = roundMoney(
    history.reduce((sum, entry) => sum + money(entry.amountUsd), 0)
  );
  const rawBalance = totalUsd + debitNotesUsd - creditNotesUsd - collectedUsd;
  const balanceUsd = Math.max(0, roundMoney(rawBalance));
  const creditBalanceUsd = Math.max(0, roundMoney(-rawBalance));

  return {
    totalUsd,
    collectedUsd,
    creditNotesUsd,
    debitNotesUsd,
    balanceUsd,
    creditBalanceUsd,
    collections: history,
    lastCollection: history.length ? history[history.length - 1] : null,
    hasPartialCollection: collectedUsd > 0 && balanceUsd > 0,
  };
}
