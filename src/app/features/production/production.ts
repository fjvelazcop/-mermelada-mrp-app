import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, FormArray, Validators} from '@angular/forms';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {RecipeBOM, ProductionOrder} from '../../core/models/erp.models';
import {VeCurrencyPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';

import {AuditLog} from '../../shared/components/audit-log/audit-log';

@Component({
  selector: 'app-production',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, ReactiveFormsModule, VeCurrencyPipe, AuditLog],
  templateUrl: './production.html',
})
export class ProductionComponent {
  public api = inject(ErpApiService);

  public activeProductionTab = signal<'orders' | 'recipes' | 'audit'>('orders');
  public currencyMode = signal<'USD' | 'Bs'>('USD');
  public isCreateOrderModalOpen = signal<boolean>(false);
  public isManualOrderModalOpen = signal<boolean>(false);
  public editingManualOrderId = signal<string | null>(null);
  public isRecipeDetailModalOpen = signal<boolean>(false);
  public selectedRecipe = signal<RecipeBOM | null>(null);
  public selectedOrderForDetails = signal<ProductionOrder | null>(null);

  public productionAuditCount = computed(() =>
    this.api.auditLogs().filter(l => l.module === 'produccion').length
  );

  public newOrderForm = new FormGroup({
    recipeId: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    batchCount: new FormControl<number>(1, {nonNullable: true, validators: [Validators.required, Validators.min(1)]}),
    salesOrderId: new FormControl<string>('', {nonNullable: true}),
    lotNumber: new FormControl<string>('', {nonNullable: true}),
    operatorNotes: new FormControl<string>('', {nonNullable: true}),
  });

  /** Multi-formula manual production order (Administrator only). */
  public manualOrderForm = new FormGroup({
    lotNumber: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    commitmentReference: new FormControl<string>('', {nonNullable: true}),
    operatorNotes: new FormControl<string>('', {nonNullable: true}),
    processImmediately: new FormControl<boolean>(false, {nonNullable: true}),
    formulas: new FormArray<
      FormGroup<{
        recipeId: FormControl<string>;
        batchCount: FormControl<number>;
      }>
    >([]),
  });

  public recipes = computed(() => this.api.recipes());
  public productionOrders = computed(() => this.api.productionOrders());
  public manualOrders = computed(() =>
    this.productionOrders().filter((order) => order.mode === 'manual')
  );
  public automaticOrders = computed(() =>
    this.productionOrders().filter((order) => order.mode !== 'manual')
  );
  public isAdmin = computed(() => this.api.currentRole() === 'admin');
  public pendingSalesOrders = computed(() => {
    return this.api.salesOrders().filter(s => s.status === 'pendiente' || s.status === 'en_produccion');
  });

  public get manualFormulas() {
    return this.manualOrderForm.controls.formulas;
  }

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

  // --- MANUAL PRODUCTION ORDERS (ADMIN ONLY) ---

  private buildFormulaGroup(recipeId = '', batchCount = 1) {
    return new FormGroup({
      recipeId: new FormControl<string>(recipeId, {
        nonNullable: true,
        validators: [Validators.required],
      }),
      batchCount: new FormControl<number>(batchCount, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(1)],
      }),
    });
  }

  public addManualFormula(recipeId = '') {
    this.manualFormulas.push(
      this.buildFormulaGroup(recipeId || this.recipes()[0]?.id || '', 1)
    );
  }

  public removeManualFormula(index: number) {
    if (this.manualFormulas.length <= 1) {
      this.api.showToast('La orden debe contener al menos una fórmula.', 'error');
      return;
    }
    this.manualFormulas.removeAt(index);
  }

  private autoManualLot(): string {
    const now = new Date();
    return (
      'L-MAN-' +
      now.toISOString().slice(2, 4) +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      Math.floor(Math.random() * 80 + 10)
    );
  }

  public openNewManualOrder() {
    if (!this.isAdmin()) {
      this.api.showToast('Solo el Administrador puede crear órdenes manuales.', 'error');
      return;
    }
    this.editingManualOrderId.set(null);
    this.manualOrderForm.patchValue({
      lotNumber: this.autoManualLot(),
      commitmentReference: '',
      operatorNotes: '',
      processImmediately: false,
    });
    this.manualFormulas.clear();
    this.addManualFormula();
    this.isManualOrderModalOpen.set(true);
  }

  public openEditManualOrder(order: ProductionOrder) {
    if (!this.isAdmin()) {
      this.api.showToast('Solo el Administrador puede editar órdenes manuales.', 'error');
      return;
    }
    if (order.status !== 'borrador') {
      this.api.showToast('Solo se pueden editar órdenes manuales en borrador.', 'error');
      return;
    }
    this.editingManualOrderId.set(order.id);
    this.manualOrderForm.patchValue({
      lotNumber: order.lotNumber,
      commitmentReference: order.commitmentReference || '',
      operatorNotes: order.operatorNotes || '',
      processImmediately: false,
    });
    this.manualFormulas.clear();
    const formulas =
      order.formulas && order.formulas.length > 0
        ? order.formulas
        : [{recipeId: order.recipeId, batchCount: order.batchCount}];
    for (const formula of formulas) {
      this.manualFormulas.push(
        this.buildFormulaGroup(formula.recipeId, formula.batchCount)
      );
    }
    this.isManualOrderModalOpen.set(true);
  }

  public closeManualOrderModal() {
    this.isManualOrderModalOpen.set(false);
    this.editingManualOrderId.set(null);
  }

  public formulaPreview(index: number) {
    const group = this.manualFormulas.at(index);
    const recipe = this.recipes().find(
      (r) => r.id === group?.controls.recipeId.value
    );
    if (!recipe) return null;
    const batchCount = Number(group?.controls.batchCount.value) || 1;
    return {
      name: recipe.name,
      units: recipe.batchSizeUnits * batchCount,
    };
  }

  public manualTotalUnits(order: ProductionOrder): number {
    if (order.formulas && order.formulas.length > 0) {
      return order.formulas.reduce((sum, formula) => sum + formula.targetUnits, 0);
    }
    return order.targetUnits;
  }

  public manualStatusLabel(order: ProductionOrder): string {
    switch (order.status) {
      case 'borrador':
        return 'Borrador';
      case 'anulada':
        return 'Anulada';
      case 'completada':
        return 'Procesada · Inventario comprometido';
      case 'en_proceso':
        return 'En proceso';
      default:
        return order.status;
    }
  }

  public async submitManualOrder() {
    if (!this.isAdmin()) {
      this.api.showToast('Solo el Administrador puede gestionar órdenes manuales.', 'error');
      return;
    }
    if (this.manualFormulas.length === 0) {
      this.api.showToast('Agrega al menos una fórmula a la orden.', 'error');
      return;
    }
    if (this.manualOrderForm.invalid) {
      this.manualOrderForm.markAllAsTouched();
      return;
    }

    const v = this.manualOrderForm.getRawValue();
    const formulas = v.formulas.map((formula) => ({
      recipeId: formula.recipeId,
      batchCount: Number(formula.batchCount),
    }));
    const editingId = this.editingManualOrderId();

    if (editingId) {
      await this.api.updateManualProductionOrder(editingId, {
        formulas,
        lotNumber: v.lotNumber,
        commitmentReference: v.commitmentReference || undefined,
        operatorNotes: v.operatorNotes || undefined,
      });
    } else {
      await this.api.createManualProductionOrder({
        formulas,
        lotNumber: v.lotNumber,
        commitmentReference: v.commitmentReference || undefined,
        operatorNotes: v.operatorNotes || undefined,
        processImmediately: v.processImmediately,
      });
    }
    this.closeManualOrderModal();
  }

  public async deleteManualOrder(order: ProductionOrder) {
    if (!this.isAdmin()) {
      this.api.showToast('Solo el Administrador puede eliminar órdenes manuales.', 'error');
      return;
    }
    if (
      confirm(
        `¿Eliminar la orden manual ${order.orderNumber}? Esta acción queda auditada.`
      )
    ) {
      await this.api.deleteManualProductionOrder(order.id);
    }
  }

  public async processManualOrder(order: ProductionOrder) {
    if (!this.isAdmin()) {
      this.api.showToast('Solo el Administrador puede procesar órdenes manuales.', 'error');
      return;
    }
    if (
      confirm(
        `¿Procesar la orden ${order.orderNumber}? Se consumirán las materias primas y las unidades producidas quedarán en inventario comprometido.`
      )
    ) {
      await this.api.processManualProductionOrder(order.id);
    }
  }

  public async annulManualOrder(order: ProductionOrder) {
    if (!this.isAdmin()) {
      this.api.showToast('Solo el Administrador puede anular órdenes manuales.', 'error');
      return;
    }
    if (
      confirm(
        `¿Anular la orden ${order.orderNumber}? Se revertirán las materias primas y el inventario comprometido.`
      )
    ) {
      await this.api.annulManualProductionOrder(order.id);
    }
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
