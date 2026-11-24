import {paymentTermsToDays} from '../accounts-payable/payables.calculations';

export interface MaterialSupplierTerms {
  paymentCondition: 'contado' | 'credito';
  creditDays: number;
  paymentDueDate: string;
}

/** Suma días a una fecha ISO sin depender de la zona horaria del navegador. */
export function addDaysToIsoDate(dateIso: string, days: number): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(dateIso)
    ? dateIso
    : new Date().toISOString().slice(0, 10);
  const date = new Date(`${base}T00:00:00`);
  date.setDate(date.getDate() + Math.max(0, Math.trunc(days) || 0));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Condición de pago habitual derivada de los `paymentTerms` del proveedor.
 * Sin días reconocidos se muestra únicamente contado.
 */
export function deriveMaterialSupplierTerms(
  paymentTerms?: string,
  todayIso: string = new Date().toISOString().slice(0, 10)
): MaterialSupplierTerms {
  const days = paymentTermsToDays(paymentTerms);
  if (days <= 0) {
    return {paymentCondition: 'contado', creditDays: 0, paymentDueDate: ''};
  }
  return {
    paymentCondition: 'credito',
    creditDays: days,
    paymentDueDate: addDaysToIsoDate(todayIso, days),
  };
}
