import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {VeCurrencyPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, downloadDetailedCostEstimationPdf} from '../../core/utils/export.utils';
import {
  RawMaterialCostItem,
  PackagingCostItem,
  SampleCostItem,
  FixedExpenseItem,
  WorkerPayrollItem,
} from '../../core/models/erp.models';

export type CostingMobileTab =
  | 'summary'
  | 'materials'
  | 'packaging'
  | 'fixed_labor'
  | 'mto_simulator';

@Component({
  selector: 'app-costing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, ReactiveFormsModule, VeCurrencyPipe],
  templateUrl: './costing.html',
})
export class CostingComponent {
  public api = inject(ErpApiService);

  public currencyMode = signal<'USD' | 'Bs'>('USD');
  public activeTab = signal<CostingMobileTab>('summary');

  // Base parameters from Excel Image 2
  public productionKilosBase = signal<number>(1320); // Rendimiento de tanda estándar (1320 kg)
  public workDaysPerMonth = signal<number>(24); // 24 días laborables al mes
  public customMarginPercent = signal<number>(35); // Margen personalizado %
  public rate = computed(() => this.api.exchangeRates()?.currentUsd || 48.35);

  // 1. Envases y etiquetas 20k (Potes 20kg + Etiquetas)
  public packaging20k = signal<PackagingCostItem[]>([
    { id: 'pkg-1', presentation: 'Potes 20kg', unitCost: 5.28 },
    { id: 'pkg-2', presentation: 'Etiquetas', quantity: 500, totalAmount: 247.50, unitCost: 0.62 },
  ]);

  // 2. Caja 20kg (Caja, Tirro, Bolsa, Tirraje)
  public packagingCaja20k = signal<PackagingCostItem[]>([
    { id: 'box-1', presentation: 'CAJA', unitCost: 2.28 },
    { id: 'box-2', presentation: 'TIRRO', unitCost: 0.17 },
    { id: 'box-3', presentation: 'BOLSA', unitCost: 0.85 },
    { id: 'box-4', presentation: 'TIRRAJE', unitCost: 0.07 },
  ]);

  // Galón 5kg
  public packagingGalon = signal<PackagingCostItem[]>([
    { id: 'gal-1', presentation: 'Envase Galón 5kg + Etiqueta', unitCost: 2.61 },
  ]);

  // Balde 15kg
  public packagingBalde15k = signal<PackagingCostItem[]>([
    { id: 'bld-1', presentation: 'Balde Industrial 15kg (Cuñete HDPE) + Asa', unitCost: 3.80 },
    { id: 'bld-2', presentation: 'Etiqueta Adhesiva Industrial 15kg', unitCost: 0.25 },
  ]);

  // 3. Muestras
  public samples = signal<SampleCostItem[]>([
    { id: 'smp-1', description: 'Muestra 250cc', bulkCost: 69.60, unitCost: 0.28 },
    { id: 'smp-2', description: 'Muestra 3kg guayaba', unitCost: 2.78 },
  ]);

  // 4. Materia Prima 20kg (Guayaba, Azúcar, Almidón, Químicos, Gasoil)
  public rawMaterials = signal<RawMaterialCostItem[]>([
    {
      id: 'rm-1',
      description: 'Guayaba (cesta)',
      costBcv: 14.00,
      presentation: 28.29,
      presentationUnit: 'cesta (~28.29 kg)',
      unitCost: 0.49486,
      costPerGram: 0.000495,
      cantProduction: 905.3,
      costPerProduction: 448.00,
    },
    {
      id: 'rm-2',
      description: 'Azúcar (saco)',
      costBcv: 58.00,
      presentation: 50.00,
      presentationUnit: 'saco (50 kg)',
      unitCost: 1.16,
      costPerGram: 0.00116,
      cantProduction: 750.0,
      costPerProduction: 870.00,
    },
    {
      id: 'rm-3',
      description: 'Químico 1 Almidón (kg)',
      costBcv: 38.00,
      presentation: 25.00,
      presentationUnit: 'saco (25 kg)',
      unitCost: 1.52,
      costPerGram: 0.00152,
      cantProduction: 75.0,
      costPerProduction: 114.00,
    },
    {
      id: 'rm-4',
      description: 'Químico 2 (gr)',
      costBcv: 105.00,
      presentation: 25.00,
      presentationUnit: 'saco (25 kg)',
      unitCost: 4.20,
      costPerGram: 0.00420,
      cantProduction: 0.750,
      costPerProduction: 3.15,
    },
    {
      id: 'rm-5',
      description: 'Químico 3 ácido (gr)',
      costBcv: 59.60,
      presentation: 25.00,
      presentationUnit: 'saco (25 kg)',
      unitCost: 2.3840,
      costPerGram: 0.00238,
      cantProduction: 0.750,
      costPerProduction: 1.79,
    },
    {
      id: 'rm-6',
      description: 'Gasoil',
      costBcv: 1.00,
      presentation: 1.00,
      presentationUnit: 'litro',
      unitCost: 1.00,
      costPerGram: 0.001,
      cantProduction: 90.0,
      costPerProduction: 90.00,
    },
  ]);

  // 5. Nómina de Trabajadores (Desglose individual de los 10 trabajadores de la Imagen 2)
  public workers = signal<WorkerPayrollItem[]>([
    { id: 'w-1', name: 'Hermes', weeklySalary: 100.00, role: 'Maestro de Marmitas' },
    { id: 'w-2', name: 'Denis', weeklySalary: 93.35, role: 'Operador de Pailas' },
    { id: 'w-3', name: 'Daniela', weeklySalary: 100.00, role: 'Control de Calidad / Grados Brix' },
    { id: 'w-4', name: 'JEREMY', weeklySalary: 93.35, role: 'Pesaje y Dosificación' },
    { id: 'w-5', name: 'JACOB', weeklySalary: 93.35, role: 'Llenado y Envasado' },
    { id: 'w-6', name: 'VIGILANTE (Turno 1)', weeklySalary: 60.00, role: 'Seguridad de Planta' },
    { id: 'w-7', name: 'VIGILANTE (Turno 2)', weeklySalary: 60.00, role: 'Seguridad de Planta' },
    { id: 'w-8', name: 'Jose Alberto', weeklySalary: 93.35, role: 'Auxiliar de Marmitas' },
    { id: 'w-9', name: 'Luis', weeklySalary: 110.00, role: 'Jefe de Planta / Mantenimiento' },
    { id: 'w-10', name: 'Xavi', weeklySalary: 100.00, role: 'Logística y Despacho' },
  ]);

  // Nómina computada
  public totalWeeklyPayroll = computed(() => {
    return this.workers().reduce((acc, w) => acc + (Number(w.weeklySalary) || 0), 0);
  });

  public totalMonthlyPayroll = computed(() => {
    // 4 semanas promedio mensual como en la hoja de Excel ($903.40 * 4 = $3,613.60)
    return Number((this.totalWeeklyPayroll() * 4).toFixed(2));
  });

  // 6. Gastos Fijos (Agua, Servicios, Instagram, Trabajadores, Alquiler)
  public fixedExpenses = signal<Omit<FixedExpenseItem, 'dailyAmount' | 'costPerKg'>[]>([
    { id: 'fe-1', concept: 'Agua potable', monthlyAmount: 48.00, workDays: 24 },
    { id: 'fe-2', concept: 'Servicios (Luz, Gas, Conectividad)', monthlyAmount: 50.00, workDays: 24 },
    { id: 'fe-3', concept: 'Instagram / Publicidad Digital', monthlyAmount: 300.00, workDays: 24 },
    { id: 'fe-4', concept: 'Alquiler de Galpón / Planta', monthlyAmount: 1550.00, workDays: 24 },
  ]);

  // Lista consolidada de gastos fijos incluyendo nómina
  public computedFixedExpenseRows = computed<FixedExpenseItem[]>(() => {
    const days = this.workDaysPerMonth() || 24;
    const baseKg = this.productionKilosBase() || 1320;
    const rows: FixedExpenseItem[] = [];

    // Gastos manuales
    for (const fe of this.fixedExpenses()) {
      const daily = Number((fe.monthlyAmount / days).toFixed(2));
      const perKg = Number((daily / baseKg).toFixed(4));
      rows.push({
        ...fe,
        workDays: days,
        dailyAmount: daily,
        costPerKg: perKg,
      });
    }

    // Gasto de personal (calculado directamente de la nómina de trabajadores)
    const payrollMonthly = this.totalMonthlyPayroll();
    const payrollDaily = Number((payrollMonthly / days).toFixed(2));
    const payrollPerKg = Number((payrollDaily / baseKg).toFixed(4));

    rows.splice(3, 0, {
      id: 'fe-payroll',
      concept: 'Trabajador (Nómina 10 empleados)',
      monthlyAmount: payrollMonthly,
      workDays: days,
      dailyAmount: payrollDaily,
      costPerKg: payrollPerKg,
    });

    return rows;
  });

  public totalFixedMonthly = computed(() => {
    return this.computedFixedExpenseRows().reduce((acc, r) => acc + r.monthlyAmount, 0);
  });

  public totalFixedDaily = computed(() => {
    return this.computedFixedExpenseRows().reduce((acc, r) => acc + r.dailyAmount, 0);
  });

  public totalFixedPerKg = computed(() => {
    return this.computedFixedExpenseRows().reduce((acc, r) => acc + r.costPerKg, 0);
  });

  // Totales de Empaques
  public totalPackaging20k = computed(() => {
    return Number(this.packaging20k().reduce((acc, p) => acc + (Number(p.unitCost) || 0), 0).toFixed(2));
  });

  public totalPackagingCaja20k = computed(() => {
    return Number(this.packagingCaja20k().reduce((acc, p) => acc + (Number(p.unitCost) || 0), 0).toFixed(2));
  });

  public totalPackagingGalon = computed(() => {
    return Number(this.packagingGalon().reduce((acc, p) => acc + (Number(p.unitCost) || 0), 0).toFixed(2));
  });

  public totalPackagingBalde15k = computed(() => {
    return Number(this.packagingBalde15k().reduce((acc, p) => acc + (Number(p.unitCost) || 0), 0).toFixed(2));
  });

  // Totales de Materia Prima
  public totalRawMaterialsCost = computed(() => {
    return Number(this.rawMaterials().reduce((acc, rm) => acc + (Number(rm.costPerProduction) || 0), 0).toFixed(2));
  });

  public rawMaterialCostPerKg = computed(() => {
    const baseKg = this.productionKilosBase() || 1320;
    return Number((this.totalRawMaterialsCost() / baseKg).toFixed(4));
  });

  public rawMaterialCost20kg = computed(() => {
    return Number((this.rawMaterialCostPerKg() * 20).toFixed(2));
  });

  public rawMaterialCost15kg = computed(() => {
    return Number((this.rawMaterialCostPerKg() * 15).toFixed(2));
  });

  public rawMaterialCost5kg = computed(() => {
    return Number((this.rawMaterialCostPerKg() * 5).toFixed(2));
  });

  // Costo Fijo por Presentación
  public fixedCost20kg = computed(() => {
    return Number((this.totalFixedPerKg() * 20).toFixed(2));
  });

  public fixedCost15kg = computed(() => {
    return Number((this.totalFixedPerKg() * 15).toFixed(2));
  });

  public fixedCost5kg = computed(() => {
    return Number((this.totalFixedPerKg() * 5).toFixed(2));
  });

  // Costo Unitario por 1KG base (MP + GF sin envase)
  public costPer1kg = computed(() => {
    return Number((this.rawMaterialCostPerKg() + this.totalFixedPerKg()).toFixed(2));
  });

  // Costo 20kg sin envase
  public cost20kgWithoutPackaging = computed(() => {
    return Number((this.rawMaterialCost20kg() + this.fixedCost20kg()).toFixed(2));
  });

  // Costo 15kg sin envase
  public cost15kgWithoutPackaging = computed(() => {
    return Number((this.rawMaterialCost15kg() + this.fixedCost15kg()).toFixed(2));
  });

  // Costo 5kg sin envase
  public cost5kgWithoutPackaging = computed(() => {
    return Number((this.rawMaterialCost5kg() + this.fixedCost5kg()).toFixed(2));
  });

  // --- 7. ESTRUCTURA DE COSTOS FINAL: CUÑETE 20KG ---
  public cuneteFinalCost = computed(() => {
    return Number((this.cost20kgWithoutPackaging() + this.totalPackaging20k()).toFixed(2));
  });

  public cunetePrices = computed(() => {
    const cost = this.cuneteFinalCost();
    const customM = this.customMarginPercent() || 35;
    return {
      margin30: Number((cost / (1 - 0.30)).toFixed(2)),
      margin25: Number((cost / (1 - 0.25)).toFixed(2)),
      margin20: Number((cost / (1 - 0.20)).toFixed(2)),
      custom: Number((cost / (1 - customM / 100)).toFixed(2)),
    };
  });

  // --- 8. ESTRUCTURA DE COSTOS FINAL: CAJA 20KG ---
  public cajaFinalCost = computed(() => {
    return Number((this.cost20kgWithoutPackaging() + this.totalPackagingCaja20k()).toFixed(2));
  });

  public cajaPrices = computed(() => {
    const cost = this.cajaFinalCost();
    const customM = this.customMarginPercent() || 35;
    return {
      margin30: Number((cost / (1 - 0.30)).toFixed(2)),
      margin25: Number((cost / (1 - 0.25)).toFixed(2)),
      margin20: Number((cost / (1 - 0.20)).toFixed(2)),
      custom: Number((cost / (1 - customM / 100)).toFixed(2)),
    };
  });

  // --- 9. ESTRUCTURA DE COSTOS FINAL: GALÓN 5KG ---
  public galonFinalCost = computed(() => {
    return Number((this.cost5kgWithoutPackaging() + this.totalPackagingGalon()).toFixed(2));
  });

  public galonPrices = computed(() => {
    const cost = this.galonFinalCost();
    const customM = this.customMarginPercent() || 35;
    return {
      margin30: Number((cost / (1 - 0.30)).toFixed(2)),
      margin25: Number((cost / (1 - 0.25)).toFixed(2)),
      margin20: Number((cost / (1 - 0.20)).toFixed(2)),
      custom: Number((cost / (1 - customM / 100)).toFixed(2)),
    };
  });

  // --- 10. ESTRUCTURA DE COSTOS FINAL: BALDE 15KG ---
  public balde15kFinalCost = computed(() => {
    return Number((this.cost15kgWithoutPackaging() + this.totalPackagingBalde15k()).toFixed(2));
  });

  public balde15kPrices = computed(() => {
    const cost = this.balde15kFinalCost();
    const customM = this.customMarginPercent() || 35;
    return {
      margin30: Number((cost / (1 - 0.30)).toFixed(2)),
      margin25: Number((cost / (1 - 0.25)).toFixed(2)),
      margin20: Number((cost / (1 - 0.20)).toFixed(2)),
      custom: Number((cost / (1 - customM / 100)).toFixed(2)),
    };
  });

  // --- MTO SIMULATOR FORM ---
  public simulatorForm = new FormGroup({
    directMaterial: new FormControl<number>(0.35, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    directPackaging: new FormControl<number>(0.49, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    directLabor: new FormControl<number>(0.18, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    utilityCost: new FormControl<number>(0.09, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    inactiveWeeksCount: new FormControl<number>(3, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    targetMarginWholesale: new FormControl<number>(35, {nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(90)]}),
    targetMarginRetail: new FormControl<number>(50, {nonNullable: true, validators: [Validators.required, Validators.min(1), Validators.max(90)]}),
  });

  public simulationResult = signal<any>({
    totalUnitCost: 1.17,
    inactiveAbsorbedPerUnit: 0.06,
    suggestedWholesalePrice: 1.80,
    suggestedRetailPrice: 2.34,
    wholesaleGrossProfit: 0.63,
    retailGrossProfit: 1.17,
  });

  // --- REACTIVE UPDATERS FOR CALCULATION ---

  public updateRawMaterialField(id: string, field: 'costBcv' | 'presentation' | 'cantProduction', rawVal: string | number) {
    const val = Number(rawVal) || 0;
    this.rawMaterials.update(list =>
      list.map(item => {
        if (item.id !== id) return item;

        const updated = {...item, [field]: val};
        // Recalcular unitCost
        const pres = updated.presentation > 0 ? updated.presentation : 1;
        const unitCost = Number((updated.costBcv / pres).toFixed(5));
        const costPerGram = Number((unitCost / 1000).toFixed(6));

        // Recalcular costPerProduction
        let costProd = 0;
        if (item.id === 'rm-1') {
          // Guayaba: cestas consumidas * costo cesta
          costProd = Number(((updated.cantProduction / pres) * updated.costBcv).toFixed(2));
        } else if (item.id === 'rm-2' || item.id === 'rm-3') {
          // Azúcar o Almidón: sacos consumidos * costo saco
          costProd = Number(((updated.cantProduction / pres) * updated.costBcv).toFixed(2));
        } else if (item.id === 'rm-4' || item.id === 'rm-5') {
          // Químicos (kilos consumidos * costo por kilo)
          costProd = Number((updated.cantProduction * unitCost).toFixed(2));
        } else {
          // Gasoil: litros * costo
          costProd = Number((updated.cantProduction * unitCost).toFixed(2));
        }

        return {
          ...updated,
          unitCost,
          costPerGram,
          costPerProduction: costProd,
        };
      })
    );
  }

  public updatePackagingUnitCost(group: '20k' | 'caja' | 'galon', id: string, rawVal: string | number) {
    const val = Number(rawVal) || 0;
    if (group === '20k') {
      this.packaging20k.update(items =>
        items.map(i => (i.id === id ? {...i, unitCost: val} : i))
      );
    } else if (group === 'caja') {
      this.packagingCaja20k.update(items =>
        items.map(i => (i.id === id ? {...i, unitCost: val} : i))
      );
    } else {
      this.packagingGalon.update(items =>
        items.map(i => (i.id === id ? {...i, unitCost: val} : i))
      );
    }
  }

  public updateFixedExpenseMonthly(id: string, rawVal: string | number) {
    const val = Number(rawVal) || 0;
    this.fixedExpenses.update(items =>
      items.map(i => (i.id === id ? {...i, monthlyAmount: val} : i))
    );
  }

  public updateWorkerSalary(id: string, rawVal: string | number) {
    const val = Number(rawVal) || 0;
    this.workers.update(items =>
      items.map(w => (w.id === id ? {...w, weeklySalary: val} : w))
    );
  }

  public addWorker() {
    const id = 'w-' + (this.workers().length + 1);
    this.workers.update(w => [
      ...w,
      { id, name: `Operador ${w.length + 1}`, weeklySalary: 95.00, role: 'Operador de Planta' },
    ]);
  }

  public removeWorker(id: string) {
    this.workers.update(w => w.filter(item => item.id !== id));
  }

  // --- PRESETS ---

  public resetToImage2Preset() {
    this.productionKilosBase.set(1320);
    this.workDaysPerMonth.set(24);
    this.customMarginPercent.set(35);

    this.packaging20k.set([
      { id: 'pkg-1', presentation: 'Potes 20kg', unitCost: 5.28 },
      { id: 'pkg-2', presentation: 'Etiquetas', quantity: 500, totalAmount: 247.50, unitCost: 0.62 },
    ]);

    this.packagingCaja20k.set([
      { id: 'box-1', presentation: 'CAJA', unitCost: 2.28 },
      { id: 'box-2', presentation: 'TIRRO', unitCost: 0.17 },
      { id: 'box-3', presentation: 'BOLSA', unitCost: 0.85 },
      { id: 'box-4', presentation: 'TIRRAJE', unitCost: 0.07 },
    ]);

    this.packagingGalon.set([
      { id: 'gal-1', presentation: 'Envase Galón 5kg + Etiqueta', unitCost: 2.61 },
    ]);

    this.rawMaterials.set([
      { id: 'rm-1', description: 'Guayaba (cesta)', costBcv: 14.00, presentation: 28.29, presentationUnit: 'cesta (~28.29 kg)', unitCost: 0.49486, costPerGram: 0.000495, cantProduction: 905.3, costPerProduction: 448.00 },
      { id: 'rm-2', description: 'Azúcar (saco)', costBcv: 58.00, presentation: 50.00, presentationUnit: 'saco (50 kg)', unitCost: 1.16, costPerGram: 0.00116, cantProduction: 750.0, costPerProduction: 870.00 },
      { id: 'rm-3', description: 'Químico 1 Almidón (kg)', costBcv: 38.00, presentation: 25.00, presentationUnit: 'saco (25 kg)', unitCost: 1.52, costPerGram: 0.00152, cantProduction: 75.0, costPerProduction: 114.00 },
      { id: 'rm-4', description: 'Químico 2 (gr)', costBcv: 105.00, presentation: 25.00, presentationUnit: 'saco (25 kg)', unitCost: 4.20, costPerGram: 0.00420, cantProduction: 0.750, costPerProduction: 3.15 },
      { id: 'rm-5', description: 'Químico 3 ácido (gr)', costBcv: 59.60, presentation: 25.00, presentationUnit: 'saco (25 kg)', unitCost: 2.3840, costPerGram: 0.00238, cantProduction: 0.750, costPerProduction: 1.79 },
      { id: 'rm-6', description: 'Gasoil', costBcv: 1.00, presentation: 1.00, presentationUnit: 'litro', unitCost: 1.00, costPerGram: 0.001, cantProduction: 90.0, costPerProduction: 90.00 },
    ]);

    this.workers.set([
      { id: 'w-1', name: 'Hermes', weeklySalary: 100.00, role: 'Maestro de Marmitas' },
      { id: 'w-2', name: 'Denis', weeklySalary: 93.35, role: 'Operador de Pailas' },
      { id: 'w-3', name: 'Daniela', weeklySalary: 100.00, role: 'Control de Calidad / Grados Brix' },
      { id: 'w-4', name: 'JEREMY', weeklySalary: 93.35, role: 'Pesaje y Dosificación' },
      { id: 'w-5', name: 'JACOB', weeklySalary: 93.35, role: 'Llenado y Envasado' },
      { id: 'w-6', name: 'VIGILANTE (Turno 1)', weeklySalary: 60.00, role: 'Seguridad de Planta' },
      { id: 'w-7', name: 'VIGILANTE (Turno 2)', weeklySalary: 60.00, role: 'Seguridad de Planta' },
      { id: 'w-8', name: 'Jose Alberto', weeklySalary: 93.35, role: 'Auxiliar de Marmitas' },
      { id: 'w-9', name: 'Luis', weeklySalary: 110.00, role: 'Jefe de Planta / Mantenimiento' },
      { id: 'w-10', name: 'Xavi', weeklySalary: 100.00, role: 'Logística y Despacho' },
    ]);

    this.fixedExpenses.set([
      { id: 'fe-1', concept: 'Agua potable', monthlyAmount: 48.00, workDays: 24 },
      { id: 'fe-2', concept: 'Servicios (Luz, Gas, Conectividad)', monthlyAmount: 50.00, workDays: 24 },
      { id: 'fe-3', concept: 'Instagram / Publicidad Digital', monthlyAmount: 300.00, workDays: 24 },
      { id: 'fe-4', concept: 'Alquiler de Galpón / Planta', monthlyAmount: 1550.00, workDays: 24 },
    ]);

    this.api.showToast('Valores restablecidos exactamente como en la hoja de Excel de la Imagen 2.');
  }

  public loadLote72Preset() {
    // Foto 1: Lote 72, 6 marmitas, 2600 kg producidos (106 cuñetes + 24 cajas)
    // Guayaba: 64 cestas (1814.80 kg), Azúcar: 1500 kg (30 sacos), Almidón: 150 kg, Químico 2: 1.5kg, Ácido: 1.5kg, Gasoil: 180L
    this.productionKilosBase.set(2600);
    this.rawMaterials.set([
      { id: 'rm-1', description: 'Guayaba (cesta)', costBcv: 14.00, presentation: 28.35, presentationUnit: 'cesta', unitCost: 0.4938, costPerGram: 0.000494, cantProduction: 1814.80, costPerProduction: 896.00 }, // 64 cestas * 14
      { id: 'rm-2', description: 'Azúcar (saco)', costBcv: 58.00, presentation: 50.00, presentationUnit: 'saco (50 kg)', unitCost: 1.16, costPerGram: 0.00116, cantProduction: 1500.0, costPerProduction: 1740.00 }, // 30 sacos * 58
      { id: 'rm-3', description: 'Químico 1 Almidón (kg)', costBcv: 38.00, presentation: 25.00, presentationUnit: 'saco (25 kg)', unitCost: 1.52, costPerGram: 0.00152, cantProduction: 150.0, costPerProduction: 228.00 }, // 6 sacos * 38
      { id: 'rm-4', description: 'Químico 2 (gr)', costBcv: 105.00, presentation: 25.00, presentationUnit: 'saco (25 kg)', unitCost: 4.20, costPerGram: 0.00420, cantProduction: 1.500, costPerProduction: 6.30 },
      { id: 'rm-5', description: 'Químico 3 ácido (gr)', costBcv: 59.60, presentation: 25.00, presentationUnit: 'saco (25 kg)', unitCost: 2.3840, costPerGram: 0.00238, cantProduction: 1.500, costPerProduction: 3.58 },
      { id: 'rm-6', description: 'Gasoil', costBcv: 1.00, presentation: 1.00, presentationUnit: 'litro', unitCost: 1.00, costPerGram: 0.001, cantProduction: 180.0, costPerProduction: 180.00 },
    ]);

    this.api.showToast('Cargado Lote 72 de Marmitas: 2,600 kg totales (106 Cuñetes + 24 Cajas).');
  }

  // --- MTO SIMULATOR RUNNER ---
  public async runSimulation() {
    const v = this.simulatorForm.getRawValue();
    const inactiveAbsorbedPerUnit = (Number(v.inactiveWeeksCount) * 185) / 1000;
    const totalUnitCost = Number(v.directMaterial) + Number(v.directPackaging) + Number(v.directLabor) + Number(v.utilityCost) + inactiveAbsorbedPerUnit;
    const suggestedWholesale = totalUnitCost / (1 - Number(v.targetMarginWholesale) / 100);
    const suggestedRetail = totalUnitCost / (1 - Number(v.targetMarginRetail) / 100);

    this.simulationResult.set({
      totalUnitCost: Number(totalUnitCost.toFixed(2)),
      inactiveAbsorbedPerUnit: Number(inactiveAbsorbedPerUnit.toFixed(2)),
      suggestedWholesalePrice: Number(suggestedWholesale.toFixed(2)),
      suggestedRetailPrice: Number(suggestedRetail.toFixed(2)),
      wholesaleGrossProfit: Number((suggestedWholesale - totalUnitCost).toFixed(2)),
      retailGrossProfit: Number((suggestedRetail - totalUnitCost).toFixed(2)),
    });
  }

  // --- EXPORT TO EXCEL / CSV / PDF ---

  public exportDetailedCostExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.rate();
    const mult = isBs ? rate : 1;
    const curr = isBs ? 'Bs.' : '$';

    const headers = ['Sección / Descripción', 'Presentación / Kilos', 'Costo Compra', 'Costo Unitario (kg/ud)', 'Costo Gramo', 'Cantidad Tanda', `Costo Producción (${curr})`];

    const rows: (string | number)[][] = [];

    // Materia Prima
    rows.push(['--- MATERIA PRIMA ---', '', '', '', '', '', '']);
    for (const rm of this.rawMaterials()) {
      rows.push([
        rm.description,
        `${rm.presentation} ${rm.presentationUnit}`,
        formatVeNumber(rm.costBcv * mult, 2),
        formatVeNumber(rm.unitCost * mult, 4),
        formatVeNumber(rm.costPerGram * mult, 5),
        `${rm.cantProduction}`,
        formatVeNumber(rm.costPerProduction * mult, 2),
      ]);
    }
    rows.push(['TOTAL MATERIA PRIMA', '', '', '', '', `${this.productionKilosBase()} kg`, formatVeNumber(this.totalRawMaterialsCost() * mult, 2)]);
    rows.push(['Costo MP por 1 kg', '', '', '', '', '1 kg', formatVeNumber(this.rawMaterialCostPerKg() * mult, 4)]);
    rows.push(['Costo MP por 20 kg', '', '', '', '', '20 kg', formatVeNumber(this.rawMaterialCost20kg() * mult, 2)]);

    // Empaques
    rows.push(['--- ENVASES Y ETIQUETAS ---', '', '', '', '', '', '']);
    for (const p of this.packaging20k()) {
      rows.push([p.presentation, '', '', '', '', '', formatVeNumber(p.unitCost * mult, 2)]);
    }
    rows.push(['TOTAL ENVASES 20K', '', '', '', '', '', formatVeNumber(this.totalPackaging20k() * mult, 2)]);

    // Gastos Fijos
    rows.push(['--- GASTOS FIJOS ---', 'Días Mes', 'Monto Mensual', 'Costo Diario', 'Costo / kg', '', '']);
    for (const fe of this.computedFixedExpenseRows()) {
      rows.push([
        fe.concept,
        fe.workDays,
        formatVeNumber(fe.monthlyAmount * mult, 2),
        formatVeNumber(fe.dailyAmount * mult, 2),
        formatVeNumber(fe.costPerKg * mult, 4),
        '',
        '',
      ]);
    }
    rows.push(['TOTAL GASTOS FIJOS', this.workDaysPerMonth(), formatVeNumber(this.totalFixedMonthly() * mult, 2), formatVeNumber(this.totalFixedDaily() * mult, 2), formatVeNumber(this.totalFixedPerKg() * mult, 4), '', '']);

    // Resumen Final
    rows.push(['--- RESUMEN FINAL CUÑETE 20KG ---', '', '', '', '', '', '']);
    rows.push(['Costo Final Cuñete 20kg', '', '', '', '', '', formatVeNumber(this.cuneteFinalCost() * mult, 2)]);
    rows.push(['Precio Margen 30%', '', '', '', '', '', formatVeNumber(this.cunetePrices().margin30 * mult, 2)]);
    rows.push(['Precio Margen 25%', '', '', '', '', '', formatVeNumber(this.cunetePrices().margin25 * mult, 2)]);
    rows.push(['Precio Margen 20%', '', '', '', '', '', formatVeNumber(this.cunetePrices().margin20 * mult, 2)]);

    exportToExcel(`estructura_costos_mermelada_20kg_${new Date().toISOString().slice(0, 10)}.xls`, 'Estructura Costos 20kg', headers, rows);
  }

  public exportDetailedCostCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.rate();
    const mult = isBs ? rate : 1;
    const curr = isBs ? 'Bs.' : '$';

    const headers = ['Concepto', 'Presentacion', 'Costo Unitario', 'Cantidad Produccion', `Total (${curr})`];
    const rows: (string | number)[][] = [];

    for (const rm of this.rawMaterials()) {
      rows.push([rm.description, `${rm.presentation} ${rm.presentationUnit}`, formatVeNumber(rm.unitCost * mult, 4), rm.cantProduction, formatVeNumber(rm.costPerProduction * mult, 2)]);
    }

    rows.push(['Total Materia Prima', '', '', this.productionKilosBase(), formatVeNumber(this.totalRawMaterialsCost() * mult, 2)]);
    rows.push(['Envase Cuñete 20k', '', '', 1, formatVeNumber(this.totalPackaging20k() * mult, 2)]);
    rows.push(['Gastos Fijos 20kg', '', '', 20, formatVeNumber(this.fixedCost20kg() * mult, 2)]);
    rows.push(['COSTO FINAL CUÑETE 20KG', '', '', '', formatVeNumber(this.cuneteFinalCost() * mult, 2)]);
    rows.push(['Precio Sugerido 30%', '', '', '', formatVeNumber(this.cunetePrices().margin30 * mult, 2)]);
    rows.push(['Precio Sugerido 25%', '', '', '', formatVeNumber(this.cunetePrices().margin25 * mult, 2)]);
    rows.push(['Precio Sugerido 20%', '', '', '', formatVeNumber(this.cunetePrices().margin20 * mult, 2)]);

    exportToCsv(`estructura_costos_20kg_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  public exportCostingPdf() {
    this.exportDetailedCostEstimationPdf();
  }

  public exportDetailedCostEstimationPdf() {
    downloadDetailedCostEstimationPdf({
      productionKilosBase: this.productionKilosBase(),
      workDays: this.workDaysPerMonth(),
      customMarginPercent: this.customMarginPercent(),
      exchangeRate: this.rate(),
      currencyMode: this.currencyMode(),
      rawMaterials: this.rawMaterials(),
      packaging20k: this.packaging20k(),
      packagingCaja20k: this.packagingCaja20k(),
      packagingGalon: this.packagingGalon(),
      fixedExpenses: this.computedFixedExpenseRows(),
      workers: this.workers(),
      totalRawMaterialsCost: this.totalRawMaterialsCost(),
      rawMaterialCostPerKg: this.rawMaterialCostPerKg(),
      rawMaterialCost20kg: this.rawMaterialCost20kg(),
      rawMaterialCost5kg: this.rawMaterialCost5kg(),
      totalPackaging20k: this.totalPackaging20k(),
      totalPackagingCaja20k: this.totalPackagingCaja20k(),
      totalPackagingGalon: this.totalPackagingGalon(),
      totalFixedMonthly: this.totalFixedMonthly(),
      totalFixedDaily: this.totalFixedDaily(),
      totalFixedPerKg: this.totalFixedPerKg(),
      fixedCost20kg: this.fixedCost20kg(),
      fixedCost5kg: this.fixedCost5kg(),
      costPer1kg: this.costPer1kg(),
      cost20kgWithoutPackaging: this.cost20kgWithoutPackaging(),
      cuneteFinalCost: this.cuneteFinalCost(),
      cajaFinalCost: this.cajaFinalCost(),
      galonFinalCost: this.galonFinalCost(),
      cunetePrices: this.cunetePrices(),
      cajaPrices: this.cajaPrices(),
      galonPrices: this.galonPrices(),
    });

    this.api.showToast('Reporte PDF de Estimación de Costos generado y descargado.');
  }

  public printCostEstimation() {
    window.print();
  }

  public emailCostEstimationToClient() {
    // Generate and download PDF first
    this.exportDetailedCostEstimationPdf();

    // Prepare formal email message for client
    const rate = this.rate();
    const curr = this.currencyMode() === 'USD' ? '$' : 'Bs.';
    const mult = this.currencyMode() === 'USD' ? 1 : rate;
    const cunete25 = (this.cunetePrices().margin25 * mult).toFixed(2);
    const cunete30 = (this.cunetePrices().margin30 * mult).toFixed(2);
    const caja25 = (this.cajaPrices().margin25 * mult).toFixed(2);
    const galon25 = (this.galonPrices().margin25 * mult).toFixed(2);

    const subject = encodeURIComponent(`Cotización Formal de Mermeladas PulpaCraft - ${new Date().toLocaleDateString('es-VE')}`);
    const body = encodeURIComponent(
`Estimado cliente / distribuidor,

Le saludamos cordialmente desde Mermeladas Artesanales del Valle C.A. (PulpaCraft MRP).

Adjunto a este correo encontrará el Reporte Oficial de Estimación de Costos y Precios generado para su revisión:

RESUMEN DE PRECIOS SUGERIDOS:
• Cuñete 20kg (Pote Plástico Grado Alimentario):
  - Precio Mayorista (Margen 25%): ${curr} ${cunete25}
  - Precio Especial Distribuidor (Margen 30%): ${curr} ${cunete30}

• Caja 20kg (Cartón Industrial + Bolsa):
  - Precio Mayorista: ${curr} ${caja25}

• Galón 5kg (Envase Comercial):
  - Precio Unitario: ${curr} ${galon25}

CONDICIONES COMERCIALES:
- Tasa Oficial BCV de Referencia: Bs. ${rate.toFixed(2)} / USD
- Producción bajo pedido (Make-to-Order): 3 a 5 días hábiles de despacho.
- Garantía de calidad: Grados Brix 78° controlados en marmita y pulpa criolla seleccionada.
- Validez de la cotización: 15 días continuos.

Quedamos a su entera disposición para coordinar su orden de producción.

Atentamente,
Gerencia de Comercialización & Costos
PulpaCraft MRP · Mermeladas Artesanales del Valle C.A.
RIF: J-40899231-0`
    );

    if (typeof window !== 'undefined') {
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    }
  }
}

