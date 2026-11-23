import {Employee, PayrollWeek} from '../../core/models/erp.models';

export type EmployeeStatusFilter = 'todos' | 'activo' | 'vacaciones' | 'inactivo';

export interface EmployeePaymentHistoryRow {
  weekId: string;
  weekNumber: number;
  year: number;
  startDate: string;
  endDate: string;
  roleTitle: string;
  baseAmount: number;
  productionBonus: number;
  deductions: number;
  netPaid: number;
}

export interface EmployeePaymentTotals {
  count: number;
  baseAmount: number;
  productionBonus: number;
  deductions: number;
  netPaid: number;
}

/** Normaliza mayúsculas, espacios y tildes para búsquedas tolerantes. */
export function normalizePayrollSearch(value: string): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Solo los operarios activos entran en una nueva semana; baja y vacaciones no. */
export function isActiveForPayroll(employee: Employee): boolean {
  return employee.status === 'activo';
}

export function filterEmployees(
  employees: readonly Employee[],
  search: string,
  status: EmployeeStatusFilter
): Employee[] {
  const term = normalizePayrollSearch(search);
  return employees.filter((employee) => {
    if (status !== 'todos' && employee.status !== status) return false;
    if (!term) return true;
    return [employee.fullName, employee.nationalId, employee.roleTitle].some((field) =>
      normalizePayrollSearch(field).includes(term)
    );
  });
}

/** Historial de pagos de un operario, con el contexto de la semana. */
export function employeePaymentHistory(
  weeks: readonly PayrollWeek[],
  employeeId: string
): EmployeePaymentHistoryRow[] {
  if (!employeeId) return [];
  return weeks
    .flatMap((week) =>
      week.payments
        .filter((payment) => payment.employeeId === employeeId)
        .map((payment) => ({
          weekId: week.id,
          weekNumber: week.weekNumber,
          year: week.year,
          startDate: week.startDate,
          endDate: week.endDate,
          roleTitle: payment.roleTitle,
          baseAmount: payment.baseAmount,
          productionBonus: payment.productionBonus,
          deductions: payment.deductions,
          netPaid: payment.netPaid,
        }))
    )
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export function employeePaymentTotals(
  rows: readonly EmployeePaymentHistoryRow[]
): EmployeePaymentTotals {
  return rows.reduce<EmployeePaymentTotals>(
    (totals, row) => ({
      count: totals.count + 1,
      baseAmount: Number((totals.baseAmount + row.baseAmount).toFixed(2)),
      productionBonus: Number((totals.productionBonus + row.productionBonus).toFixed(2)),
      deductions: Number((totals.deductions + row.deductions).toFixed(2)),
      netPaid: Number((totals.netPaid + row.netPaid).toFixed(2)),
    }),
    {count: 0, baseAmount: 0, productionBonus: 0, deductions: 0, netPaid: 0}
  );
}

/** Un operario tiene pagos cuando alguna semana registra neto mayor que cero. */
export function hasEmployeePayments(
  weeks: readonly PayrollWeek[],
  employeeId: string
): boolean {
  return weeks.some((week) =>
    week.payments.some(
      (payment) => payment.employeeId === employeeId && payment.netPaid > 0
    )
  );
}

/** Cargos conocidos: personal actual y puestos usados en pagos históricos. */
export function knownRoleTitles(
  employees: readonly Employee[],
  weeks: readonly PayrollWeek[]
): string[] {
  const roles = new Set<string>();
  employees.forEach((employee) => {
    if (employee.roleTitle?.trim()) roles.add(employee.roleTitle.trim());
  });
  weeks.forEach((week) =>
    week.payments.forEach((payment) => {
      if (payment.roleTitle?.trim()) roles.add(payment.roleTitle.trim());
    })
  );
  return Array.from(roles).sort((a, b) => a.localeCompare(b, 'es'));
}

export function roleSuggestions(
  employees: readonly Employee[],
  weeks: readonly PayrollWeek[],
  query: string
): string[] {
  const term = normalizePayrollSearch(query);
  return knownRoleTitles(employees, weeks)
    .filter((role) => !term || normalizePayrollSearch(role).includes(term))
    .slice(0, 8);
}
