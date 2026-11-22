import {FiscalSaleCondition, SalesOrder} from '../../core/models/erp.models';

/** Antigüedad de la deuda, calculada en días corridos desde el vencimiento. */
export type AgingBucket = 'corriente' | '1-30' | '31-60' | '61-90' | '>90';

export type ReceivableStatus = 'vigente' | 'vencido' | 'cobrado';

export type ReceivableStatusFilter = 'todos' | 'vigentes' | 'vencidos' | 'parciales';

export type ReceivableBucketFilter = 'todos' | AgingBucket;

/** Una fila por pedido de venta, con su saldo y su vencimiento. */
export interface ReceivableRow {
  id: string;
  order: SalesOrder;
  customerId: string;
  customerName: string;
  customerTaxId: string;
  orderNumber: string;
  invoiceNumber: string | null;
  saleCondition: FiscalSaleCondition;
  creditDays: number;
  baseDate: string | null;
  dueDate: string | null;
  daysOverdue: number;
  agingBucket: AgingBucket;
  totalUsd: number;
  collectedUsd: number;
  creditNotesUsd: number;
  debitNotesUsd: number;
  balanceUsd: number;
  creditBalanceUsd: number;
  balanceBs: number;
  exchangeRateUsed: number;
  status: ReceivableStatus;
  /** El pedido figura como cobrado, pero el monto registrado no cubre el total. */
  partialCollection: boolean;
  hasInvoice: boolean;
}

/** Resumen de la deuda de un cliente. */
export interface ReceivableCustomerSummary {
  customerId: string;
  customerName: string;
  customerTaxId: string;
  creditLimitUsd: number;
  availableCreditUsd: number;
  balanceUsd: number;
  overdueUsd: number;
  documentCount: number;
  oldestDueDate: string | null;
  maxDaysOverdue: number;
}

/** Totales de la vista filtrada. */
export interface ReceivableTotals {
  balanceUsd: number;
  balanceBs: number;
  overdueUsd: number;
  overdueBs: number;
  overduePercent: number;
  customerCount: number;
  documentCount: number;
  creditBalanceUsd: number;
  buckets: Record<AgingBucket, {count: number; usd: number}>;
}

export interface ReceivableFilters {
  search: string;
  status: ReceivableStatusFilter;
  bucket: ReceivableBucketFilter;
  creditOnly: boolean;
}

export interface BuildReceivableRowsInput {
  orders: SalesOrder[];
  customers: {id: string; businessName: string; taxId: string; creditLimit: number}[];
  invoices: {
    id: string;
    salesOrderId?: string;
    serie: string;
    invoiceNumber: number;
    total: number;
    status: 'emitida' | 'anulada';
    issuedAt: string;
  }[];
  notes: {
    fiscalInvoiceId: string;
    type: 'nota_credito' | 'nota_debito';
    total: number;
  }[];
  exchangeRateUsd?: number | null;
  today?: Date;
}
