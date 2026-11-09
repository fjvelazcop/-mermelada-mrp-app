import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, FormArray, Validators} from '@angular/forms';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {RecipeBOM, ProductionOrder} from '../../core/models/erp.models';
import {VeCurrencyPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';
import {
  DEFAULT_SHEET_YIELD_PERCENT,
  calculateObtainedUnits,
  calculatePackagingEstimate,
  calculateTotalKgFromIngredients,
} from './manual-sheet-calculations';

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
  public isManualSheetModalOpen = signal<boolean>(false);
  public isManualSheetDetailModalOpen = signal<boolean>(false);
  public selectedManualSheetOrder = signal<ProductionOrder | null>(null);
  public isSavingManualSheet = signal<boolean>(false);
  public sheetRevision = signal<number>(0);
  public editingManualOrderId = signal<string | null>(null);
  public isRecipeDetailModalOpen = signal<boolean>(false);
  public selectedRecipe = signal<RecipeBOM | null>(null);
  public selectedOrderForDetails = signal<ProductionOrder | null>(null);

  /** Marmitas whose "Cant. obtenida" was edited by hand since the last base change. */
  private manualUnitsOverrides = new Set<number>();
  /** Marmitas whose "Kilos totales" was edited by hand since the last base change. */
  private manualTotalKgOverrides = new Set<number>();

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

  /** Manual production sheet based on the physical Lote 72 format. */
  public manualSheetForm = new FormGroup({
    lotNumber: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    productionDate: new FormControl<string>(
      new Date().toISOString().slice(0, 10),
      { nonNullable: true, validators: [Validators.required] }
    ),
    commitmentReference: new FormControl<string>('', { nonNullable: true }),
    operatorNotes: new FormControl<string>('', { nonNullable: true }),
    marmitas: new FormArray<
      FormGroup<{
        number: FormControl<number>;
        basketsBase: FormControl<number>;
        guavaKg: FormControl<number>;
        sugarKg: FormControl<number>;
        starchKg: FormControl<number>;
        chemicalG: FormControl<number>;
        acidG: FormControl<number>;
        waterGasOil: FormControl<number>;
        finishedAt: FormControl<string>;
        obtainedUnits: FormControl<number>;
        totalKg: FormControl<number>;
        reprocess: FormControl<boolean>;
      }>
    >([]),
    packaging: new FormGroup({
      presentationKg: new FormControl<number>(20, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(0.01)],
      }),
      cunetes: new FormControl<number>(0, {
        nonNullable: true,
        validators: [Validators.min(0)],
      }),
      cajas: new FormControl<number>(0, {
        nonNullable: true,
        validators: [Validators.min(0)],
      }),
      rendimiento: new FormControl<number>(DEFAULT_SHEET_YIELD_PERCENT, {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.min(0.01),
          Validators.max(100),
        ],
      }),
    }),
  });

  constructor() {
    this.manualSheetForm.valueChanges.subscribe(() => {
      this.sheetRevision.update((value) => value + 1);
    });
    this.manualSheetForm.controls.packaging.controls.presentationKg.valueChanges.subscribe(
      () => this.recalculateAllObtainedUnits()
    );
    this.manualSheetForm.controls.packaging.controls.rendimiento.valueChanges.subscribe(
      () => this.recalculateAllTotalKg()
    );
  }

  public recipes = computed(() => this.api.recipes());
  public productionOrders = computed(() => this.api.productionOrders());
  public manualOrders = computed(() =>
    this.productionOrders().filter((order) => order.mode === 'manual')
  );
  public automaticOrders = computed(() =>
    this.productionOrders().filter((order) => order.mode !== 'manual')
  );
  public isAdmin = computed(() => this.api.currentRole() === 'admin');
  /** Admin and plant supervisor may register LOTE 72 manual sheets. */
  public canCreateManualSheet = computed(
    () => this.isAdmin() || this.api.isSupervisorPlanta()
  );
  public pendingSalesOrders = computed(() => {
    return this.api.salesOrders().filter(s => s.status === 'pendiente' || s.status === 'en_produccion');
  });

  public get manualFormulas() {
    return this.manualOrderForm.controls.formulas;
  }

  public get sheetMarmitas() {
    return this.manualSheetForm.controls.marmitas;
  }

  private positive(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private materialRate(ids: string[], patterns: RegExp[]): number {
    const material = this.api
      .rawMaterials()
      .find(
        (item) =>
          ids.includes(item.id) ||
          patterns.some((pattern) => pattern.test(item.name))
      );
    return material?.costPerUnit ?? 0;
  }

  public sheetTotals = computed(() => {
    this.sheetRevision();
    const rows = this.sheetMarmitas.getRawValue();
    return rows.reduce(
      (acc, row) => ({
        guavaKg: acc.guavaKg + this.positive(row.guavaKg),
        sugarKg: acc.sugarKg + this.positive(row.sugarKg),
        starchKg: acc.starchKg + this.positive(row.starchKg),
        chemicalG: acc.chemicalG + this.positive(row.chemicalG),
        acidG: acc.acidG + this.positive(row.acidG),
        waterGasOil: acc.waterGasOil + this.positive(row.waterGasOil),
        obtainedUnits: acc.obtainedUnits + this.positive(row.obtainedUnits),
        totalKg: acc.totalKg + this.positive(row.totalKg),
      }),
      {
        guavaKg: 0,
        sugarKg: 0,
        starchKg: 0,
        chemicalG: 0,
        acidG: 0,
        waterGasOil: 0,
        obtainedUnits: 0,
        totalKg: 0,
      }
    );
  });

  public sheetUnitRates = computed(() => {
    const goods = this.api.finishedGoods();
    const guava = goods.filter((item) => item.flavor === 'Guayaba Criolla');
    return {
      cunete:
        guava.find((item) => item.presentation === 'pote_20kg')?.baseCost ?? 0,
      caja:
        guava.find((item) => item.presentation === 'caja_20kg')?.baseCost ?? 0,
    };
  });

  public sheetCosts = computed(() => {
    this.sheetRevision();
    const totals = this.sheetTotals();
    const packaging = this.manualSheetForm.controls.packaging.getRawValue();
    const cunetes = this.positive(packaging.cunetes);
    const cajas = this.positive(packaging.cajas);

    const materialsCost = Number(
      (
        totals.guavaKg * this.materialRate(['rm-1'], [/guayaba/i]) +
        totals.sugarKg * this.materialRate(['rm-2'], [/az[uú]car/i]) +
        totals.starchKg * this.materialRate(['rm-20'], [/almid[oó]n/i]) +
        totals.chemicalG * this.materialRate(['rm-3'], [/pectina/i]) +
        totals.acidG *
          this.materialRate(['rm-4'], [/[aá]cido c[ií]trico/i]) +
        totals.waterGasOil *
          this.materialRate(['rm-21'], [/gasoil|agua de proceso/i])
      ).toFixed(2)
    );
    const cunetePackagingUnitCost = this.materialRate(
      ['rm-17'],
      [/(cu[nñ]ete|pote).*20\s*kg/i]
    );
    const cajaPackagingUnitCost = this.materialRate(
      ['rm-18'],
      [/caja.*20\s*kg/i]
    );
    const packagingCost = Number(
      (
        cunetes * cunetePackagingUnitCost +
        cajas * cajaPackagingUnitCost
      ).toFixed(2)
    );
    const rates = this.sheetUnitRates();
    const cuneteValue = Number((cunetes * rates.cunete).toFixed(2));
    const cajaValue = Number((cajas * rates.caja).toFixed(2));
    return {
      materialsCost,
      packagingCost,
      totalCost: Number((materialsCost + packagingCost).toFixed(2)),
      cuneteValue,
      cajaValue,
      productionValue: Number((cuneteValue + cajaValue).toFixed(2)),
      cunetePackagingUnitCost,
      cajaPackagingUnitCost,
      cuneteRate: rates.cunete,
      cajaRate: rates.caja,
      cunetes,
      cajas,
      units: cunetes + cajas,
    };
  });

  /** Units represented by the captured kilos versus the units assigned to packaging. */
  public sheetPackagingEstimate = computed(() => {
    this.sheetRevision();
    const totals = this.sheetTotals();
    const packaging = this.manualSheetForm.controls.packaging.getRawValue();
    return calculatePackagingEstimate(
      totals.totalKg,
      packaging.presentationKg,
      packaging.cunetes,
      packaging.cajas
    );
  });

  public canSubmitManualSheet(): boolean {
    const packaging = this.manualSheetForm.controls.packaging.getRawValue();
    return (
      this.manualSheetForm.valid &&
      this.positive(packaging.cunetes) + this.positive(packaging.cajas) > 0 &&
      !this.isSavingManualSheet()
    );
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

  // --- MANUAL PRODUCTION SHEET (PHYSICAL LOTE 72 FORMAT) ---

  private recalculateTotalKg(number: number, force = false): void {
    const row = this.sheetMarmitas.controls.find(
      (control) => control.controls.number.value === number
    );
    if (!row) return;
    if (!force && this.manualTotalKgOverrides.has(number)) return;

    if (force && this.manualTotalKgOverrides.delete(number)) {
      this.sheetRevision.update((value) => value + 1);
    }
    const packaging = this.manualSheetForm.controls.packaging.getRawValue();
    const totalKg = calculateTotalKgFromIngredients(
      {
        guavaKg: row.controls.guavaKg.value,
        sugarKg: row.controls.sugarKg.value,
        starchKg: row.controls.starchKg.value,
        chemicalG: row.controls.chemicalG.value,
        acidG: row.controls.acidG.value,
      },
      packaging.rendimiento
    );
    if (row.controls.totalKg.value !== totalKg) {
      row.controls.totalKg.setValue(totalKg, { emitEvent: false });
      this.sheetRevision.update((value) => value + 1);
    }
    // Kilos totales is also the base for the units, so a new ingredient
    // capture always recalculates them and discards a previous unit override.
    this.recalculateObtainedUnits(number, true);
  }

  private recalculateAllTotalKg(): void {
    for (const row of this.sheetMarmitas.controls) {
      this.recalculateTotalKg(row.controls.number.value, true);
    }
  }

  private recalculateObtainedUnits(number: number, force = false): void {
    const row = this.sheetMarmitas.controls.find(
      (control) => control.controls.number.value === number
    );
    if (!row) return;
    if (!force && this.manualUnitsOverrides.has(number)) return;

    if (force && this.manualUnitsOverrides.delete(number)) {
      this.sheetRevision.update((value) => value + 1);
    }
    const presentationKg = this.positive(
      this.manualSheetForm.controls.packaging.controls.presentationKg.value
    );
    const units = calculateObtainedUnits(
      row.controls.totalKg.value,
      presentationKg
    );
    if (row.controls.obtainedUnits.value === units) return;

    row.controls.obtainedUnits.setValue(units, {emitEvent: false});
    this.sheetRevision.update((value) => value + 1);
  }

  private recalculateAllObtainedUnits(): void {
    for (const row of this.sheetMarmitas.controls) {
      this.recalculateObtainedUnits(row.controls.number.value, true);
    }
  }

  /** True when the operator corrected "Cant. obtenida" after the last base change. */
  public isObtainedUnitsManual(number: number): boolean {
    return this.manualUnitsOverrides.has(number);
  }

  /** True when the operator corrected "Kilos totales" after the last base change. */
  public isTotalKgManual(number: number): boolean {
    return this.manualTotalKgOverrides.has(number);
  }

  private buildMarmitaGroup(number: number) {
    const nonNegative = [Validators.min(0)];
    const group = new FormGroup({
      number: new FormControl<number>(number, { nonNullable: true }),
      basketsBase: new FormControl<number>(0, {
        nonNullable: true,
        validators: nonNegative,
      }),
      guavaKg: new FormControl<number>(0, {
        nonNullable: true,
        validators: nonNegative,
      }),
      sugarKg: new FormControl<number>(0, {
        nonNullable: true,
        validators: nonNegative,
      }),
      starchKg: new FormControl<number>(0, {
        nonNullable: true,
        validators: nonNegative,
      }),
      chemicalG: new FormControl<number>(0, {
        nonNullable: true,
        validators: nonNegative,
      }),
      acidG: new FormControl<number>(0, {
        nonNullable: true,
        validators: nonNegative,
      }),
      waterGasOil: new FormControl<number>(0, {
        nonNullable: true,
        validators: nonNegative,
      }),
      finishedAt: new FormControl<string>('', { nonNullable: true }),
      obtainedUnits: new FormControl<number>(0, {
        nonNullable: true,
        validators: nonNegative,
      }),
      totalKg: new FormControl<number>(0, {
        nonNullable: true,
        validators: nonNegative,
      }),
      reprocess: new FormControl<boolean>(false, { nonNullable: true }),
    });

    group.controls.totalKg.valueChanges.subscribe(() => {
      // This only fires for user edits: automatic estimate writes use
      // emitEvent: false. A manual weight becomes the new base for the units.
      this.manualTotalKgOverrides.add(group.controls.number.value);
      this.recalculateObtainedUnits(group.controls.number.value, true);
    });
    group.controls.obtainedUnits.valueChanges.subscribe(() => {
      // This only fires for user edits: automatic writes use emitEvent: false.
      this.manualUnitsOverrides.add(group.controls.number.value);
    });

    const ingredientKeys = [
      'guavaKg',
      'sugarKg',
      'starchKg',
      'chemicalG',
      'acidG',
    ] as const;
    for (const key of ingredientKeys) {
      group.controls[key].valueChanges.subscribe(() => {
        // A change in the ingredients is a relevant base change: estimate the
        // total kilos again and clear a previous manual adjustment.
        this.recalculateTotalKg(group.controls.number.value, true);
      });
    }

    return group;
  }

  private resetManualSheetForm() {
    this.manualUnitsOverrides.clear();
    this.manualTotalKgOverrides.clear();
    this.sheetMarmitas.clear();
    for (let index = 1; index <= 6; index += 1) {
      this.sheetMarmitas.push(this.buildMarmitaGroup(index));
    }
    this.manualSheetForm.patchValue({
      lotNumber: this.autoManualLot(),
      productionDate: new Date().toISOString().slice(0, 10),
      commitmentReference: '',
      operatorNotes: '',
      packaging: {
        presentationKg: 20,
        cunetes: 0,
        cajas: 0,
        rendimiento: DEFAULT_SHEET_YIELD_PERCENT,
      },
    });
  }

  public openNewManualSheetOrder() {
    if (!this.isAdmin() && !this.api.isSupervisorPlanta()) {
      this.api.showToast(
        'Solo el Administrador puede crear planillas manuales.',
        'error'
      );
      return;
    }
    this.resetManualSheetForm();
    this.isManualSheetModalOpen.set(true);
  }

  public closeManualSheetModal() {
    this.isManualSheetModalOpen.set(false);
  }

  public async submitManualSheetOrder() {
    if (!this.canCreateManualSheet()) {
      this.api.showToast(
        'No tiene permiso para guardar planillas manuales.',
        'error'
      );
      return;
    }
    if (this.manualSheetForm.invalid) {
      this.manualSheetForm.markAllAsTouched();
      return;
    }
    const value = this.manualSheetForm.getRawValue();
    if (this.positive(value.packaging.cunetes) + this.positive(value.packaging.cajas) <= 0) {
      this.api.showToast(
        'Registre al menos un cuñete o una caja como cantidad obtenida.',
        'error'
      );
      return;
    }

    this.isSavingManualSheet.set(true);
    try {
      await this.api.createManualSheetProductionOrder({
        lotNumber: value.lotNumber,
        productionDate: value.productionDate,
        marmitas: value.marmitas.map((row) => ({
          ...row,
          number: Number(row.number),
          basketsBase: this.positive(row.basketsBase),
          guavaKg: this.positive(row.guavaKg),
          sugarKg: this.positive(row.sugarKg),
          starchKg: this.positive(row.starchKg),
          chemicalG: this.positive(row.chemicalG),
          acidG: this.positive(row.acidG),
          waterGasOil: this.positive(row.waterGasOil),
          obtainedUnits: this.positive(row.obtainedUnits),
          totalKg: this.positive(row.totalKg),
        })),
        packaging: {
          presentationKg: this.positive(value.packaging.presentationKg),
          cunetes: this.positive(value.packaging.cunetes),
          cajas: this.positive(value.packaging.cajas),
          rendimiento: this.positive(value.packaging.rendimiento),
        },
        commitmentReference: value.commitmentReference || undefined,
        operatorNotes: value.operatorNotes || undefined,
        // Only the administrator may consume stock. Supervisors register the
        // sheet and leave it in draft for later processing.
        processImmediately: this.isAdmin(),
      });
      this.closeManualSheetModal();
    } catch {
      // The API service already reports the error; keep the modal open so the
      // operator can correct the sheet without losing the captured data.
    } finally {
      this.isSavingManualSheet.set(false);
    }
  }

  public openManualSheetDetails(order: ProductionOrder) {
    this.selectedManualSheetOrder.set(order);
    this.isManualSheetDetailModalOpen.set(true);
  }

  public closeManualSheetDetails() {
    this.isManualSheetDetailModalOpen.set(false);
    this.selectedManualSheetOrder.set(null);
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
    if (!this.api.hasPermission('production', 'canEdit')) {
      this.api.showToast('No tiene permiso para crear órdenes manuales.', 'error');
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
