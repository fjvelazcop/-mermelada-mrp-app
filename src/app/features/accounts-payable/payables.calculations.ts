import {
  BuildPayableRowsInput,
  PayablePayment,
  Payable,
  PayableAgingBucket,
  PayableFilters,
  PayableRow,
  PayableSupplierSummary,
  PayableTotals,
} from './payables.model';

const EMPTY_BUCKETS = (): Record<PayableAgingBucket, {count: number; usd: number}> => ({
  corriente: {count: 0, usd: 0},
  '1-30': {count: 0, usd: 0},
  '31-60': {count: 0, usd: 0},
  '61-90': {count: 0, usd: 0},
  '>90': {count: 0, usd: 0},
});

export function roundMoney(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

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

function daysBetween(today: Date, dueDate: Date): number {
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dueUtc = Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
  return Math.max(0, Math.round((todayUtc - dueUtc) / 86_400_000));
}

export function bucketForDays(daysOverdue: number): PayableAgingBucket {
  if (daysOverdue <= 0) return 'corriente';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '>90';
}

/** Parsea "15 días" / "Contado" para sugerir el vencimiento del payable. */
export function paymentTermsToDays(paymentTerms?: string): number {
  if (!paymentTerms) return 0;
  const match = paymentTerms.toLowerCase().match(/(\d+)\s*d[ií]as?/);
  if (!match) return 0;
  const days = Number(match[1]);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

/** Construye una fila por factura por pagar. */
export function buildPayableRows(input: BuildPayableRowsInput): PayableRow[] {
  const today = input.today ?? new Date();
  const paymentsByPayable = new Map<string, BuildPayableRowsInput['payments']>();
  for (const payment of input.payments) {
    const list = paymentsByPayable.get(payment.payableId) ?? [];
    list.push(payment);
    paymentsByPayable.set(payment.payableId, list);
  }

  return input.payables.map((payable) => {
    const payments = paymentsByPayable.get(payable.id) ?? [];
    const paidUsd = roundMoney(
      payments.reduce(
        (sum, payment) => sum + (Number.isFinite(payment.amountUsd) ? payment.amountUsd : 0),
        0
      )
    );
    const totalUsd = roundMoney(payable.amountUsd);
    const isAnnulled = payable.status === 'anulada';
    const rawBalance = roundMoney(totalUsd - paidUsd);
    const balanceUsd = isAnnulled ? 0 : Math.max(0, rawBalance);
    const dueDate = parseDate(payable.dueDate);
    const daysOverdue = balanceUsd > 0 && dueDate ? daysBetween(today, dueDate) : 0;
    const status: PayableRow['status'] =
      payable.status === 'anulada'
        ? 'anulada'
        : balanceUsd <= 0.01
          ? 'pagada'
          : daysOverdue > 0
            ? 'vencida'
            : paidUsd > 0
              ? 'parcial'
              : 'pendiente';
    const exchangeRateUsed = Number(payable.exchangeRateUsed) || 48.35;

    return {
      payable,
      id: payable.id,
      supplierId: payable.supplierId ?? '',
      supplierName: payable.supplierName,
      taxId: payable.taxId ?? '',
      payableNumber: payable.payableNumber,
      invoiceNumber: payable.invoiceNumber,
      controlNumber: payable.controlNumber,
      issueDate: payable.issueDate,
      dueDate: payable.dueDate,
      daysOverdue,
      agingBucket: bucketForDays(daysOverdue),
      totalUsd,
      paidUsd,
      balanceUsd,
      balanceBs: roundMoney(balanceUsd * exchangeRateUsed),
      exchangeRateUsed,
      status,
      partialPayment: paidUsd > 0 && balanceUsd > 0.01,
      paymentCount: payments.length,
      expenseId: payable.expenseId,
    };
  });
}

function matchesSearch(row: PayableRow, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [
    row.supplierName,
    row.taxId,
    row.payableNumber,
    row.invoiceNumber,
    row.controlNumber ?? '',
  ].some((value) => value.toLowerCase().includes(term));
}

export function filterPayables(rows: PayableRow[], filters: PayableFilters): PayableRow[] {
  return rows.filter((row) => {
    if (!matchesSearch(row, filters.search)) return false;
    if (filters.supplierId && row.supplierId !== filters.supplierId) return false;
    if (filters.bucket !== 'todos' && row.agingBucket !== filters.bucket) return false;
    if (filters.status === 'pendientes' && row.status !== 'pendiente') return false;
    if (filters.status === 'vencidas' && !(row.status === 'vencida' && row.balanceUsd > 0)) {
      return false;
    }
    if (filters.status === 'parciales' && !row.partialPayment) return false;
    if (filters.status === 'pagadas' && row.status !== 'pagada') return false;
    return true;
  });
}

export type PayableSort = 'dueDate' | 'balance' | 'supplier';

export function sortPayables(rows: PayableRow[], sort: PayableSort = 'dueDate'): PayableRow[] {
  const sorted = [...rows];
  if (sort === 'balance') {
    sorted.sort((a, b) => b.balanceUsd - a.balanceUsd || b.daysOverdue - a.daysOverdue);
  } else if (sort === 'supplier') {
    sorted.sort(
      (a, b) =>
        a.supplierName.localeCompare(b.supplierName) || (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
    );
  } else {
    sorted.sort(
      (a, b) => b.daysOverdue - a.daysOverdue || (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
    );
  }
  return sorted;
}

function isOutstanding(row: PayableRow): boolean {
  return row.balanceUsd > 0.01 && row.status !== 'anulada';
}

export function summarizeBySupplier(rows: PayableRow[]): PayableSupplierSummary[] {
  const grouped = new Map<string, PayableRow[]>();
  for (const row of rows.filter(isOutstanding)) {
    const key = row.supplierId || row.supplierName;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  return [...grouped.entries()]
    .map(([supplierId, supplierRows]) => {
      const first = supplierRows[0];
      const dueDates = supplierRows
        .filter((row) => isOutstanding(row) && row.dueDate)
        .map((row) => row.dueDate)
        .sort();
      return {
        supplierId,
        supplierName: first.supplierName,
        taxId: first.taxId,
        balanceUsd: roundMoney(supplierRows.reduce((sum, row) => sum + row.balanceUsd, 0)),
        overdueUsd: roundMoney(
          supplierRows.filter((row) => row.daysOverdue > 0).reduce((sum, row) => sum + row.balanceUsd, 0)
        ),
        documentCount: supplierRows.length,
        oldestDueDate: dueDates[0] ?? null,
        maxDaysOverdue: Math.max(0, ...supplierRows.map((row) => row.daysOverdue)),
      };
    })
    .sort((a, b) => b.balanceUsd - a.balanceUsd || a.supplierName.localeCompare(b.supplierName));
}

export function computePayableTotals(
  rows: PayableRow[],
  today: Date = new Date()
): PayableTotals {
  const outstanding = rows.filter(isOutstanding);
  const buckets = EMPTY_BUCKETS();
  for (const row of outstanding) {
    buckets[row.agingBucket].count += 1;
    buckets[row.agingBucket].usd = roundMoney(buckets[row.agingBucket].usd + row.balanceUsd);
  }

  const balanceUsd = roundMoney(outstanding.reduce((sum, row) => sum + row.balanceUsd, 0));
  const overdueRows = outstanding.filter((row) => row.daysOverdue > 0);
  const overdueUsd = roundMoney(overdueRows.reduce((sum, row) => sum + row.balanceUsd, 0));
  const todayDate = parseDate(toIsoDate(today))!;
  const soonLimit = new Date(todayDate);
  soonLimit.setDate(soonLimit.getDate() + 15);
  const dueSoonUsd = roundMoney(
    outstanding
      .filter((row) => {
        const due = parseDate(row.dueDate);
        return due && due >= todayDate && due <= soonLimit;
      })
      .reduce((sum, row) => sum + row.balanceUsd, 0)
  );

  return {
    balanceUsd,
    balanceBs: roundMoney(outstanding.reduce((sum, row) => sum + row.balanceBs, 0)),
    overdueUsd,
    overdueBs: roundMoney(overdueRows.reduce((sum, row) => sum + row.balanceBs, 0)),
    overduePercent: balanceUsd > 0 ? roundMoney((overdueUsd / balanceUsd) * 100) : 0,
    dueSoonUsd,
    supplierCount: new Set(outstanding.map((row) => row.supplierId || row.supplierName)).size,
    documentCount: outstanding.length,
    buckets,
  };
}

/** Utilidad para precargar el modal de pago y validar montos. */
export function payableOutstanding(payable: Payable, payments: PayablePayment[]): number {
  const paid = payments
    .filter((payment) => payment.payableId === payable.id)
    .reduce((sum, payment) => sum + (Number(payment.amountUsd) || 0), 0);
  return payable.status === 'anulada' ? 0 : roundMoney(Math.max(0, payable.amountUsd - paid));
}
