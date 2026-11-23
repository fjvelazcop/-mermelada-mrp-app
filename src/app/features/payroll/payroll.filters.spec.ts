import {describe, expect, it} from 'vitest';
import {Employee, PayrollWeek} from '../../core/models/erp.models';
import {
  employeePaymentHistory,
  employeePaymentTotals,
  filterEmployees,
  hasEmployeePayments,
  isActiveForPayroll,
  knownRoleTitles,
  normalizePayrollSearch,
  roleSuggestions,
} from './payroll.filters';

const employee = (overrides: Partial<Employee> = {}): Employee => ({
  id: 'emp-1',
  fullName: 'José Gregorio Escalona',
  nationalId: 'V-16.782.901',
  roleTitle: 'Maestro Pailero y Cocción',
  weeklyBaseSalary: 75,
  hourlyRate: 1.88,
  status: 'activo',
  ...overrides,
});

const week = (payments: PayrollWeek['payments']): PayrollWeek => ({
  id: 'pw-1',
  weekNumber: 40,
  year: 2026,
  startDate: '2026-10-05',
  endDate: '2026-10-11',
  isActiveProduction: true,
  payments,
  totalPayrollPaid: 88,
  fixedAbsorptionCost: 0,
});

describe('Filtros y utilidades de Nómina', () => {
  it('busca por nombre, cédula o cargo ignorando tildes y mayúsculas', () => {
    const staff = [
      employee(),
      employee({
        id: 'emp-2',
        fullName: 'Yelitza Coromoto Blanco',
        nationalId: 'V-19.345.112',
        roleTitle: 'Operaria de Selección',
      }),
      employee({
        id: 'emp-3',
        fullName: 'Miguel Ángel Duarte',
        nationalId: 'V-22.109.874',
        roleTitle: 'Auxiliar de Envasado',
        status: 'inactivo',
      }),
    ];

    expect(normalizePayrollSearch('  ÁNGEL  ')).toBe('angel');
    expect(filterEmployees(staff, 'yelitza', 'todos').map((e) => e.id)).toEqual(['emp-2']);
    expect(filterEmployees(staff, '22.109', 'todos').map((e) => e.id)).toEqual(['emp-3']);
    expect(filterEmployees(staff, 'coccion', 'todos').map((e) => e.id)).toEqual(['emp-1']);
    expect(filterEmployees(staff, '', 'inactivo').map((e) => e.id)).toEqual(['emp-3']);
    expect(filterEmployees(staff, '', 'todos')).toHaveLength(3);
  });

  it('excluye de una nueva semana a inactivos y a operarios de vacaciones', () => {
    expect(isActiveForPayroll(employee())).toBe(true);
    expect(isActiveForPayroll(employee({status: 'vacaciones'}))).toBe(false);
    expect(isActiveForPayroll(employee({status: 'inactivo'}))).toBe(false);
    expect(filterEmployees([employee(), employee({status: 'vacaciones'})], '', 'vacaciones')).toEqual([
      employee({status: 'vacaciones'}),
    ]);
  });

  it('compone el historial individual y distingue pagos reales', () => {
    const weeks = [
      week([
        {
          employeeId: 'emp-1',
          employeeName: 'José Gregorio Escalona',
          roleTitle: 'Maestro Pailero',
          baseAmount: 75,
          productionBonus: 15,
          deductions: 2,
          netPaid: 88,
        },
      ]),
      {
        ...week([]),
        id: 'pw-2',
        weekNumber: 41,
        startDate: '2026-10-12',
        payments: [
          {
            employeeId: 'emp-2',
            employeeName: 'Otro operario',
            roleTitle: 'Envasado',
            baseAmount: 60,
            productionBonus: 0,
            deductions: 0,
            netPaid: 0,
          },
        ],
      },
    ];

    const history = employeePaymentHistory(weeks, 'emp-1');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({weekNumber: 40, roleTitle: 'Maestro Pailero', netPaid: 88});
    expect(employeePaymentTotals(history)).toEqual({
      count: 1,
      baseAmount: 75,
      productionBonus: 15,
      deductions: 2,
      netPaid: 88,
    });
    expect(hasEmployeePayments(weeks, 'emp-1')).toBe(true);
    expect(hasEmployeePayments(weeks, 'emp-2')).toBe(false);
  });

  it('sugiere cargos del personal y del historial, y permite crear uno nuevo', () => {
    const staff = [employee()];
    const weeks = [
      week([
        {
          employeeId: 'emp-9',
          employeeName: 'Histórico',
          roleTitle: 'Control de Calidad / Grados Brix',
          baseAmount: 50,
          productionBonus: 0,
          deductions: 0,
          netPaid: 50,
        },
      ]),
    ];

    expect(knownRoleTitles(staff, weeks)).toEqual([
      'Control de Calidad / Grados Brix',
      'Maestro Pailero y Cocción',
    ]);
    expect(roleSuggestions(staff, weeks, 'calidad')).toEqual([
      'Control de Calidad / Grados Brix',
    ]);
    expect(roleSuggestions(staff, weeks, 'Coccion')).toEqual(['Maestro Pailero y Cocción']);
    expect(roleSuggestions(staff, weeks, 'Nuevo cargo')).toEqual([]);
  });
});
