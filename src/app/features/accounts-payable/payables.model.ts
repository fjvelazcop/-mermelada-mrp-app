export type PayableStatus = 'pendiente' | 'parcial' | 'pagada' | 'anulada';
export type PayableAgingBucket = 'corriente' | '1-30' | '31-60' | '61-90' | '>90';

export interface PayablePayment {
  id: string;
  payableId: string;
  bankCode: string;
  bankName: string;
  paymentMethod: string;
  reference: string;
  amountUsd: number;
  amountBs: number;
  exchangeRateUsed: number;
  paidAt: string;
  paidBy: string;
}

/** Factura de un proveedor pendiente de pago. USD es la moneda canónica. */
export interface Payable {
  id: string;
  payableNumber: string;
  supplierId?: string;
  supplierName: string;
  taxId?: string;
  invoiceNumber: string;
  controlNumber?: string;
  issueDate: string;
  dueDate: string;
  amountUsd: number;
  exchangeRateUsed: number;
  amountBs: number;
  taxAmountUsd?: number;
  category: string;
  status: PayableStatus;
  notes?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  expenseId?: string;
}

export interface PayableRow {
  payable: Payable;
  id: string;
  supplierId: string;
  supplierName: string;
  taxId: string;
  payableNumber: string;
  invoiceNumber: string;
  controlNumber?: string;
  issueDate: string;
  dueDate: string;
  daysOverdue: number;
  agingBucket: PayableAgingBucket;
  totalUsd: number;
  paidUsd: number;
  balanceUsd: number;
  balanceBs: number;
  exchangeRateUsed: number;
  status: PayableStatus | 'vencida';
  partialPayment: boolean;
  paymentCount: number;
  expenseId?: string;
}

export type PayableStatusFilter =
  | 'todos'
  | 'pendientes'
  | 'vencidas'
  | 'parciales'
  | 'pagadas';

export interface PayableFilters {
  search: string;
  status: PayableStatusFilter;
  bucket: PayableAgingBucket | 'todos';
  supplierId?: string;
}

export interface PayableSupplierSummary {
  supplierId: string;
  supplierName: string;
  taxId: string;
  balanceUsd: number;
  overdueUsd: number;
  documentCount: number;
  oldestDueDate: string | null;
  maxDaysOverdue: number;
}

export interface PayableTotals {
  balanceUsd: number;
  balanceBs: number;
  overdueUsd: number;
  overdueBs: number;
  overduePercent: number;
  dueSoonUsd: number;
  supplierCount: number;
  documentCount: number;
  buckets: Record<PayableAgingBucket, {count: number; usd: number}>;
}

export interface BuildPayableRowsInput {
  payables: Payable[];
  payments: PayablePayment[];
  today?: Date;
}
