import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';

@Component({
  selector: 'app-payroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, ReactiveFormsModule],
  templateUrl: './payroll.html',
})
export class PayrollComponent {
  public api = inject(ErpApiService);

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
    bonusPerEmployee: new FormControl<number>(10, {nonNullable: true}),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  public employees = computed(() => this.api.employees());
  public payrollWeeks = computed(() => this.api.payrollWeeks());

  public inactiveWeeks = computed(() => {
    return this.payrollWeeks().filter(w => !w.isActiveProduction);
  });

  public totalInactiveCostYTD = computed(() => {
    return this.inactiveWeeks().reduce((acc, w) => acc + w.fixedAbsorptionCost, 0);
  });

  public openNewWeekModal() {
    const nextWeekNum = (this.payrollWeeks()[0]?.weekNumber || 40) + 1;
    this.newWeekForm.patchValue({
      weekNumber: nextWeekNum,
      isActiveProduction: true,
      inactivityReason: 'mantenimiento_preventivo',
      bonusPerEmployee: 12,
      notes: '',
    });
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
    const bonus = isProd ? Number(v.bonusPerEmployee || 0) : 0;

    let totalPaid = 0;
    const payments = staff.map(emp => {
      const base = emp.weeklyBaseSalary;
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
}
