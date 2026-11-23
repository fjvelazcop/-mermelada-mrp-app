import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ModuleHelpComponent} from '../../shared/components/module-help/module-help';
import {ErpApiService} from '../../core/services/erp-api.service';
import {Employee} from '../../core/models/erp.models';
import {VeCurrencyPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';
import {
  EmployeeStatusFilter,
  employeePaymentHistory,
  employeePaymentTotals,
  filterEmployees,
  isActiveForPayroll,
  knownRoleTitles,
  roleSuggestions,
} from './payroll.filters';

@Component({
  selector: 'app-payroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, ReactiveFormsModule, VeCurrencyPipe, ModuleHelpComponent],
  templateUrl: './payroll.html',
})
export class PayrollComponent {
  public api = inject(ErpApiService);

  public currencyMode = signal<'USD' | 'Bs'>('USD');
  public isNewWeekModalOpen = signal<boolean>(false);
  public isNewEmployeeModalOpen = signal<boolean>(false);

  public newEmployeeForm = new FormGroup({
    fullName: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    nationalId: new FormControl<string>('V-', {nonNullable: true, validators: [Validators.required]}),
    roleTitle: new FormControl<string>('Operario de Marmitas', {nonNullable: true, validators: [Validators.required]}),
    weeklyBaseSalary: new FormControl<number>(65.0, {nonNullable: true, validators: [Validators.required, Validators.min(10)]}),
  });

  public newWeekForm = new FormGroup({
    weekNumber: new FormControl<number>(41, {nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(52)]}),
    startDate: new FormControl<string>('2026-10-05', {nonNullable: true, validators: [Validators.required]}),
    endDate: new FormControl<string>('2026-10-11', {nonNullable: true, validators: [Validators.required]}),
    isActiveProduction: new FormControl<boolean>(true, {nonNullable: true}),
    inactivityReason: new FormControl<any>('mantenimiento_preventivo', {nonNullable: true}),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  /** Bonus per position, keyed by the employee's `roleTitle`. */
  public roleBonusEntries = signal<{roleTitle: string; bonus: number}[]>([]);

  public readonly statusFilters: EmployeeStatusFilter[] = [
    'todos',
    'activo',
    'vacaciones',
    'inactivo',
  ];

  public employees = computed(() => this.api.employees());
  public payrollWeeks = computed(() => this.api.payrollWeeks());

  public employeeSearch = signal<string>('');
  public employeeStatusFilter = signal<EmployeeStatusFilter>('todos');
  public filteredEmployees = computed(() =>
    filterEmployees(this.employees(), this.employeeSearch(), this.employeeStatusFilter())
  );
  /** Pagos reales (neto > 0) usados para decidir si el operario puede eliminarse. */
  public paidEmployeeIds = computed(
    () =>
      new Set(
        this.payrollWeeks().flatMap((week) =>
          week.payments.filter((payment) => payment.netPaid > 0).map((payment) => payment.employeeId)
        )
      )
  );

  public selectedEmployeeId = signal<string | null>(null);
  public selectedEmployee = computed(
    () => this.employees().find((employee) => employee.id === this.selectedEmployeeId()) || null
  );
  public selectedEmployeePayments = computed(() =>
    employeePaymentHistory(this.payrollWeeks(), this.selectedEmployeeId() || '')
  );
  public selectedEmployeeTotals = computed(() =>
    employeePaymentTotals(this.selectedEmployeePayments())
  );

  public roleQuery = signal<string>('');
  public knownRoles = computed(() => knownRoleTitles(this.employees(), this.payrollWeeks()));
  public roleSuggestions = computed(() =>
    roleSuggestions(this.employees(), this.payrollWeeks(), this.roleQuery())
  );
  public roleExactMatch = computed(() => {
    const query = this.roleQuery().trim().toLowerCase();
    return this.knownRoles().some((role) => role.toLowerCase() === query);
  });
  public canCreateRole = computed(
    () => this.roleQuery().trim().length >= 2 && !this.roleExactMatch()
  );

  /** Solo los operarios activos entran en una nueva semana de nómina. */
  public activeEmployees = computed(() => this.employees().filter(isActiveForPayroll));

  public existingRoles = computed(() =>
    Array.from(new Set(this.employees().map((employee) => employee.roleTitle)))
  );

  public inactiveWeeks = computed(() => {
    return this.payrollWeeks().filter(w => !w.isActiveProduction);
  });

  public totalInactiveCostYTD = computed(() => {
    return this.inactiveWeeks().reduce((acc, w) => acc + w.fixedAbsorptionCost, 0);
  });

  public updateRoleBonus(roleTitle: string, value: string | number) {
    const bonus = Number(value);
    this.roleBonusEntries.update((entries) =>
      entries.map((entry) =>
        entry.roleTitle === roleTitle
          ? {...entry, bonus: Number.isFinite(bonus) ? bonus : 0}
          : entry
      )
    );
  }

  public weekBonusEntries(week: {bonusByRole?: Record<string, number>}) {
    return Object.entries(week.bonusByRole || {}).sort(([a], [b]) =>
      a.localeCompare(b)
    );
  }

  private resetRoleBonuses(defaultBonus = 12) {
    this.roleBonusEntries.set(
      this.existingRoles().map((roleTitle) => ({roleTitle, bonus: defaultBonus}))
    );
  }

  public openNewWeekModal() {
    const nextWeekNum = (this.payrollWeeks()[0]?.weekNumber || 40) + 1;
    this.newWeekForm.patchValue({
      weekNumber: nextWeekNum,
      isActiveProduction: true,
      inactivityReason: 'mantenimiento_preventivo',
      notes: '',
    });
    this.resetRoleBonuses(12);
    this.isNewWeekModalOpen.set(true);
  }

  public closeNewWeekModal() {
    this.isNewWeekModalOpen.set(false);
  }

  public async submitPayrollWeek() {
    if (this.newWeekForm.invalid) return;
    const v = this.newWeekForm.getRawValue();
    const staff = this.activeEmployees();

    const isProd = Boolean(v.isActiveProduction);
    const bonusByRole: Record<string, number> = {};
    for (const entry of this.roleBonusEntries()) {
      bonusByRole[entry.roleTitle] = isProd ? Number(entry.bonus) || 0 : 0;
    }

    let totalPaid = 0;
    const payments = staff.map(emp => {
      const base = emp.weeklyBaseSalary;
      const bonus = isProd ? Number(bonusByRole[emp.roleTitle] || 0) : 0;
      const net = base + bonus - 1.50; // minor deduction
      totalPaid += net;
      return {
        employeeId: emp.id,
        employeeName: emp.fullName,
        roleTitle: emp.roleTitle,
        baseAmount: base,
        productionBonus: bonus,
        deductions: 1.50,
        netPaid: Number(net.toFixed(2)),
      };
    });

    const fixedAbsorption = !isProd ? Number(totalPaid.toFixed(2)) : 0;

    await this.api.addPayrollWeek({
      weekNumber: Number(v.weekNumber),
      year: 2026,
      startDate: v.startDate,
      endDate: v.endDate,
      isActiveProduction: isProd,
      inactivityReason: !isProd ? v.inactivityReason : undefined,
      payments,
      totalPayrollPaid: Number(totalPaid.toFixed(2)),
      fixedAbsorptionCost: fixedAbsorption,
      bonusByRole: isProd ? bonusByRole : undefined,
      notes: v.notes || (!isProd ? 'Semana sin cocción en marmitas.' : 'Semana de producción activa.'),
    });

    this.closeNewWeekModal();
  }

  public openNewEmployeeModal() {
    this.newEmployeeForm.reset({
      fullName: '',
      nationalId: 'V-',
      roleTitle: 'Operario de Envasado',
      weeklyBaseSalary: 60.0,
    });
    this.roleQuery.set('');
    this.isNewEmployeeModalOpen.set(true);
  }

  public closeNewEmployeeModal() {
    this.isNewEmployeeModalOpen.set(false);
  }

  public async submitNewEmployee() {
    if (this.newEmployeeForm.invalid) return;
    const v = this.newEmployeeForm.getRawValue();
    await this.api.addEmployee({
      fullName: v.fullName,
      nationalId: v.nationalId,
      roleTitle: v.roleTitle,
      weeklyBaseSalary: Number(v.weeklyBaseSalary),
      hourlyRate: Number((Number(v.weeklyBaseSalary) / 40).toFixed(2)),
      status: 'activo',
    });
    this.closeNewEmployeeModal();
  }

  // --- BÚSQUEDA, BAJA E HISTORIAL DEL PERSONAL ---

  public onEmployeeSearchInput(value: string): void {
    this.employeeSearch.set(value);
  }

  public setEmployeeStatusFilter(filter: EmployeeStatusFilter): void {
    this.employeeStatusFilter.set(filter);
  }

  public statusFilterLabel(filter: EmployeeStatusFilter): string {
    if (filter === 'todos') return 'Todos';
    if (filter === 'activo') return 'Activos';
    if (filter === 'vacaciones') return 'Vacaciones';
    return 'Inactivos';
  }

  /** true cuando el operario tiene pagos y solo puede darse de baja. */
  public hasPayments(employeeId: string): boolean {
    return this.paidEmployeeIds().has(employeeId);
  }

  public paymentCount(employeeId: string): number {
    return employeePaymentHistory(this.payrollWeeks(), employeeId).length;
  }

  public onRoleInput(value: string): void {
    this.roleQuery.set(value);
  }

  public applyRoleSuggestion(role: string): void {
    this.roleQuery.set(role);
    this.newEmployeeForm.controls.roleTitle.setValue(role);
  }

  /** Acepta un cargo nuevo escrito por el usuario y lo deja listo para guardar. */
  public useNewRole(): void {
    const role = this.roleQuery().trim();
    if (role.length < 2) return;
    this.applyRoleSuggestion(role);
  }

  public openEmployeeHistory(employee: Employee): void {
    this.selectedEmployeeId.set(employee.id);
  }

  public get historyCurrency(): 'Bs.' | '$' {
    return this.currencyMode() === 'Bs' ? 'Bs.' : '$';
  }

  public historyAmount(value: number): number {
    if (this.currencyMode() !== 'Bs') return value;
    return Number((value * (this.api.exchangeRates()?.currentUsd || 48.35)).toFixed(2));
  }

  public closeEmployeeHistory(): void {
    this.selectedEmployeeId.set(null);
  }

  /** Exporta el historial del operario abierto en el modal, en la moneda activa. */
  public exportEmployeeHistory(format: 'csv' | 'excel' | 'pdf'): void {
    const employee = this.selectedEmployee();
    if (!employee) return;
    const currency = this.historyCurrency;
    const headers = [
      'Semana',
      'Año',
      'Desde',
      'Hasta',
      'Cargo pagado',
      `Base (${currency})`,
      `Bono (${currency})`,
      `Deducciones (${currency})`,
      `Neto (${currency})`,
    ];
    const rows = this.selectedEmployeePayments().map((row) => [
      `#${row.weekNumber}`,
      row.year,
      row.startDate,
      row.endDate,
      row.roleTitle,
      this.historyAmount(row.baseAmount),
      this.historyAmount(row.productionBonus),
      this.historyAmount(row.deductions),
      this.historyAmount(row.netPaid),
    ]);
    const totals = this.selectedEmployeeTotals();
    const line = [
      'Totales',
      '',
      '',
      '',
      `${totals.count} pago(s)`,
      this.historyAmount(totals.baseAmount),
      this.historyAmount(totals.productionBonus),
      this.historyAmount(totals.deductions),
      this.historyAmount(totals.netPaid),
    ];
    const base = `historial_pagos_${employee.nationalId.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const date = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      exportToCsv(
        `${base}_${date}.csv`,
        headers,
        [
          ...rows.map((row) =>
            row.map((cell) => (typeof cell === 'number' ? formatVeNumber(cell, 2) : cell))
          ),
          line.map((cell) => (typeof cell === 'number' ? formatVeNumber(cell, 2) : cell)),
        ]
      );
      return;
    }
    if (format === 'excel') {
      exportToExcel(
        `${base}_${date}.xls`,
        'Historial de Pagos',
        headers,
        [...rows, line],
        {
          empresa: `Historial de pagos · ${employee.fullName}`,
          rif: employee.nationalId,
          fecha: date,
          moneda: currency,
          consolidado: `${totals.count} pago(s) registrados`,
        }
      );
      return;
    }
    void exportToPdf({
      title: `Historial de pagos · ${employee.fullName}`,
      subtitle: `${employee.nationalId} · ${employee.roleTitle}`,
      headers,
      rows: [...rows, line],
      totals: [
        {label: 'Pagos', value: String(totals.count)},
        {label: `Total neto (${currency})`, value: formatVeNumber(this.historyAmount(totals.netPaid), 2)},
      ],
      notes: 'Historial acumulado de las semanas registradas; no altera los totales de la nómina.',
    });
  }

  public async deactivateEmployee(employee: Employee): Promise<void> {
    if (!window.confirm(
      `¿Dar de baja a ${employee.fullName}?\n\nDejará de incluirse en nuevas semanas de nómina; su historial de pagos se conserva.`
    )) return;
    try {
      await this.api.setEmployeeStatus(employee.id, 'inactivo');
    } catch {
      return;
    }
  }

  public async reactivateEmployee(employee: Employee): Promise<void> {
    if (!window.confirm(`¿Reactivar a ${employee.fullName} para nuevas semanas de nómina?`)) return;
    try {
      await this.api.setEmployeeStatus(employee.id, 'activo');
    } catch {
      return;
    }
  }

  public async vacationEmployee(employee: Employee): Promise<void> {
    if (!window.confirm(
      `¿Marcar de vacaciones a ${employee.fullName}?\n\nDejará de incluirse en nuevas semanas hasta que se reactive; su historial de pagos se conserva.`
    )) return;
    try {
      await this.api.setEmployeeStatus(employee.id, 'vacaciones');
    } catch {
      return;
    }
  }

  public async removeEmployee(employee: Employee): Promise<void> {
    if (this.hasPayments(employee.id)) {
      this.api.showToast(
        `${employee.fullName} ya tiene pagos registrados; debe darse de baja para conservar la trazabilidad.`,
        'error'
      );
      return;
    }
    if (!window.confirm(
      `¿Eliminar a ${employee.fullName}?\n\nSolo es posible porque no tiene pagos registrados. Esta acción queda auditada.`
    )) return;
    try {
      await this.api.deleteEmployee(employee.id);
      if (this.selectedEmployeeId() === employee.id) this.closeEmployeeHistory();
    } catch {
      return;
    }
  }

  // --- EXPORT FUNCTIONALITY: PAYROLL & INACTIVE WEEKS ---

  public exportPayrollCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Semana Nro.',
      'Rango Fechas',
      'Estado Operativo',
      'Motivo Inactividad',
      'Tasa del Día (Bs./USD)',
      `Total Pagado Nómina (${isBs ? 'Bs.' : 'USD'})`,
      `Costo Fijo No Absorbido (${isBs ? 'Bs.' : 'USD'})`,
      'Observaciones',
    ];

    const rows = this.payrollWeeks().map(w => {
      const mult = isBs ? rate : 1;
      return [
        `Semana #${w.weekNumber}`,
        `${w.startDate} al ${w.endDate}`,
        w.isActiveProduction ? 'Producción Activa' : 'Semana Inactiva',
        w.inactivityReason || 'N/A',
        formatVeNumber(rate, 2),
        formatVeNumber(w.totalPayrollPaid * mult, 2),
        formatVeNumber(w.fixedAbsorptionCost * mult, 2),
        w.notes || '',
      ];
    });

    exportToCsv(`nomina_semanal_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  public exportPayrollExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Semana Nro.',
      'Rango Fechas',
      'Estado Operativo',
      'Motivo Inactividad',
      'Tasa del Día (Bs./USD)',
      `Total Pagado Nómina (${isBs ? 'Bs.' : 'USD'})`,
      `Costo Fijo No Absorbido (${isBs ? 'Bs.' : 'USD'})`,
      'Observaciones',
    ];

    const rows = this.payrollWeeks().map(w => {
      const mult = isBs ? rate : 1;
      return [
        `Semana #${w.weekNumber}`,
        `${w.startDate} al ${w.endDate}`,
        w.isActiveProduction ? 'Producción Activa' : 'Semana Inactiva',
        w.inactivityReason || 'N/A',
        rate,
        Number((w.totalPayrollPaid * mult).toFixed(2)),
        Number((w.fixedAbsorptionCost * mult).toFixed(2)),
        w.notes || '',
      ];
    });

    exportToExcel(`nomina_semanal_${new Date().toISOString().slice(0, 10)}.xls`, 'Nómina Semanal', headers, rows);
  }

  public exportPayrollPdf() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Semana',
      'Periodo',
      'Estado',
      'Tasa',
      `Nómina (${isBs ? 'Bs.' : '$'})`,
      `Costo Inactivo (${isBs ? 'Bs.' : '$'})`,
    ];

    const mult = isBs ? rate : 1;
    const rows = this.payrollWeeks().map(w => [
      `#${w.weekNumber}`,
      `${w.startDate} a ${w.endDate}`,
      w.isActiveProduction ? 'Activa' : 'Inactiva',
      `Bs. ${formatVeNumber(rate, 2)}`,
      formatVeNumber(w.totalPayrollPaid * mult, 2),
      formatVeNumber(w.fixedAbsorptionCost * mult, 2),
    ]);

    void exportToPdf(
      'Control de Nómina Semanal y Análisis de Semanas Inactivas',
      `Moneda: ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'} | Tasa de referencia: Bs. ${formatVeNumber(rate, 2)}`,
      headers,
      rows
    );
  }
}
