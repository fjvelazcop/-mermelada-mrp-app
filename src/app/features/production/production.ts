import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {DecimalPipe, CommonModule} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {RecipeBOM, ProductionOrder} from '../../core/models/erp.models';
import {VeCurrencyPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';

import {AuditLog} from '../../shared/components/audit-log/audit-log';

@Component({
  selector: 'app-production',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DecimalPipe, MatIconModule, ReactiveFormsModule, VeCurrencyPipe, AuditLog],
  templateUrl: './production.html',
})
export class ProductionComponent {
  public api = inject(ErpApiService);

  public activeProductionTab = signal<'orders' | 'recipes' | 'audit'>('orders');
  public currencyMode = signal<'USD' | 'Bs'>('USD');
  public orderTypeFilter = signal<'all' | 'mto' | 'manual'>('all');
  public isCreateOrderModalOpen = signal<boolean>(false);
  public isCreateManualOrderModalOpen = signal<boolean>(false);
  public isEditManualOrderModalOpen = signal<boolean>(false);
  public isRecipeDetailModalOpen = signal<boolean>(false);
  public selectedRecipe = signal<RecipeBOM | null>(null);
  public selectedOrderForDetails = signal<ProductionOrder | null>(null);
  public editingManualOrder = signal<ProductionOrder | null>(null);

  // Dynamic rows of formulas for manual order (Multi-formula support)
  public manualFormulaRows = signal<{ recipeId: string; batchCount: number }[]>([]);

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

  public manualOrderForm = new FormGroup({
    lotNumber: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    operatorNotes: new FormControl<string>('', {nonNullable: true}),
  });

  public recipes = computed(() => this.api.recipes());
  public productionOrders = computed(() => this.api.productionOrders());
  public pendingSalesOrders = computed(() => {
    return this.api.salesOrders().filter(s => s.status === 'pendiente' || s.status === 'en_produccion');
  });

  public filteredProductionOrders = computed(() => {
    const list = this.productionOrders();
    const filter = this.orderTypeFilter();
    if (filter === 'manual') return list.filter(o => o.isManual);
    if (filter === 'mto') return list.filter(o => !o.isManual);
    return list;
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

  // Multi-formula Manual Order Preview (Combined ingredients and stock check)
  public manualOrderPreview = computed(() => {
    const rows = this.manualFormulaRows();
    const allRecipes = this.recipes();
    const materials = this.api.rawMaterials();

    const formulaSummaries: {
      recipe: RecipeBOM;
      batchCount: number;
      targetUnits: number;
    }[] = [];

    const neededMap = new Map<string, { materialId: string; materialName: string; needed: number; unit: string }>();

    let totalTargetUnits = 0;

    for (const row of rows) {
      const rec = allRecipes.find(r => r.id === row.recipeId);
      if (!rec) continue;
      const batches = Math.max(1, row.batchCount || 1);
      const units = rec.batchSizeUnits * batches;
      totalTargetUnits += units;

      formulaSummaries.push({
        recipe: rec,
        batchCount: batches,
        targetUnits: units,
      });

      for (const item of rec.items) {
        const qty = item.quantity * batches;
        const existing = neededMap.get(item.materialId);
        if (existing) {
          existing.needed += qty;
        } else {
          neededMap.set(item.materialId, {
            materialId: item.materialId,
            materialName: item.materialName,
            needed: qty,
            unit: item.unit,
          });
        }
      }
    }

    const combinedRequirements = Array.from(neededMap.values()).map(req => {
      const mat = materials.find(m => m.id === req.materialId);
      const currentStock = mat ? mat.currentStock : 0;
      const isShort = currentStock < req.needed;
      return {
        ...req,
        currentStock,
        isShort,
      };
    });

    const anyShortage = combinedRequirements.some(r => r.isShort);

    return {
      formulaSummaries,
      totalTargetUnits,
      combinedRequirements,
      anyShortage,
    };
  });

  public openCreateManualOrderModal() {
    if (!this.api.isAdmin()) {
      this.api.showToast('Acceso restringido: Solo el usuario Administrador puede crear órdenes manuales.', 'error');
      return;
    }
    const recs = this.recipes();
    const autoLot = 'L-MANUAL-' + new Date().toISOString().slice(2, 4) + (new Date().getMonth() + 1).toString().padStart(2, '0') + '-' + Math.floor(Math.random() * 80 + 10);
    this.manualFormulaRows.set([
      { recipeId: recs[0]?.id || '', batchCount: 1 },
      { recipeId: recs[1]?.id || recs[0]?.id || '', batchCount: 1 },
    ]);
    this.manualOrderForm.reset({
      lotNumber: autoLot,
      operatorNotes: 'Orden manual para stock libre en almacén (sin afectar comprometido)',
    });
    this.isCreateManualOrderModalOpen.set(true);
  }

  public closeCreateManualOrderModal() {
    this.isCreateManualOrderModalOpen.set(false);
  }

  public addManualFormulaRow() {
    const recs = this.recipes();
    const existing = this.manualFormulaRows();
    const nextRecipe = recs[existing.length % recs.length]?.id || recs[0]?.id || '';
    this.manualFormulaRows.update(rows => [...rows, { recipeId: nextRecipe, batchCount: 1 }]);
  }

  public removeManualFormulaRow(index: number) {
    if (this.manualFormulaRows().length <= 1) {
      this.api.showToast('Una orden manual debe incluir al menos una fórmula.', 'error');
      return;
    }
    this.manualFormulaRows.update(rows => rows.filter((_, i) => i !== index));
  }

  public updateManualFormulaRecipe(index: number, recipeId: string) {
    this.manualFormulaRows.update(rows =>
      rows.map((r, i) => (i === index ? { ...r, recipeId } : r))
    );
  }

  public updateManualFormulaBatches(index: number, batchCount: number) {
    this.manualFormulaRows.update(rows =>
      rows.map((r, i) => (i === index ? { ...r, batchCount: Math.max(1, batchCount) } : r))
    );
  }

  public async submitManualOrder() {
    if (!this.api.isAdmin()) {
      this.api.showToast('Acción denegada: Solo administradores pueden crear órdenes de producción manuales.', 'error');
      return;
    }
    if (this.manualOrderForm.invalid) {
      this.manualOrderForm.markAllAsTouched();
      return;
    }

    const rows = this.manualFormulaRows();
    if (rows.length === 0) {
      this.api.showToast('Debes agregar al menos una fórmula a la orden manual.', 'error');
      return;
    }

    const v = this.manualOrderForm.getRawValue();
    await this.api.createManualProductionOrder({
      formulas: rows.map(r => ({ recipeId: r.recipeId, batchCount: Number(r.batchCount) || 1 })),
      lotNumber: v.lotNumber,
      operatorNotes: v.operatorNotes || undefined,
    });

    this.closeCreateManualOrderModal();
  }

  public openEditManualOrderModal(order: ProductionOrder) {
    if (!this.api.isAdmin()) {
      this.api.showToast('Solo administradores pueden modificar órdenes manuales.', 'error');
      return;
    }
    this.editingManualOrder.set(order);
    if (order.formulas && order.formulas.length > 0) {
      this.manualFormulaRows.set(order.formulas.map(f => ({ recipeId: f.recipeId, batchCount: f.batchCount })));
    } else {
      this.manualFormulaRows.set([{ recipeId: order.recipeId, batchCount: order.batchCount }]);
    }
    this.manualOrderForm.reset({
      lotNumber: order.lotNumber,
      operatorNotes: order.operatorNotes || '',
    });
    this.isEditManualOrderModalOpen.set(true);
  }

  public closeEditManualOrderModal() {
    this.isEditManualOrderModalOpen.set(false);
    this.editingManualOrder.set(null);
  }

  public async saveEditManualOrder() {
    const order = this.editingManualOrder();
    if (!order) return;
    if (!this.api.isAdmin()) {
      this.api.showToast('Acción denegada: Solo administradores pueden modificar este modelo manual.', 'error');
      return;
    }
    if (this.manualOrderForm.invalid) return;

    const v = this.manualOrderForm.getRawValue();
    const rows = this.manualFormulaRows();

    await this.api.updateManualProductionOrder(order.id, {
      formulas: rows.map(r => ({ recipeId: r.recipeId, batchCount: Number(r.batchCount) || 1 })),
      lotNumber: v.lotNumber,
      operatorNotes: v.operatorNotes || undefined,
    });

    this.closeEditManualOrderModal();
  }

  public async deleteManualOrder(order: ProductionOrder) {
    if (!this.api.isAdmin()) {
      this.api.showToast('Solo administradores pueden eliminar órdenes de producción manuales.', 'error');
      return;
    }
    if (confirm(`¿Estás seguro de que deseas eliminar la orden manual ${order.orderNumber} (Lote: ${order.lotNumber})? Esta acción quedará registrada en auditoría.`)) {
      await this.api.deleteManualProductionOrder(order.id);
    }
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
