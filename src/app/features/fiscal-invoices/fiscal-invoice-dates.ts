import {FiscalInvoice} from '../../core/models/erp.models';

/** Campos mínimos para calcular el vencimiento de una factura a crédito. */
export interface InvoiceForDueDate {
  saleCondition: FiscalInvoice['saleCondition'];
  creditDays?: number;
  salesOrderId?: string;
  issuedAt: string;
}

export interface OrderForDueDate {
  id: string;
  deliveryDate?: string;
  orderDate?: string;
}

/**
 * Vencimiento en DD-MM-AAAA desde `deliveryDate || orderDate` del pedido
 * vinculado, con fallback a la fecha de emisión. Devuelve null para contado.
 */
export function computeInvoiceDueDate(
  invoice: InvoiceForDueDate,
  orders: OrderForDueDate[] = []
): string | null {
  if (invoice.saleCondition !== 'credito' || !invoice.creditDays) return null;
  const order = orders.find((candidate) => candidate.id === invoice.salesOrderId);
  const base = order?.deliveryDate || order?.orderDate || invoice.issuedAt;
  const [year, month, day] = base.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  // Se construye en hora local para que el día no se desplace según la zona.
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + invoice.creditDays);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}
