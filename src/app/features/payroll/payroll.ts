import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {VeCurrencyPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';

@Component({
  selector: 'app-payroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, ReactiveFormsModule, VeCurrencyPipe],
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

  public employees = computed(() => this.api.employees());
  public payrollWeeks = computed(() => this.api.payrollWeeks());

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
    const staff = this.employees();

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

    exportToPdf(
      'Control de Nómina Semanal y Análisis de Semanas Inactivas',
      `Moneda: ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'} | Tasa de referencia: Bs. ${formatVeNumber(rate, 2)}`,
      headers,
      rows
    );
  }
}
