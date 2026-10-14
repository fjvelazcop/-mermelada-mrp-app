import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {RecipeBOM, ProductionOrder} from '../../core/models/erp.models';
import {VeCurrencyPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';

@Component({
  selector: 'app-production',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, ReactiveFormsModule, VeCurrencyPipe],
  templateUrl: './production.html',
})
export class ProductionComponent {
  public api = inject(ErpApiService);

  public currencyMode = signal<'USD' | 'Bs'>('USD');
  public isCreateOrderModalOpen = signal<boolean>(false);
  public isRecipeDetailModalOpen = signal<boolean>(false);
  public selectedRecipe = signal<RecipeBOM | null>(null);
  public selectedOrderForDetails = signal<ProductionOrder | null>(null);

  public newOrderForm = new FormGroup({
    recipeId: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    batchCount: new FormControl<number>(1, {nonNullable: true, validators: [Validators.required, Validators.min(1)]}),
    salesOrderId: new FormControl<string>('', {nonNullable: true}),
    lotNumber: new FormControl<string>('', {nonNullable: true}),
    operatorNotes: new FormControl<string>('', {nonNullable: true}),
  });

  public recipes = computed(() => this.api.recipes());
  public productionOrders = computed(() => this.api.productionOrders());
  public pendingSalesOrders = computed(() => {
    return this.api.salesOrders().filter(s => s.status === 'pendiente' || s.status === 'en_produccion');
  });

  // Calculate requirement preview for the selected recipe and batch count
  public orderPreview = computed(() => {
    const recipeId = this.newOrderForm.controls.recipeId.value;
    const batchCount = this.newOrderForm.controls.batchCount.value || 1;
    const recipe = this.recipes().find(r => r.id === recipeId);
    if (!recipe) return null;

    const materials = this.api.rawMaterials();
    const requirements = recipe.items.map(item => {
      const needed = item.quantity * batchCount;
      const mat = materials.find(m => m.id === item.materialId);
      const stock = mat ? mat.currentStock : 0;
      const isShort = stock < needed;
      return {
        ...item,
        needed,
        stock,
        isShort,
        unit: item.unit,
      };
    });

    const anyShortage = requirements.some(r => r.isShort);
    const targetUnits = recipe.batchSizeUnits * batchCount;
    return {
      recipe,
      batchCount,
      targetUnits,
      requirements,
      anyShortage,
    };
  });

  public openCreateOrderModal(presetRecipeId?: string, presetSalesOrderId?: string) {
    const firstRec = this.recipes()[0]?.id || '';
    const autoLot = 'L-GUAY-' + new Date().toISOString().slice(2, 4) + (new Date().getMonth() + 1).toString().padStart(2, '0') + '-' + Math.floor(Math.random() * 80 + 10);
    this.newOrderForm.patchValue({
      recipeId: presetRecipeId || firstRec,
      batchCount: 1,
      salesOrderId: presetSalesOrderId || '',
      lotNumber: autoLot,
      operatorNotes: '',
    });
    this.isCreateOrderModalOpen.set(true);
  }

  public closeCreateOrderModal() {
    this.isCreateOrderModalOpen.set(false);
  }

  public openRecipeDetails(recipe: RecipeBOM) {
    this.selectedRecipe.set(recipe);
    this.isRecipeDetailModalOpen.set(true);
  }

  public closeRecipeDetails() {
    this.isRecipeDetailModalOpen.set(false);
    this.selectedRecipe.set(null);
  }

  public async submitProductionOrder() {
    if (this.newOrderForm.invalid) return;
    const v = this.newOrderForm.getRawValue();
    await this.api.createProductionOrder({
      recipeId: v.recipeId,
      batchCount: Number(v.batchCount),
      salesOrderId: v.salesOrderId || undefined,
      lotNumber: v.lotNumber,
      operatorNotes: v.operatorNotes,
    });
    this.closeCreateOrderModal();
  }

  public async processOrder(orderId: string) {
    await this.api.processProductionOrder(orderId);
  }

  // --- EXPORT FUNCTIONALITY: PRODUCTION ORDERS ---

  public exportProductionCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Nro. Orden',
      'Lote',
      'Receta / Sabor',
      'Unidades Meta',
      'Fecha Creación',
      'Estado',
      'Cliente MTO',
      'Tasa Usada (Bs./USD)',
      `Costo Directo MP (${isBs ? 'Bs.' : 'USD'})`,
      `Costo Total (${isBs ? 'Bs.' : 'USD'})`,
      `Costo Unitario (${isBs ? 'Bs.' : 'USD'})`,
    ];

    const rows = this.productionOrders().map(o => {
      const orderRate = rate;
      const directMat = isBs ? o.directMaterialCost * orderRate : o.directMaterialCost;
      const totalCost = isBs ? (o.totalCost ?? o.totalProductionCost) * orderRate : (o.totalCost ?? o.totalProductionCost);
      const unitCost = isBs ? o.unitCost * orderRate : o.unitCost;

      return [
        o.orderNumber,
        o.lotNumber,
        o.recipeName,
        o.targetUnits,
        o.createdAt || o.startDate,
        o.status,
        o.customerName || 'Stock General',
        formatVeNumber(orderRate, 2),
        formatVeNumber(directMat, 2),
        formatVeNumber(totalCost, 2),
        formatVeNumber(unitCost, 2),
      ];
    });

    exportToCsv(`ordenes_produccion_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  public exportProductionExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Nro. Orden',
      'Lote',
      'Receta / Sabor',
      'Unidades Meta',
      'Fecha Creación',
      'Estado',
      'Cliente MTO',
      'Tasa Usada (Bs./USD)',
      `Costo Directo MP (${isBs ? 'Bs.' : 'USD'})`,
      `Costo Total (${isBs ? 'Bs.' : 'USD'})`,
      `Costo Unitario (${isBs ? 'Bs.' : 'USD'})`,
    ];

    const rows = this.productionOrders().map(o => {
      const orderRate = rate;
      const directMat = isBs ? o.directMaterialCost * orderRate : o.directMaterialCost;
      const totalCost = isBs ? (o.totalCost ?? o.totalProductionCost) * orderRate : (o.totalCost ?? o.totalProductionCost);
      const unitCost = isBs ? o.unitCost * orderRate : o.unitCost;

      return [
        o.orderNumber,
        o.lotNumber,
        o.recipeName,
        o.targetUnits,
        o.createdAt || o.startDate,
        o.status,
        o.customerName || 'Stock General',
        orderRate,
        directMat,
        totalCost,
        unitCost,
      ];
    });

    exportToExcel(`ordenes_produccion_${new Date().toISOString().slice(0, 10)}.xls`, 'Órdenes Producción', headers, rows);
  }

  public exportProductionPdf() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Orden',
      'Lote',
      'Receta',
      'Uds',
      'Estado',
      'Cliente MTO',
      'Tasa',
      `Costo MP (${isBs ? 'Bs.' : '$'})`,
      `Costo Total (${isBs ? 'Bs.' : '$'})`,
    ];

    const rows = this.productionOrders().map(o => {
      const orderRate = rate;
      const directMat = isBs ? o.directMaterialCost * orderRate : o.directMaterialCost;
      const totalCost = isBs ? (o.totalCost ?? o.totalProductionCost) * orderRate : (o.totalCost ?? o.totalProductionCost);

      return [
        o.orderNumber,
        o.lotNumber,
        o.recipeName,
        o.targetUnits,
        o.status,
        o.customerName || 'Stock General',
        `Bs. ${formatVeNumber(orderRate, 2)}`,
        formatVeNumber(directMat, 2),
        formatVeNumber(totalCost, 2),
      ];
    });

    exportToPdf(
      'Reporte de Órdenes de Producción y Cocción de Mermeladas (MTO)',
      `Moneda de reporte: ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'} | Tasa de referencia: Bs. ${formatVeNumber(rate, 2)}`,
      headers,
      rows
    );
  }
}
