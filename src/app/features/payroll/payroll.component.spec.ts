import {TestBed} from '@angular/core/testing';
import {signal} from '@angular/core';
import {describe, expect, it, vi} from 'vitest';
import {Employee, PayrollWeek} from '../../core/models/erp.models';
import {ErpApiService} from '../../core/services/erp-api.service';
import {PayrollComponent} from './payroll';

const employee: Employee = {
  id: 'emp-1',
  fullName: 'José Gregorio Escalona',
  nationalId: 'V-16.782.901',
  roleTitle: 'Maestro Pailero y Cocción',
  weeklyBaseSalary: 75,
  hourlyRate: 1.88,
  status: 'activo',
};

const week: PayrollWeek = {
  id: 'pw-1',
  weekNumber: 40,
  year: 2026,
  startDate: '2026-10-05',
  endDate: '2026-10-11',
  isActiveProduction: true,
  payments: [
    {
      employeeId: employee.id,
      employeeName: employee.fullName,
      roleTitle: employee.roleTitle,
      baseAmount: 75,
      productionBonus: 15,
      deductions: 2,
      netPaid: 88,
    },
    {
      employeeId: 'emp-9',
      employeeName: 'Operario histórico',
      roleTitle: 'Control de Calidad / Grados Brix',
      baseAmount: 60,
      productionBonus: 0,
      deductions: 0,
      netPaid: 60,
    },
  ],
  totalPayrollPaid: 148,
  fixedAbsorptionCost: 0,
};

describe('PayrollComponent — historial y autocomplete', () => {
  const employees = signal<Employee[]>([employee]);
  const weeks = signal<PayrollWeek[]>([week]);

  const apiStub = {
    employees: () => employees(),
    payrollWeeks: () => weeks(),
    currentRole: () => 'admin',
    exchangeRates: () => ({currentUsd: 50}),
    showToast: vi.fn(),
    addPayrollWeek: vi.fn().mockResolvedValue({}),
    addEmployee: vi.fn().mockResolvedValue(employee),
    setEmployeeStatus: vi.fn().mockResolvedValue(employee),
    deleteEmployee: vi.fn().mockResolvedValue(undefined),
  };

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [PayrollComponent],
      providers: [{provide: ErpApiService, useValue: apiStub}],
    }).compileComponents();

    const fixture = TestBed.createComponent(PayrollComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('abre y cierra el historial de pagos del operario', async () => {
    const fixture = await setup();
    const component = fixture.componentInstance;

    component.openEmployeeHistory(employee);
    fixture.detectChanges();
    let text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain(`Historial de pagos · ${employee.fullName}`);
    expect(text).toContain('#40 / 2026');
    expect(text).toContain('2026-10-05');
    expect(text).toContain('Maestro Pailero y Cocción');
    expect(text).toContain('$ 88,00');
    expect(component.selectedEmployeeTotals().count).toBe(1);

    component.closeEmployeeHistory();
    fixture.detectChanges();
    text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).not.toContain(`Historial de pagos · ${employee.fullName}`);
  });

  it('sugiere cargos existentes e históricos y permite crear uno nuevo', async () => {
    const fixture = await setup();
    const component = fixture.componentInstance;
    component.openNewEmployeeModal();
    fixture.detectChanges();

    component.onRoleInput('calidad');
    fixture.detectChanges();
    expect(component.roleSuggestions()).toContain('Control de Calidad / Grados Brix');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Control de Calidad / Grados Brix'
    );

    component.applyRoleSuggestion('Control de Calidad / Grados Brix');
    expect(component.newEmployeeForm.controls.roleTitle.value).toBe(
      'Control de Calidad / Grados Brix'
    );
    expect(component.roleQuery()).toBe('Control de Calidad / Grados Brix');

    component.onRoleInput('Cargo Inexistente');
    fixture.detectChanges();
    expect(component.canCreateRole()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Usar «Cargo Inexistente» como cargo nuevo'
    );

    component.useNewRole();
    expect(component.newEmployeeForm.controls.roleTitle.value).toBe('Cargo Inexistente');
  });

  it('marca vacaciones, excluye al operario de nuevas semanas y ofrece exportar el historial', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onVacation: Employee = {...employee, id: 'emp-2', status: 'vacaciones'};
    employees.set([employee, onVacation]);

    try {
      const fixture = await setup();
      const component = fixture.componentInstance;
      fixture.detectChanges();
      const text = (fixture.nativeElement as HTMLElement).textContent || '';

      expect(text).toContain('Vacaciones');
      expect(component.statusFilters).toContain('vacaciones');
      expect(component.activeEmployees().map((item) => item.id)).toEqual(['emp-1']);
      component.setEmployeeStatusFilter('vacaciones');
      expect(component.filteredEmployees()).toEqual([onVacation]);
      component.setEmployeeStatusFilter('todos');

      await component.vacationEmployee(employee);
      expect(apiStub.setEmployeeStatus).toHaveBeenCalledWith('emp-1', 'vacaciones');

      component.openEmployeeHistory(employee);
      fixture.detectChanges();
      const modal = (fixture.nativeElement as HTMLElement).textContent || '';
      expect(modal).toContain('CSV');
      expect(modal).toContain('Excel');
      expect(modal).toContain('PDF');
    } finally {
      confirmSpy.mockRestore();
      employees.set([employee]);
      apiStub.setEmployeeStatus.mockClear();
    }
  });
});
