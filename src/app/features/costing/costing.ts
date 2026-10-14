import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {VeCurrencyPipe, VeNumberPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, downloadCostingSummaryPdf} from '../../core/utils/export.utils';

@Component({
  selector: 'app-costing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, ReactiveFormsModule, VeCurrencyPipe, VeNumberPipe],
  templateUrl: './costing.html',
})
export class CostingComponent {
  public api = inject(ErpApiService);

  public currencyMode = signal<'USD' | 'Bs'>('USD');
  public costData = computed(() => this.api.costStructure());

  // Interactive Pricing and Costing Simulator
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

  public async runSimulation() {
    const v = this.simulatorForm.getRawValue();
    try {
      const result = await this.api.simulateCost({
        directMaterial: Number(v.directMaterial),
        directPackaging: Number(v.directPackaging),
        directLabor: Number(v.directLabor),
        utilityCost: Number(v.utilityCost),
        inactiveWeeksCount: Number(v.inactiveWeeksCount),
        targetMarginWholesale: Number(v.targetMarginWholesale),
        targetMarginRetail: Number(v.targetMarginRetail),
      });
      this.simulationResult.set(result);
    } catch {
      // fallback in-memory math if offline
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
  }

  public loadPreset(presentation: 'pequena' | 'grande') {
    if (presentation === 'pequena') {
      this.simulatorForm.patchValue({
        directMaterial: 0.35,
        directPackaging: 0.49,
        directLabor: 0.18,
        utilityCost: 0.09,
        inactiveWeeksCount: 2,
        targetMarginWholesale: 33,
        targetMarginRetail: 50,
      });
    } else {
      this.simulatorForm.patchValue({
        directMaterial: 1.48,
        directPackaging: 0.96,
        directLabor: 0.56,
        utilityCost: 0.34,
        inactiveWeeksCount: 2,
        targetMarginWholesale: 39,
        targetMarginRetail: 53,
      });
    }
    this.runSimulation();
  }

  // --- EXPORT FUNCTIONALITY: COST STRUCTURE BY PRESENTATION ---

  public exportCostingCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
       'Presentación',
       'Tasa Utilizada (Bs./USD)',
       `Materia Prima Directa (${isBs ? 'Bs.' : 'USD'})`,
       `Empaque Directo (${isBs ? 'Bs.' : 'USD'})`,
       `Mano de Obra Directa (${isBs ? 'Bs.' : 'USD'})`,
       `Carga Indirecta / CIF (${isBs ? 'Bs.' : 'USD'})`,
       `Costo Total Unitario (${isBs ? 'Bs.' : 'USD'})`,
       `Precio Mayorista Sugerido (${isBs ? 'Bs.' : 'USD'})`,
       `Precio Detal Sugerido (${isBs ? 'Bs.' : 'USD'})`,
       'Margen Bruto Mayorista (%)',
       'Margen Bruto Detal (%)',
    ];

    const items = this.costData()?.costBreakdownByPresentation || [];
    const rows: (string | number | null | undefined)[][] = items.map(item => {
      const mult = isBs ? rate : 1;
      return [
        item.label,
        formatVeNumber(rate, 2),
        formatVeNumber(item.directMaterial * mult, 2),
        formatVeNumber(item.directPackaging * mult, 2),
        formatVeNumber(item.directLabor * mult, 2),
        formatVeNumber(item.cifAllocation * mult, 2),
        formatVeNumber(item.totalUnitCost * mult, 2),
        formatVeNumber(item.suggestedWholesalePrice * mult, 2),
        formatVeNumber(item.suggestedRetailPrice * mult, 2),
        formatVeNumber(item.marginWholesalePercent, 1) + '%',
        formatVeNumber(item.marginRetailPercent, 1) + '%',
      ];
    });

    exportToCsv(`estructura_costos_mermeladas_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  public exportCostingExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
       'Presentación',
       'Tasa Utilizada (Bs./USD)',
       `Materia Prima Directa (${isBs ? 'Bs.' : 'USD'})`,
       `Empaque Directo (${isBs ? 'Bs.' : 'USD'})`,
       `Mano de Obra Directa (${isBs ? 'Bs.' : 'USD'})`,
       `Carga Indirecta / CIF (${isBs ? 'Bs.' : 'USD'})`,
       `Costo Total Unitario (${isBs ? 'Bs.' : 'USD'})`,
       `Precio Mayorista Sugerido (${isBs ? 'Bs.' : 'USD'})`,
       `Precio Detal Sugerido (${isBs ? 'Bs.' : 'USD'})`,
       'Margen Bruto Mayorista (%)',
       'Margen Bruto Detal (%)',
    ];

    const items = this.costData()?.costBreakdownByPresentation || [];
    const rows = items.map(item => {
      const mult = isBs ? rate : 1;
      return [
        item.label,
        rate,
        Number((item.directMaterial * mult).toFixed(2)),
        Number((item.directPackaging * mult).toFixed(2)),
        Number((item.directLabor * mult).toFixed(2)),
        Number((item.cifAllocation * mult).toFixed(2)),
        Number((item.totalUnitCost * mult).toFixed(2)),
        Number((item.suggestedWholesalePrice * mult).toFixed(2)),
        Number((item.suggestedRetailPrice * mult).toFixed(2)),
        item.marginWholesalePercent,
        item.marginRetailPercent,
      ];
    });

    exportToExcel(`estructura_costos_mermeladas_${new Date().toISOString().slice(0, 10)}.xls`, 'Costos por Presentación', headers, rows);
  }

  public exportCostingPdf() {
    this.exportCostingSummaryPdf();
  }

  public exportCostingSummaryPdf() {
    const data = this.costData();
    if (!data) return;
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    downloadCostingSummaryPdf(data, rate, this.simulationResult(), this.currencyMode());
  }
}
