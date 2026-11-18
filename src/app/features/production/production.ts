import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, FormArray, Validators} from '@angular/forms';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {
  RecipeBOM,
  ProductionOrder,
  ProductionSheetPresentationLine,
  PresentationType,
} from '../../core/models/erp.models';
import {VeCurrencyPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';
import {
  DEFAULT_SHEET_YIELD_PERCENT,
  PresentationWeight,
  calculateObtainedUnits,
  calculatePackagingEstimate,
  calculatePresentationsEstimate,
  calculateSheetMatrixTotals,
  calculateTotalKgFromIngredients,
  requiresManualPresentationUnits,
  sumPresentationUnits,
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
  /** Marmita highlighted in the sheet matrix (1..6). */
  public activeSheetMarmita = signal<number>(1);
  public editingManualOrderId = signal<string | null>(null);
  public isRecipeDetailModalOpen = signal<boolean>(false);
  public selectedRecipe = signal<RecipeBOM | null>(null);
  public isOrderDetailsModalOpen = signal<boolean>(false);
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
        presentationUnits: FormArray<
          FormGroup<{
            presentationId: FormControl<string>;
            units: FormControl<number>;
          }>
        >;
      }>
    >([]),
    packaging: new FormGroup({
      presentations: new FormArray<
        FormGroup<{
          id: FormControl<string>;
          label: FormControl<string>;
          presentation: FormControl<PresentationType>;
          presentationKg: FormControl<number>;
        }>
      >([]),
      // Legacy fields kept in sync for older consumers and server schemas.
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
    this.manualSheetForm.controls.packaging.controls.presentations.valueChanges.subscribe(
      () => {
        this.syncPresentationUnits();
        this.syncLegacyPackaging();
        this.recalculateAllObtainedUnits();
      }
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
  /** Master inherits every administrative production action. */
  public isAdminOrMaster = computed(
    () => this.isAdmin() || this.api.isMaster()
  );
  /** Admin, master and plant supervisor may register LOTE 72 manual sheets. */
  public canCreateManualSheet = computed(
    () => this.isAdminOrMaster() || this.api.isSupervisorPlanta()
  );
  public pendingSalesOrders = computed(() => {
    return this.api.salesOrders().filter(s => s.status === 'pendiente' || s.status === 'en_produccion');
  });

  public get manualFormulas() {
    return this.manualOrderForm.controls.formulas;
  }

  /** Presentation types available to the manual sheet. */
  public readonly presentationOptions: {
    value: PresentationType;
    label: string;
    kg: number;
  }[] = [
    { value: 'pote_20kg', label: 'Cuñete / Pote 20 kg', kg: 20 },
    { value: 'caja_20kg', label: 'Caja 20 kg', kg: 20 },
    { value: 'pequena_250g', label: 'Frasco 250 g', kg: 0.25 },
    { value: 'grande_1000g', label: 'Frasco 1000 g', kg: 1 },
    { value: 'galon_5kg', label: 'Galón 5 kg', kg: 5 },
    { value: 'balde_15kg', label: 'Balde 15 kg', kg: 15 },
    { value: 'otra', label: 'Otra presentación', kg: 1 },
  ];

  public get sheetMarmitas() {
    return this.manualSheetForm.controls.marmitas;
  }

  public get sheetPresentations() {
    return this.manualSheetForm.controls.packaging.controls.presentations;
  }

  /** Presentation lines currently configured in the sheet. */
  public sheetPresentationLines = computed<PresentationWeight[]>(() => {
    this.sheetRevision();
    return this.sheetPresentations.getRawValue().map((line) => ({
      id: line.id,
      presentationKg: this.positive(line.presentationKg),
    }));
  });

  /** True when the operator must capture units per presentation manually. */
  public hasMultiplePresentations = computed(() =>
    requiresManualPresentationUnits(this.sheetPresentationLines())
  );

  public presentationLabel(line: { label?: string; presentation?: PresentationType }): string {
    return (
      line.label ||
      this.presentationOptions.find((option) => option.value === line.presentation)
        ?.label ||
      'Presentación'
    );
  }

  /** Row of the presentation summary for a configured line. */
  public presentationRowFor(id: string) {
    return this.sheetPresentationRows().find((line) => line.id === id);
  }

  /** Display label of a persisted presentation line. */
  public sheetPresentationName(
    presentations: ProductionSheetPresentationLine[] | undefined,
    id: string
  ): string {
    const line = presentations?.find((item) => item.id === id);
    return line ? this.presentationLabel(line) : id;
  }

  private newPresentationId(): string {
    return `pres-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
  }

  private buildPresentationGroup(data: {
    id: string;
    label: string;
    presentation: PresentationType;
    presentationKg: number;
  }) {
    const group = new FormGroup({
      id: new FormControl<string>(data.id, { nonNullable: true }),
      label: new FormControl<string>(data.label, { nonNullable: true }),
      presentation: new FormControl<PresentationType>(data.presentation, {
        nonNullable: true,
        validators: [Validators.required],
      }),
      presentationKg: new FormControl<number>(data.presentationKg, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(0.01)],
      }),
    });
    group.controls.presentation.valueChanges.subscribe((value) => {
      const option = this.presentationOptions.find((item) => item.value === value);
      if (!option) return;
      group.controls.label.setValue(option.label, { emitEvent: false });
      group.controls.presentationKg.setValue(option.kg, { emitEvent: false });
      this.syncLegacyPackaging();
      this.recalculateAllObtainedUnits();
      this.sheetRevision.update((revision) => revision + 1);
    });
    group.controls.presentationKg.valueChanges.subscribe(() => {
      this.syncLegacyPackaging();
      this.recalculateAllObtainedUnits();
      this.sheetRevision.update((revision) => revision + 1);
    });
    return group;
  }

  /** Adds another presentation to the sheet. */
  public addSheetPresentation(): void {
    if (this.sheetPresentations.length >= 20) {
      this.api.showToast(
        'La planilla admite como máximo 20 presentaciones.',
        'error'
      );
      return;
    }
    const used = new Set(
      this.sheetPresentations.getRawValue().map((line) => line.presentation)
    );
    const option =
      this.presentationOptions.find((item) => !used.has(item.value)) ??
      this.presentationOptions[0];
    this.sheetPresentations.push(
      this.buildPresentationGroup({
        id: this.newPresentationId(),
        label: option.label,
        presentation: option.value,
        presentationKg: option.kg,
      })
    );
    this.syncPresentationUnits();
    this.syncLegacyPackaging();
    this.sheetRevision.update((value) => value + 1);
  }

  /** Removes a presentation, keeping at least one line on the sheet. */
  public removeSheetPresentation(index: number): void {
    if (this.sheetPresentations.length <= 1) {
      this.api.showToast(
        'La planilla debe conservar al menos una presentación.',
        'error'
      );
      return;
    }
    this.sheetPresentations.removeAt(index);
    this.syncPresentationUnits();
    this.syncLegacyPackaging();
    this.recalculateAllObtainedUnits();
    this.sheetRevision.update((value) => value + 1);
  }

  /** Keeps every marmita's manual unit distribution aligned with the lines. */
  private syncPresentationUnits(): void {
    const lines = this.sheetPresentations.getRawValue();
    for (const row of this.sheetMarmitas.controls) {
      const array = row.controls.presentationUnits;
      const current = new Map(
        array.getRawValue().map((item) => [item.presentationId, item.units])
      );
      array.clear({ emitEvent: false });
      for (const line of lines) {
        array.push(
          new FormGroup({
            presentationId: new FormControl<string>(line.id, {
              nonNullable: true,
            }),
            units: new FormControl<number>(this.positive(current.get(line.id)), {
              nonNullable: true,
              validators: [Validators.min(0)],
            }),
          }),
          { emitEvent: false }
        );
      }
    }
    this.sheetRevision.update((value) => value + 1);
  }

  /** Keeps the legacy single-presentation fields coherent with the lines. */
  private syncLegacyPackaging(): void {
    const lines = this.sheetPresentations.getRawValue();
    const rows = this.sheetMarmitas.getRawValue();
    const unitsFor = (presentation: PresentationType) => {
      const ids = lines
        .filter((line) => line.presentation === presentation)
        .map((line) => line.id);
      return rows.reduce(
        (sum, row) =>
          sum +
          ids.reduce(
            (lineSum, id) =>
              lineSum +
              this.positive(
                row.presentationUnits?.find(
                  (item) => item.presentationId === id
                )?.units
              ),
            0
          ),
        0
      );
    };
    const first = lines[0];
    this.manualSheetForm.controls.packaging.patchValue(
      {
        presentationKg: first ? this.positive(first.presentationKg) : 20,
        cunetes: this.round(unitsFor('pote_20kg'), 2),
        cajas: this.round(unitsFor('caja_20kg'), 2),
      },
      { emitEvent: false }
    );
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
    const multi = this.hasMultiplePresentations();
    return rows.reduce(
      (acc, row) => ({
        guavaKg: acc.guavaKg + this.positive(row.guavaKg),
        sugarKg: acc.sugarKg + this.positive(row.sugarKg),
        starchKg: acc.starchKg + this.positive(row.starchKg),
        chemicalG: acc.chemicalG + this.positive(row.chemicalG),
        acidG: acc.acidG + this.positive(row.acidG),
        waterGasOil: acc.waterGasOil + this.positive(row.waterGasOil),
        obtainedUnits:
          acc.obtainedUnits +
          (multi
            ? sumPresentationUnits(row.presentationUnits || [])
            : this.positive(row.obtainedUnits)),
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

  private round(value: number, decimals = 2): number {
    return Number.isFinite(value) ? Number(value.toFixed(decimals)) : 0;
  }

  /** Unit valuation rate (USD) of a finished good for the given presentation. */
  public sheetUnitRateFor(presentation: PresentationType): number {
    const guava = this.api
      .finishedGoods()
      .filter((item) => item.flavor === 'Guayaba Criolla');
    return guava.find((item) => item.presentation === presentation)?.baseCost ?? 0;
  }

  /** Packaging material cost (USD per unit) for the given presentation. */
  public sheetPackagingUnitCostFor(presentation: PresentationType): number {
    switch (presentation) {
      case 'pote_20kg':
        return this.materialRate(['rm-17'], [/(cu[nñ]ete|pote).*20\s*kg/i]);
      case 'caja_20kg':
        return this.materialRate(['rm-18'], [/caja.*20\s*kg/i]);
      case 'pequena_250g':
        return this.materialRate([], [/frasco.*250/i, /envase.*250/i]);
      case 'grande_1000g':
        return this.materialRate(
          [],
          [/frasco.*1000/i, /frasco.*1\s*kg/i, /envase.*1000/i]
        );
      case 'galon_5kg':
        return this.materialRate([], [/gal[oó]n.*5/i]);
      case 'balde_15kg':
        return this.materialRate([], [/balde.*15/i]);
      default:
        return 0;
    }
  }

  public sheetUnitRates = computed(() => ({
    cunete: this.sheetUnitRateFor('pote_20kg'),
    caja: this.sheetUnitRateFor('caja_20kg'),
  }));

  /** Materials cost of the captured ingredients (USD). */
  public sheetMaterialsCost = computed(() => {
    this.sheetRevision();
    const totals = this.sheetTotals();
    return Number(
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
  });

  /** Presentation lines with the units captured across the six marmitas. */
  public sheetPresentationRows = computed(() => {
    this.sheetRevision();
    const lines = this.sheetPresentations.getRawValue();
    const rows = this.sheetMarmitas.getRawValue();
    const multi = this.hasMultiplePresentations();
    return lines.map((line) => {
      const units = multi
        ? rows.reduce(
            (sum, row) =>
              sum +
              this.positive(
                row.presentationUnits?.find(
                  (item) => item.presentationId === line.id
                )?.units
              ),
            0
          )
        : rows.reduce(
            (sum, row) => sum + this.positive(row.obtainedUnits),
            0
          );
      return {
        id: line.id,
        label: this.presentationLabel(line),
        presentation: line.presentation,
        presentationKg: this.positive(line.presentationKg),
        units: this.round(units, 2),
      };
    });
  });

  /**
   * Matrix totals: one row per marmita, one column per presentation, plus the
   * per-marmita kilos balance and the grand total.
   */
  public sheetMatrix = computed(() => {
    this.sheetRevision();
    return calculateSheetMatrixTotals(
      this.sheetMarmitas.getRawValue().map((row) => ({
        number: Number(row.number),
        totalKg: this.positive(row.totalKg),
        obtainedUnits: this.positive(row.obtainedUnits),
        presentationUnits: row.presentationUnits,
      })),
      this.sheetPresentationLines()
    );
  });

  /** Marks one marmita as active in the sheet and scrolls its main row into view. */
  public setActiveSheetMarmita(number: number): void {
    this.activeSheetMarmita.set(number);
    if (typeof document === 'undefined') return;
    const row = document.getElementById(`sheet-marmita-row-${number}`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Units of one presentation for a marmita, used by the editable summary. */
  public sheetCellUnits(marmitaNumber: number, presentationIndex: number): number {
    const row = this.sheetMarmitas.controls.find(
      (control) => control.controls.number.value === marmitaNumber
    );
    return this.positive(
      row?.controls.presentationUnits.at(presentationIndex)?.controls.units.value
    );
  }

  /** Edits the units of one presentation for the active marmita. */
  public setSheetCellUnits(
    marmitaNumber: number,
    presentationIndex: number,
    value: unknown
  ): void {
    const row = this.sheetMarmitas.controls.find(
      (control) => control.controls.number.value === marmitaNumber
    );
    const control = row?.controls.presentationUnits.at(presentationIndex)?.controls
      .units;
    if (!control) return;
    control.setValue(this.positive(value));
    control.markAsDirty();
  }

  public sheetCosts = computed(() => {
    this.sheetRevision();
    const totals = this.sheetTotals();
    const materialsCost = this.sheetMaterialsCost();
    const inputCostPerKg =
      totals.totalKg > 0 ? materialsCost / totals.totalKg : 0;

    const presentations = this.sheetPresentationRows().map((line) => {
      const packagingUnitCost = this.sheetPackagingUnitCostFor(line.presentation);
      let unitRate = this.sheetUnitRateFor(line.presentation);
      if (unitRate <= 0) {
        unitRate = this.round(
          inputCostPerKg * line.presentationKg + packagingUnitCost,
          2
        );
      }
      return {
        ...line,
        unitRate: this.round(unitRate, 2),
        packagingUnitCost: this.round(packagingUnitCost, 2),
        productionValue: this.round(line.units * unitRate, 2),
        packagingCost: this.round(line.units * packagingUnitCost, 2),
      };
    });

    const packagingCost = this.round(
      presentations.reduce((sum, line) => sum + line.packagingCost, 0),
      2
    );
    const productionValue = this.round(
      presentations.reduce((sum, line) => sum + line.productionValue, 0),
      2
    );
    const cuneteLine = presentations.find(
      (line) => line.presentation === 'pote_20kg'
    );
    const cajaLine = presentations.find(
      (line) => line.presentation === 'caja_20kg'
    );

    return {
      materialsCost,
      packagingCost,
      totalCost: this.round(materialsCost + packagingCost, 2),
      cuneteValue: cuneteLine?.productionValue ?? 0,
      cajaValue: cajaLine?.productionValue ?? 0,
      productionValue,
      cunetePackagingUnitCost: cuneteLine?.packagingUnitCost ?? 0,
      cajaPackagingUnitCost: cajaLine?.packagingUnitCost ?? 0,
      cuneteRate: cuneteLine?.unitRate ?? 0,
      cajaRate: cajaLine?.unitRate ?? 0,
      cunetes: cuneteLine?.units ?? 0,
      cajas: cajaLine?.units ?? 0,
      units: this.round(
        presentations.reduce((sum, line) => sum + line.units, 0),
        2
      ),
      presentations,
    };
  });

  /** Units represented by the captured kilos versus the units assigned to packaging. */
  public sheetPackagingEstimate = computed(() => {
    this.sheetRevision();
    const totals = this.sheetTotals();
    const lines = this.sheetPresentationRows();

    if (lines.length > 1) {
      const presentations = calculatePresentationsEstimate(
        totals.totalKg,
        lines
      );
      const assignedUnits = this.round(
        presentations.reduce((sum, line) => sum + line.units, 0),
        2
      );
      const assignedKg = this.round(
        presentations.reduce((sum, line) => sum + line.assignedKg, 0),
        2
      );
      // With several presentations the kilos are shared, so the meaningful
      // comparison is captured kilos versus kilos represented by the units.
      const differenceKg = this.round(assignedKg - totals.totalKg, 2);
      return {
        presentationKg: lines[0]?.presentationKg ?? 0,
        estimatedUnits: assignedUnits,
        assignedUnits,
        difference: differenceKg,
        missingUnits: differenceKg < 0 ? this.round(-differenceKg, 2) : 0,
        excessUnits: differenceKg > 0 ? differenceKg : 0,
        assignedKg,
        totalKg: this.round(totals.totalKg, 2),
        cunetesKg: this.round(
          presentations
            .filter((_, index) => lines[index]?.presentation === 'pote_20kg')
            .reduce((sum, line) => sum + line.assignedKg, 0),
          2
        ),
        cajasKg: this.round(
          presentations
            .filter((_, index) => lines[index]?.presentation === 'caja_20kg')
            .reduce((sum, line) => sum + line.assignedKg, 0),
          2
        ),
        presentations,
      };
    }

    const line = lines[0];
    const legacy = calculatePackagingEstimate(
      totals.totalKg,
      line?.presentationKg ?? 0,
      line?.units ?? 0,
      0
    );
    return {
      ...legacy,
      presentations: calculatePresentationsEstimate(totals.totalKg, lines),
    };
  });

  public canSubmitManualSheet(): boolean {
    return (
      this.manualSheetForm.valid &&
      this.sheetCosts().units > 0 &&
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
    const lines = this.sheetPresentationLines();
    if (lines.length === 0) return;

    // With several presentations the operator captures the units manually and
    // the marmita total is simply their sum.
    if (requiresManualPresentationUnits(lines)) {
      const units = sumPresentationUnits(
        row.controls.presentationUnits.getRawValue()
      );
      if (row.controls.obtainedUnits.value !== units) {
        row.controls.obtainedUnits.setValue(units, { emitEvent: false });
        this.sheetRevision.update((value) => value + 1);
      }
      return;
    }

    if (!force && this.manualUnitsOverrides.has(number)) return;

    if (force && this.manualUnitsOverrides.delete(number)) {
      this.sheetRevision.update((value) => value + 1);
    }
    const units = calculateObtainedUnits(
      row.controls.totalKg.value,
      lines[0].presentationKg
    );
    if (row.controls.obtainedUnits.value !== units) {
      row.controls.obtainedUnits.setValue(units, { emitEvent: false });
      this.sheetRevision.update((value) => value + 1);
    }
    // Keep the single presentation line aligned with the derived units.
    const array = row.controls.presentationUnits;
    if (array.length === 1 && array.at(0).controls.units.value !== units) {
      array.at(0).controls.units.setValue(units, { emitEvent: false });
    }
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
      presentationUnits: new FormArray<
        FormGroup<{
          presentationId: FormControl<string>;
          units: FormControl<number>;
        }>
      >([]),
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
      if (!this.hasMultiplePresentations()) {
        const array = group.controls.presentationUnits;
        if (array.length === 1) {
          array
            .at(0)
            .controls.units.setValue(group.controls.obtainedUnits.value, {
              emitEvent: false,
            });
        }
        this.syncLegacyPackaging();
      }
    });
    group.controls.presentationUnits.valueChanges.subscribe(() => {
      // Manual distribution across presentations: refresh the marmita total
      // and the legacy packaging counters derived from it.
      if (this.hasMultiplePresentations()) {
        this.recalculateObtainedUnits(group.controls.number.value, true);
      } else {
        // With a single presentation the matrix cell and "Cant. obtenida" are
        // the same value, so keep both controls aligned.
        const units = this.positive(
          group.controls.presentationUnits.at(0)?.controls.units.value
        );
        this.manualUnitsOverrides.add(group.controls.number.value);
        if (group.controls.obtainedUnits.value !== units) {
          group.controls.obtainedUnits.setValue(units, { emitEvent: false });
        }
      }
      this.syncLegacyPackaging();
      this.sheetRevision.update((value) => value + 1);
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
    this.activeSheetMarmita.set(1);
    this.sheetMarmitas.clear();
    for (let index = 1; index <= 6; index += 1) {
      this.sheetMarmitas.push(this.buildMarmitaGroup(index));
    }
    this.sheetPresentations.clear();
    const defaultPresentation = this.presentationOptions[0];
    this.sheetPresentations.push(
      this.buildPresentationGroup({
        id: this.newPresentationId(),
        label: defaultPresentation.label,
        presentation: defaultPresentation.value,
        presentationKg: defaultPresentation.kg,
      })
    );
    this.manualSheetForm.patchValue(
      {
        lotNumber: this.autoManualLot(),
        productionDate: new Date().toISOString().slice(0, 10),
        commitmentReference: '',
        operatorNotes: '',
        packaging: {
          presentationKg: defaultPresentation.kg,
          cunetes: 0,
          cajas: 0,
          rendimiento: DEFAULT_SHEET_YIELD_PERCENT,
        },
      },
      { emitEvent: false }
    );
    this.syncPresentationUnits();
    this.syncLegacyPackaging();
    this.recalculateAllObtainedUnits();
    this.sheetRevision.update((value) => value + 1);
  }

  public openNewManualSheetOrder() {
    if (!this.canCreateManualSheet()) {
      this.api.showToast(
        'Solo el Administrador, el Master o el Supervisor de Planta puede crear planillas manuales.',
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
    const presentationRows = this.sheetPresentationRows();
    const totalUnits = presentationRows.reduce(
      (sum, line) => sum + this.positive(line.units),
      0
    );
    if (totalUnits <= 0) {
      this.api.showToast(
        'Registre al menos una unidad producida en las presentaciones.',
        'error'
      );
      return;
    }

    this.isSavingManualSheet.set(true);
    try {
      const costLines = this.sheetCosts().presentations;
      const presentations = presentationRows.map((line) => {
        const cost = costLines.find((entry) => entry.id === line.id);
        return {
          id: line.id,
          label: line.label,
          presentation: line.presentation,
          presentationKg: line.presentationKg,
          units: line.units,
          unitRate: cost?.unitRate ?? 0,
          packagingUnitCost: cost?.packagingUnitCost ?? 0,
        };
      });
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
          presentationUnits: row.presentationUnits.map((item) => ({
            presentationId: item.presentationId,
            units: this.positive(item.units),
          })),
        })),
        packaging: {
          presentationKg: this.positive(value.packaging.presentationKg),
          cunetes: this.positive(value.packaging.cunetes),
          cajas: this.positive(value.packaging.cajas),
          rendimiento: this.positive(value.packaging.rendimiento),
          presentations,
        },
        commitmentReference: value.commitmentReference || undefined,
        operatorNotes: value.operatorNotes || undefined,
        // Only admin/master may consume stock. Supervisors register the sheet
        // and leave it in draft for later processing.
        processImmediately: this.isAdminOrMaster(),
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

  /** Abre la planilla manual cuando existe; si no, el detalle de ejecución de la orden. */
  public openProductionOrderDetails(order: ProductionOrder) {
    if (order.manualSheet) {
      this.openManualSheetDetails(order);
      return;
    }
    this.selectedOrderForDetails.set(order);
    this.isOrderDetailsModalOpen.set(true);
  }

  public closeProductionOrderDetails() {
    this.isOrderDetailsModalOpen.set(false);
    this.selectedOrderForDetails.set(null);
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
    if (!this.isAdminOrMaster()) {
      this.api.showToast('Solo el Administrador o el Master puede editar órdenes manuales.', 'error');
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
    if (!this.isAdminOrMaster()) {
      this.api.showToast('Solo el Administrador o el Master puede gestionar órdenes manuales.', 'error');
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
    if (!this.isAdminOrMaster()) {
      this.api.showToast('Solo el Administrador o el Master puede eliminar órdenes manuales.', 'error');
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
    if (!this.isAdminOrMaster()) {
      this.api.showToast('Solo el Administrador o el Master puede procesar órdenes manuales.', 'error');
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
    if (!this.isAdminOrMaster()) {
      this.api.showToast('Solo el Administrador o el Master puede anular órdenes manuales.', 'error');
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

    void exportToPdf(
      'Reporte de Órdenes de Producción y Cocción de Mermeladas (MTO)',
      `Moneda de reporte: ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'} | Tasa de referencia: Bs. ${formatVeNumber(rate, 2)}`,
      headers,
      rows
    );
  }
}
