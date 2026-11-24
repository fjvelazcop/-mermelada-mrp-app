import {ChangeDetectionStrategy, Component, DestroyRef, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ModuleHelpComponent} from '../../shared/components/module-help/module-help';
import {ErpApiService} from '../../core/services/erp-api.service';
import {
  RawMaterial,
  InventoryMovement,
  MaterialCategory,
  UnitOfMeasure,
  DEFAULT_MATERIAL_CATEGORIES,
  DEFAULT_PRESENTATION_TYPES,
  presentationTypeForCode,
  PresentationType,
} from '../../core/models/erp.models';
import {VeCurrencyPipe, VeNumberPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';
import {defaultDocumentRate} from '../../core/utils/exchange-rate.utils';
import {
  VENEZUELAN_BANKS,
  bankLabel,
} from '../../core/data/venezuelan-banks';
import {paymentTermsToDays} from '../accounts-payable/payables.calculations';
import {
  addDaysToIsoDate,
  deriveMaterialSupplierTerms,
} from './material-supplier-terms';

import {AuditLog} from '../../shared/components/audit-log/audit-log';
import {
  SupplierAutocompleteComponent,
  SupplierSelection,
} from '../../shared/components/supplier-autocomplete/supplier-autocomplete';
import {
  filterMaterials,
  filterMovements,
  MovementPaymentLabel,
  movementPaymentLabel,
  MovementTypeFilter,
  normalizeSearchText,
  summarizeMovementsByMaterial,
} from './inventory.filters';
import {
  buildStockConsolidation,
  validateMovementReference,
  type StockConsolidation,
} from './inventory-stock.utils';

export type {
  StockConsolidation,
  StockConsolidationRow,
  StockConsolidationGroup,
} from './inventory-stock.utils';

@Component({
  selector: 'app-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ReactiveFormsModule, VeCurrencyPipe, VeNumberPipe, AuditLog, SupplierAutocompleteComponent, ModuleHelpComponent],
  templateUrl: './inventory.html',
})
export class InventoryComponent {
  public api = inject(ErpApiService);
  private readonly destroyRef = inject(DestroyRef);
  private inventorySyncInFlight = false;

  public readonly todayIso = new Date().toISOString().slice(0, 10);
  public readonly banks = VENEZUELAN_BANKS;
  public readonly bankLabel = bankLabel;
  public readonly purchasePaymentMethods = [
    {value: 'transferencia_bancaria', label: 'Transferencia bancaria'},
    {value: 'pago_movil', label: 'Pago móvil'},
    {value: 'efectivo_usd', label: 'Efectivo USD'},
    {value: 'efectivo_bs', label: 'Efectivo Bs.'},
    {value: 'zelle', label: 'Zelle'},
    {value: 'tarjeta', label: 'Tarjeta'},
  ] as const;

  constructor() {
    const refreshDueDate = () => this.updateDueDate();
    this.movementForm.controls.creditDays.valueChanges.subscribe(refreshDueDate);
    this.movementForm.controls.paymentCondition.valueChanges.subscribe(refreshDueDate);
    this.movementForm.controls.type.valueChanges.subscribe(refreshDueDate);

    const refreshMaterialDueDate = () => this.updateNewMaterialDueDate();
    this.newMaterialForm.controls.creditDays.valueChanges.subscribe(refreshMaterialDueDate);
    this.newMaterialForm.controls.paymentCondition.valueChanges.subscribe(refreshMaterialDueDate);

    // El reporte debe reflejar cambios hechos en la BD aunque ocurran en otra sesión.
    const inventorySync = setInterval(() => void this.refreshInventoryNow(), 30_000);
    this.destroyRef.onDestroy(() => clearInterval(inventorySync));
  }

  /** Refresco ligero del maestro de inventario, sin recargar todo el ERP. */
  public async refreshInventoryNow(notifyOnError = false): Promise<void> {
    if (this.inventorySyncInFlight || (typeof document !== 'undefined' && document.hidden)) {
      return;
    }
    this.inventorySyncInFlight = true;
    try {
      await this.api.refreshInventoryData();
    } catch {
      if (notifyOnError) {
        this.api.showToast('No se pudo sincronizar el inventario; se conservan los datos visibles.', 'error');
      }
    } finally {
      this.inventorySyncInFlight = false;
    }
  }

  /** Vencimiento derivado de los días de crédito capturados. */
  private updateDueDate(): void {
    const value = this.movementForm.getRawValue();
    if (value.type !== 'entrada' || value.paymentCondition !== 'credito') {
      this.movementForm.controls.dueDate.setValue('', {emitEvent: false});
      return;
    }
    const issue = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`);
    issue.setDate(issue.getDate() + Math.max(0, Number(value.creditDays) || 0));
    this.movementForm.controls.dueDate.setValue(issue.toISOString().slice(0, 10), {
      emitEvent: false,
    });
  }

  /** Vencimiento editable del proveedor habitual, derivado de los días de crédito. */
  private updateNewMaterialDueDate(): void {
    const value = this.newMaterialForm.getRawValue();
    if (value.paymentCondition !== 'credito') {
      this.newMaterialForm.patchValue(
        {creditDays: 0, paymentDueDate: ''},
        {emitEvent: false}
      );
      return;
    }
    this.newMaterialForm.controls.paymentDueDate.setValue(
      addDaysToIsoDate(this.todayIso, value.creditDays),
      {emitEvent: false}
    );
  }

  public activeInventoryTab = signal<'stock' | 'movements' | 'audit'>('stock');
  public selectedCategory = signal<string>('all');
  public materialSearch = signal<string>('');
  public isMovementModalOpen = signal<boolean>(false);
  public isNewMaterialModalOpen = signal<boolean>(false);
  public isStockFixModalOpen = signal<boolean>(false);
  public isNewProductModalOpen = signal<boolean>(false);
  public isSavingProduct = signal<boolean>(false);
  public showInactiveProducts = signal<boolean>(false);
  public selectedMaterialForMovement = signal<RawMaterial | null>(null);
  public selectedMaterialForStockFix = signal<RawMaterial | null>(null);

  /** Texto tecleado en el campo nombre del modal de nuevo insumo (para el autocomplete). */
  public materialNameInput = signal<string>('');
  public movementSearch = signal<string>('');
  public movementMaterialFilter = signal<string>('all');
  public movementTypeFilter = signal<MovementTypeFilter>('all');
  public movementDateFrom = signal<string>('');
  public movementDateTo = signal<string>('');
  public expandedMovement = signal<string | null>(null);
  /** Resumen persistente de la última compra registrada (contado o CxP). */
  public lastPurchaseResult = signal<string | null>(null);
  /** Resumen de la última regularización de existencia (solo bitácora). */
  public lastStockFixResult = signal<string | null>(null);

  // Currency view toggle: 'USD' ($) or 'Bs' (Bolívares)
  public currencyMode = signal<'USD' | 'Bs'>('USD');

  // Form for recording Movement (Entrada de compra, merma, salida)
  public movementForm = new FormGroup({
    materialId: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    type: new FormControl<'entrada' | 'salida_produccion' | 'ajuste_merma'>('entrada', {nonNullable: true, validators: [Validators.required]}),
    quantity: new FormControl<number>(10, {nonNullable: true, validators: [Validators.required, Validators.min(0.01)]}),
    costPerUnit: new FormControl<number>(1.25, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    exchangeRateUsed: new FormControl<number>(defaultDocumentRate(this.api.exchangeRates()), {nonNullable: true, validators: [Validators.required, Validators.min(1)]}),
    referenceDoc: new FormControl<string>('', {nonNullable: true}),
    /** Texto visible del selector; no se envía al servidor. */
    supplierQuery: new FormControl<string>('', {nonNullable: true}),
    supplierId: new FormControl<string>('', {nonNullable: true}),
    supplierNameSnapshot: new FormControl<string>('', {nonNullable: true}),
    supplierTaxIdSnapshot: new FormControl<string>('', {nonNullable: true}),
    paymentCondition: new FormControl<'contado' | 'credito'>('contado', {nonNullable: true}),
    paymentMethod: new FormControl<
      'transferencia_bancaria' | 'pago_movil' | 'efectivo_usd' | 'efectivo_bs' | 'zelle' | 'tarjeta'
    >('transferencia_bancaria', {nonNullable: true}),
    bankCode: new FormControl<string>('0134', {nonNullable: true}),
    paymentAccountCode: new FormControl<string>('1.01.02', {nonNullable: true}),
    paymentReference: new FormControl<string>('', {nonNullable: true}),
    creditDays: new FormControl<number>(30, {nonNullable: true}),
    dueDate: new FormControl<string>('', {nonNullable: true}),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  /** Regularización de conteo físico: no genera movimiento, CxP ni asiento. */
  public stockFixForm = new FormGroup({
    currentStock: new FormControl<number>(0, {nonNullable: true}),
    targetStock: new FormControl<number>(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    reason: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3)],
    }),
    referenceDoc: new FormControl<string>('', {nonNullable: true}),
  });

  /** Alta de productos terminados en borrador/prueba #13 (stock inicial cero). */
  public newProductForm = new FormGroup({
    code: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(60)],
    }),
    flavor: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    presentationCode: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    presentationLabel: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(120)],
    }),
    weightGrams: new FormControl<number>(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1), Validators.max(1_000_000)],
    }),
    baseCost: new FormControl<number>(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    suggestedWholesalePrice: new FormControl<number>(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    suggestedRetailPrice: new FormControl<number>(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    suggestedSpecialPrice: new FormControl<number>(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    minStock: new FormControl<number>(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    notes: new FormControl<string>('Borrador/prueba #13 – pendiente de validación con el contador.', {
      nonNullable: true,
      validators: [Validators.maxLength(2000)],
    }),
  });

  // Form for New Raw Material
  public newMaterialForm = new FormGroup({
    code: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    name: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    category: new FormControl<MaterialCategory>('fruta', {nonNullable: true, validators: [Validators.required]}),
    currentStock: new FormControl<number>(50, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    minStock: new FormControl<number>(20, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    unit: new FormControl<UnitOfMeasure>('kg', {nonNullable: true, validators: [Validators.required]}),
    costPerUnit: new FormControl<number>(1.00, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    /** Razón social visible; se mantiene por compatibilidad con listados y reportes. */
    supplier: new FormControl<string>('', {nonNullable: true}),
    supplierId: new FormControl<string>('', {nonNullable: true}),
    supplierTaxId: new FormControl<string>('', {nonNullable: true}),
    paymentCondition: new FormControl<'contado' | 'credito'>('contado', {nonNullable: true}),
    creditDays: new FormControl<number>(0, {nonNullable: true, validators: [Validators.min(0), Validators.max(365)]}),
    paymentDueDate: new FormControl<string>('', {nonNullable: true}),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  /** Categorías activas del catálogo administrable; fallback para datos no migrados. */
  public materialCategories = computed(() => {
    const catalog = this.api.materialCategories().filter((category) => category.active);
    return catalog.length ? catalog : DEFAULT_MATERIAL_CATEGORIES.filter((c) => c.active);
  });

  public categoryLabel(code: string): string {
    return (
      this.materialCategories().find((category) => category.code === code)?.label || code
    );
  }

  public defaultMaterialCategory(): MaterialCategory {
    return this.materialCategories()[0]?.code || 'fruta';
  }

  public filteredMaterials = computed(() =>
    filterMaterials(this.api.rawMaterials(), {
      search: this.materialSearch(),
      category: this.selectedCategory(),
      categoryLabels: Object.fromEntries(
        this.materialCategories().map((category) => [category.code, category.label])
      ),
    })
  );

  /** Sugerencias de nombres existentes para el autocomplete del modal. */
  public materialNameSuggestions = computed(() => {
    const term = normalizeSearchText(this.materialNameInput());
    if (!term) return [];
    return this.api
      .rawMaterials()
      .filter((material) => normalizeSearchText(material.name).includes(term))
      .slice(0, 8);
  });

  /** Coincidencia exacta (ignorando tildes y mayúsculas) para avisar de duplicados. */
  public exactMaterialMatch = computed(() => {
    const term = normalizeSearchText(this.materialNameInput());
    if (!term) return null;
    return (
      this.api
        .rawMaterials()
        .find((material) => normalizeSearchText(material.name) === term) || null
    );
  });

  public finishedGoods = computed(() => this.api.finishedGoods());
  /** El inventario muestra inactivos solo cuando el usuario lo solicita. */
  public visibleFinishedGoods = computed(() => {
    const all = this.finishedGoods();
    return this.showInactiveProducts()
      ? all
      : all.filter((item) => item.status !== 'inactivo');
  });

  public productPresentationOptions = computed<
    { code: string; label: string; kg: number; value: PresentationType }[]
  >(() => {
    const catalog = this.api
      .presentationTypes()
      .filter((item) => item.active && item.code !== 'otra');
    const source = catalog.length ? catalog : DEFAULT_PRESENTATION_TYPES;
    return [
      ...source.map((item) => ({
        code: item.code,
        label: item.label,
        kg: item.weightGrams / 1000,
        value: presentationTypeForCode(item.code),
      })),
      {code: 'otra', label: 'Otra presentación', kg: 1, value: 'otra' as PresentationType},
    ];
  });

  public movements = computed(() => this.api.inventoryMovements());

  /** Condición de pago y CxP mostradas en el historial de movimientos. */
  public paymentLabel(movement: InventoryMovement): MovementPaymentLabel {
    return movementPaymentLabel(movement);
  }

  public filteredMovements = computed(() =>
    filterMovements(this.movements(), {
      search: this.movementSearch(),
      materialId: this.movementMaterialFilter(),
      type: this.movementTypeFilter(),
      dateFrom: this.movementDateFrom(),
      dateTo: this.movementDateTo(),
    })
  );

  public movementSummaries = computed(() =>
    summarizeMovementsByMaterial(this.filteredMovements())
  );

  /** Consolidado auditable del maestro completo, sin depender de los filtros de la tabla. */
  public stockConsolidation = computed<StockConsolidation>(() => {
    const categories = this.materialCategories();
    return buildStockConsolidation({
      materials: this.api.rawMaterials(),
      movements: this.api.inventoryMovements(),
      exchangeRate: this.api.exchangeRates()?.currentUsd || 48.35,
      todayIso: this.todayIso,
      categoryLabel: (code) =>
        categories.find((category) => category.code === code)?.label || code,
    });
  });

  public inventoryAuditCount = computed(() =>
    this.api.auditLogs().filter(l => l.module === 'inventario').length
  );

  public openNewProductModal() {
    const first = this.productPresentationOptions()[0];
    this.newProductForm.reset({
      code: `PT-${Date.now().toString(36).toUpperCase()}`,
      flavor: '',
      presentationCode: first?.code || '',
      presentationLabel: first?.label || '',
      weightGrams: first?.kg ? Math.round(first.kg * 1000) : 1000,
      baseCost: 0,
      suggestedWholesalePrice: 0,
      suggestedRetailPrice: 0,
      suggestedSpecialPrice: 0,
      minStock: 0,
      notes: 'Borrador/prueba #13 – pendiente de validación con el contador.',
    });
    this.isNewProductModalOpen.set(true);
  }

  public closeNewProductModal() {
    this.isNewProductModalOpen.set(false);
    this.isSavingProduct.set(false);
  }

  public onProductPresentationChange(code: string) {
    const option = this.productPresentationOptions().find((item) => item.code === code);
    if (!option) return;
    this.newProductForm.patchValue({
      presentationLabel: option.label,
      weightGrams: Math.round(option.kg * 1000),
    });
  }

  public async saveNewProduct() {
    if (this.newProductForm.invalid) {
      this.newProductForm.markAllAsTouched();
      return;
    }
    const v = this.newProductForm.getRawValue();
    this.isSavingProduct.set(true);
    try {
      await this.api.addFinishedGood({
        code: v.code.trim(),
        flavor: v.flavor.trim(),
        presentation: presentationTypeForCode(v.presentationCode),
        presentationLabel: v.presentationLabel.trim(),
        weightGrams: Number(v.weightGrams),
        stockUnits: 0,
        reservedUnits: 0,
        availableUnits: 0,
        baseCost: Number(v.baseCost),
        suggestedWholesalePrice: Number(v.suggestedWholesalePrice),
        suggestedRetailPrice: Number(v.suggestedRetailPrice),
        suggestedSpecialPrice: Number(v.suggestedSpecialPrice),
        minStock: Number(v.minStock),
        notes: v.notes.trim() || undefined,
        status: 'borrador',
      });
      this.closeNewProductModal();
    } catch {
      // Toast handled by the API service.
    } finally {
      this.isSavingProduct.set(false);
    }
  }

  public async setProductStatus(id: string, code: string, status: 'activo' | 'inactivo') {
    const message =
      status === 'inactivo'
        ? `¿Dar de baja el producto ${code}? Dejará de aparecer en Ventas y en la planilla.`
        : `¿Activar el producto ${code} para que pueda venderse?`;
    if (!window.confirm(message)) return;
    try {
      await this.api.updateFinishedGood(id, {status});
    } catch {
      // Toast handled by the API service.
    }
  }

  public openMovementModal(mat?: RawMaterial) {
    const activeRate = defaultDocumentRate(this.api.exchangeRates());
    if (mat) {
      this.selectedMaterialForMovement.set(mat);
      this.movementForm.patchValue({
        materialId: mat.id,
        costPerUnit: mat.costPerUnit,
        exchangeRateUsed: activeRate,
        quantity: mat.unit === 'g' ? 100 : 10,
        type: 'entrada',
        // El número de factura real lo confirma el usuario; no se inventa.
        referenceDoc: '',
        supplierQuery: '',
        supplierId: '',
        supplierNameSnapshot: '',
        supplierTaxIdSnapshot: '',
      });
    } else {
      this.movementForm.patchValue({
        exchangeRateUsed: activeRate,
        referenceDoc: '',
        supplierQuery: '',
        supplierId: '',
        supplierNameSnapshot: '',
        supplierTaxIdSnapshot: '',
      });
    }
    this.movementForm.patchValue({
      paymentCondition: 'contado',
      paymentMethod: 'transferencia_bancaria',
      bankCode: '0134',
      paymentAccountCode: '1.01.02',
      paymentReference: '',
      creditDays: 30,
      dueDate: '',
      notes: '',
    });
    this.updateDueDate();
    this.isMovementModalOpen.set(true);
  }

  public closeMovementModal() {
    this.isMovementModalOpen.set(false);
    this.selectedMaterialForMovement.set(null);
  }

  public openStockFixModal(material: RawMaterial): void {
    this.stockFixForm.patchValue({
      currentStock: Number(material.currentStock),
      targetStock: Number(material.currentStock),
      reason: '',
      referenceDoc: '',
    });
    this.selectedMaterialForStockFix.set(material);
    this.isStockFixModalOpen.set(true);
  }

  public closeStockFixModal(): void {
    this.isStockFixModalOpen.set(false);
    this.selectedMaterialForStockFix.set(null);
  }

  /** Fija la existencia y deja constancia en la bitácora, sin asiento ni CxP. */
  public async submitStockFix(): Promise<void> {
    if (this.stockFixForm.invalid) return;
    const material = this.selectedMaterialForStockFix();
    if (!material) return;
    const value = this.stockFixForm.getRawValue();
    const previousStock = Number(material.currentStock);
    const targetStock = Number(value.targetStock);
    if (targetStock === previousStock) {
      this.api.showToast('La existencia indicada es igual a la actual; no hay cambios que guardar.', 'info');
      return;
    }
    await this.api.updateRawMaterial(material.id, {currentStock: targetStock});
    await this.api.recordAuditLog({
      module: 'inventario',
      actionType: 'ajuste_existencia',
      title: `Fijar existencia: ${material.name}`,
      description: `${formatVeNumber(previousStock, 2)} → ${formatVeNumber(targetStock, 2)} ${material.unit}. Motivo: ${value.reason.trim()}`,
      severity: 'warning',
      details: {
        targetId: material.id,
        itemName: material.name,
        unit: material.unit,
        previousStock,
        newStock: targetStock,
        reason: value.reason.trim(),
        referenceDoc: value.referenceDoc.trim() || undefined,
      },
    });
    this.lastStockFixResult.set(
      `${material.name} · ${formatVeNumber(previousStock, 2)} → ${formatVeNumber(targetStock, 2)} ${material.unit} · ${value.reason.trim()}`
    );
    this.api.showToast('Existencia fijada y registrada en la bitácora.');
    this.closeStockFixModal();
  }

  /** Guarda la razón social y el RIF/Cédula vigentes al momento del movimiento. */
  public onSupplierSelected(selection: SupplierSelection): void {
    this.movementForm.patchValue({
      supplierId: selection.supplierId,
      supplierNameSnapshot: selection.businessName,
      supplierTaxIdSnapshot: selection.taxId,
    });
    const supplier = this.api.suppliers().find((item) => item.id === selection.supplierId);
    const termsDays = paymentTermsToDays(supplier?.paymentTerms);
    if (termsDays > 0 && this.movementForm.controls.paymentCondition.value === 'credito') {
      this.movementForm.controls.creditDays.setValue(termsDays, {emitEvent: false});
    }
    this.updateDueDate();
  }

  /** Aplica al alta de insumos el proveedor elegido y su condición de pago habitual. */
  public onMaterialSupplierSelected(selection: SupplierSelection): void {
    this.newMaterialForm.patchValue({
      supplier: selection.businessName,
      supplierId: selection.supplierId,
      supplierTaxId: selection.taxId,
    });
    const supplier = this.api.suppliers().find((item) => item.id === selection.supplierId);
    const terms = deriveMaterialSupplierTerms(supplier?.paymentTerms, this.todayIso);
    this.newMaterialForm.patchValue(terms, {emitEvent: false});
  }

  public async submitMovement() {
    if (this.movementForm.invalid) return;
    const v = this.movementForm.getRawValue();
    if (validateMovementReference(v) === 'missing-credit-reference') {
      this.api.showToast(
        'Para una compra a crédito selecciona el proveedor y captura el número de factura.',
        'error'
      );
      return;
    }
    if (v.type === 'entrada' && v.paymentCondition === 'credito') {
      const duplicate = this.api.payables().find(
        (payable) =>
          payable.status !== 'anulada' &&
          payable.supplierId === v.supplierId &&
          payable.invoiceNumber.trim().toLowerCase() === v.referenceDoc.trim().toLowerCase()
      );
      if (duplicate) {
        this.api.showToast(
          `Ya existe la CxP ${duplicate.payableNumber} para este proveedor y factura.`,
          'error'
        );
        return;
      }
    }
    const created = await this.api.recordMovement({
      materialId: v.materialId,
      type: v.type,
      quantity: Number(v.quantity),
      costPerUnit: Number(v.costPerUnit),
      exchangeRateUsed: Number(v.exchangeRateUsed),
      referenceDoc: v.referenceDoc,
      supplierId: v.supplierId || undefined,
      supplierNameSnapshot: v.supplierNameSnapshot || undefined,
      supplierTaxIdSnapshot: v.supplierTaxIdSnapshot || undefined,
      notes: v.notes,
      paymentCondition: v.type === 'entrada' ? v.paymentCondition : undefined,
      paymentMethod: v.type === 'entrada' ? v.paymentMethod : undefined,
      bankCode: v.type === 'entrada' ? v.bankCode : undefined,
      paymentAccountCode:
        v.type === 'entrada' && v.paymentCondition === 'contado'
          ? v.paymentAccountCode
          : undefined,
      paymentReference: v.type === 'entrada' ? v.paymentReference : undefined,
      creditDays:
        v.type === 'entrada' && v.paymentCondition === 'credito'
          ? Number(v.creditDays)
          : undefined,
      dueDate:
        v.type === 'entrada' && v.paymentCondition === 'credito'
          ? v.dueDate
          : undefined,
    });

    if (v.type === 'entrada') {
      const total = Number(v.quantity) * Number(v.costPerUnit);
      const materialName = this.api.rawMaterials().find(m => m.id === v.materialId)?.name || v.materialId;
      const paymentDetail = created.payable
        ? `CxP ${created.payable.payableNumber} por ${formatVeNumber(total, 2)} USD, vencimiento ${created.payable.dueDate}.`
        : `Contado (${v.paymentMethod}) por ${formatVeNumber(total, 2)} USD sin deuda abierta.`;
      this.lastPurchaseResult.set(
        `${materialName} · Doc. ${v.referenceDoc || 'S/R'} · ${v.supplierNameSnapshot || 'Sin proveedor'} · ${paymentDetail}`
      );
    }

    this.closeMovementModal();
  }

  /** Mantiene sincronizados el signal del autocomplete y el FormControl del nombre. */
  public onMaterialNameInput(value: string): void {
    this.materialNameInput.set(value);
    this.newMaterialForm.controls.name.setValue(value);
  }

  /** Precarga el formulario con un insumo existente sin reutilizar su código. */
  public applyMaterialSuggestion(material: RawMaterial): void {
    this.materialNameInput.set(material.name);
    const supplier =
      this.api.suppliers().find((item) => item.id === material.supplierId) ||
      this.api.suppliers().find((item) => item.businessName === material.supplier);
    const terms = material.paymentCondition
      ? {
          paymentCondition: material.paymentCondition,
          creditDays: Number(material.creditDays ?? 0),
          paymentDueDate: material.paymentDueDate || '',
        }
      : deriveMaterialSupplierTerms(supplier?.paymentTerms, this.todayIso);
    this.newMaterialForm.patchValue({
      name: material.name,
      category: material.category,
      unit: material.unit,
      costPerUnit: material.costPerUnit,
      supplier: material.supplier || '',
      supplierId: material.supplierId || supplier?.id || '',
      supplierTaxId: material.supplierTaxId || supplier?.taxId || '',
      ...terms,
      minStock: material.minStock,
      notes: material.notes || '',
    });
  }

  public clearMaterialSearch(): void {
    this.materialSearch.set('');
  }

  public resetMovementFilters(): void {
    this.movementSearch.set('');
    this.movementMaterialFilter.set('all');
    this.movementTypeFilter.set('all');
    this.movementDateFrom.set('');
    this.movementDateTo.set('');
  }

  /** Salta a la pestaña de movimientos con el insumo ya filtrado. */
  public viewMaterialMovements(material: RawMaterial): void {
    this.movementMaterialFilter.set(material.id);
    this.movementSearch.set('');
    this.movementTypeFilter.set('all');
    this.movementDateFrom.set('');
    this.movementDateTo.set('');
    this.activeInventoryTab.set('movements');
  }

  public toggleMovementDetails(id: string): void {
    this.expandedMovement.update((current) => (current === id ? null : id));
  }

  public movementTypeLabel(type: InventoryMovement['type']): string {
    if (type === 'entrada') return 'Compra / Entrada';
    if (type === 'salida_produccion') return 'Consumo Cocción';
    return 'Ajuste Merma';
  }

  public openNewMaterialModal() {
    this.materialNameInput.set('');
    this.newMaterialForm.reset({
      code: 'MP-' + Math.floor(Math.random() * 900 + 100),
      category: this.defaultMaterialCategory(),
      currentStock: 50,
      minStock: 20,
      unit: 'kg',
      costPerUnit: 1.0,
      name: '',
      supplier: '',
      supplierId: '',
      supplierTaxId: '',
      paymentCondition: 'contado',
      creditDays: 0,
      paymentDueDate: '',
      notes: '',
    });
    this.isNewMaterialModalOpen.set(true);
  }

  public closeNewMaterialModal() {
    this.isNewMaterialModalOpen.set(false);
  }

  public async submitNewMaterial() {
    if (this.newMaterialForm.invalid) return;
    const v = this.newMaterialForm.getRawValue();
    if (v.paymentCondition === 'credito' && (!v.paymentDueDate || v.creditDays <= 0)) {
      this.api.showToast('Indica los días de crédito y la fecha de pago del proveedor.', 'error');
      return;
    }
    await this.api.addRawMaterial({
      code: v.code,
      name: v.name,
      category: v.category,
      currentStock: Number(v.currentStock),
      minStock: Number(v.minStock),
      unit: v.unit,
      costPerUnit: Number(v.costPerUnit),
      supplier: v.supplier,
      supplierId: v.supplierId || undefined,
      supplierTaxId: v.supplierTaxId || undefined,
      paymentCondition: v.paymentCondition,
      creditDays: v.paymentCondition === 'credito' ? Number(v.creditDays) : 0,
      paymentDueDate: v.paymentCondition === 'credito' ? v.paymentDueDate : '',
      lastRestockDate: new Date().toISOString().slice(0, 10),
      notes: v.notes,
    });
    this.closeNewMaterialModal();
  }

  // --- EXPORT FUNCTIONALITY: INVENTORY & RAW MATERIALS ---

  public exportStockCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Código',
      'Insumo / Materia Prima',
      'Categoría',
      'Stock Actual',
      'Stock Mínimo',
      'Unidad',
      `Costo Unitario (${isBs ? 'Bs.' : 'USD'})`,
      `Valoración Total (${isBs ? 'Bs.' : 'USD'})`,
      'Tasa del Día Ref. (Bs./USD)',
      'Proveedor',
      'Kilos consolidados',
      'Último movimiento',
      'Documento / CxP',
    ];

    const consolidationById = new Map(
      this.stockConsolidation().byMaterial.map(row => [row.material.id, row])
    );
    const rows = this.filteredMaterials().map(m => {
      const unitCost = isBs ? m.costPerUnit * rate : m.costPerUnit;
      const totalVal = unitCost * m.currentStock;
      const consolidated = consolidationById.get(m.id);
      return [
        m.code,
        m.name,
        m.category,
        formatVeNumber(m.currentStock, m.unit === 'unidades' ? 0 : 2),
        formatVeNumber(m.minStock, m.unit === 'unidades' ? 0 : 2),
        m.unit,
        formatVeNumber(unitCost, 2),
        formatVeNumber(totalVal, 2),
        formatVeNumber(rate, 2),
        m.supplier || 'N/A',
        formatVeNumber(consolidated?.stockKg || 0, 2),
        consolidated?.lastMovement
          ? `${consolidated.lastMovement.date} · ${this.movementTypeLabel(consolidated.lastMovement.type)}`
          : 'S/R',
        consolidated?.lastMovement?.payableNumber
          ? `${consolidated.lastMovement.referenceDoc || 'S/R'} · CxP ${consolidated.lastMovement.payableNumber}`
          : consolidated?.lastMovement?.referenceDoc || 'S/R',
      ];
    });

    exportToCsv(`Inventario_Materia_Prima_${this.currencyMode()}_${new Date().toISOString().slice(0, 10)}`, headers, rows);
  }

  public exportStockExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Código',
      'Insumo / Materia Prima',
      'Categoría',
      'Stock Actual',
      'Stock Mínimo',
      'Unidad',
      `Costo Unitario (${isBs ? 'Bs.' : 'USD'})`,
      `Valoración Total (${isBs ? 'Bs.' : 'USD'})`,
      'Tasa Ref. (Bs.)',
      'Proveedor',
      'Kilos consolidados',
      'Último movimiento',
      'Documento / CxP',
    ];

    const consolidationById = new Map(
      this.stockConsolidation().byMaterial.map(row => [row.material.id, row])
    );
    const rows = this.filteredMaterials().map(m => {
      const unitCost = isBs ? m.costPerUnit * rate : m.costPerUnit;
      const totalVal = unitCost * m.currentStock;
      const consolidated = consolidationById.get(m.id);
      return [
        m.code,
        m.name,
        m.category,
        formatVeNumber(m.currentStock, m.unit === 'unidades' ? 0 : 2),
        formatVeNumber(m.minStock, m.unit === 'unidades' ? 0 : 2),
        m.unit,
        formatVeNumber(unitCost, 2),
        formatVeNumber(totalVal, 2),
        formatVeNumber(rate, 2),
        m.supplier || 'N/A',
        formatVeNumber(consolidated?.stockKg || 0, 2),
        consolidated?.lastMovement
          ? `${consolidated.lastMovement.date} · ${this.movementTypeLabel(consolidated.lastMovement.type)}`
          : 'S/R',
        consolidated?.lastMovement?.payableNumber
          ? `${consolidated.lastMovement.referenceDoc || 'S/R'} · CxP ${consolidated.lastMovement.payableNumber}`
          : consolidated?.lastMovement?.referenceDoc || 'S/R',
      ];
    });

    exportToExcel(
      `Inventario_Materia_Prima_${this.currencyMode()}_${new Date().toISOString().slice(0, 10)}`,
      'Inventario Insumos',
      headers,
      rows,
      {
        tasaCambio: `Bs. ${formatVeNumber(rate, 2)} por USD`,
        moneda: isBs ? 'Bolívares (Bs.)' : 'Dólares Estadounidenses (USD)',
        consolidado: `Total ${formatVeNumber(this.stockConsolidation().totalKg, 2)} kg · ${this.stockConsolidation().byGroup.length} grupos`,
      }
    );
  }

  public exportStockPdf() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Código',
      'Insumo',
      'Cat.',
      'Stock',
      'Mín.',
      'Unidad',
      `Costo (${isBs ? 'Bs.' : '$'})`,
      `Total (${isBs ? 'Bs.' : '$'})`,
      'Kilos consolidados',
      'Último movimiento',
      'Documento / CxP',
    ];

    let grandTotal = 0;
    const consolidationById = new Map(
      this.stockConsolidation().byMaterial.map(row => [row.material.id, row])
    );
    const rows = this.filteredMaterials().map(m => {
      const unitCost = isBs ? m.costPerUnit * rate : m.costPerUnit;
      const totalVal = unitCost * m.currentStock;
      grandTotal += totalVal;
      const consolidated = consolidationById.get(m.id);
      return [
        m.code,
        m.name,
        m.category,
        formatVeNumber(m.currentStock, m.unit === 'unidades' ? 0 : 2),
        formatVeNumber(m.minStock, m.unit === 'unidades' ? 0 : 2),
        m.unit,
        `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(unitCost, 2)}`,
        `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(totalVal, 2)}`,
        formatVeNumber(consolidated?.stockKg || 0, 2),
        consolidated?.lastMovement
          ? `${consolidated.lastMovement.date} · ${this.movementTypeLabel(consolidated.lastMovement.type)}`
          : 'S/R',
        consolidated?.lastMovement?.payableNumber
          ? `${consolidated.lastMovement.referenceDoc || 'S/R'} · CxP ${consolidated.lastMovement.payableNumber}`
          : consolidated?.lastMovement?.referenceDoc || 'S/R',
      ];
    });

    void exportToPdf({
      title: 'Reporte Oficial de Inventario y Materia Prima',
      subtitle: `Valoración consolidada en ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'}`,
      exchangeRateUsed: rate,
      currencyLabel: isBs ? 'Bolívares (Bs.)' : 'Dólares Americanos (USD)',
      headers,
      rows,
      totals: [
        {
          label: `Valoración Total de Insumos (${isBs ? 'Bs.' : 'USD'})`,
          value: `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(grandTotal, 2)}`,
        },
        {
          label: 'Total kilos consolidados',
          value: `${formatVeNumber(this.stockConsolidation().totalKg, 2)} kg`,
        },
        ...this.stockConsolidation().byGroup.map(group => ({
          label: `${group.label} (${group.materialCount} insumos)`,
          value: `${formatVeNumber(group.stockKg, 2)} kg · $ ${formatVeNumber(group.valueUsd, 2)}`,
        })),
      ],
      notes: `Reporte emitido conforme a la tasa oficial del día de Bs. ${formatVeNumber(rate, 2)}. Separador decimal con coma (,) y miles con punto (.). Trazabilidad: ${this.stockConsolidation().byMaterial.filter(row => row.recent).length} insumos con movimiento en los últimos 7 días.`,
    });
  }

  // --- EXPORT MOVEMENTS & PURCHASES ---

  public exportMovementsCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const headers = [
      'Fecha',
      'Insumo',
      'Tipo de Operación',
      'Cantidad',
      `Costo Unitario (${isBs ? 'Bs.' : 'USD'})`,
      `Monto Total (${isBs ? 'Bs.' : 'USD'})`,
      'Tasa del Día Aplicada (Bs./USD)',
      'Documento / Referencia',
      'Proveedor',
      'RIF / Cédula',
      'Condición de pago',
      'CxP generada',
      'Responsable',
    ];

    const rows = this.filteredMovements().map(m => {
      const rate = m.exchangeRateUsed || this.api.exchangeRates()?.currentUsd || 48.35;
      const unitCost = isBs ? (m.costPerUnitBs || m.costPerUnit * rate) : m.costPerUnit;
      const totalCost = isBs ? (m.totalCostBs || m.totalCost * rate) : m.totalCost;
      return [
        m.date,
        m.materialName,
        m.type === 'entrada' ? 'Compra / Entrada' : m.type === 'salida_produccion' ? 'Consumo Cocción' : 'Ajuste / Merma',
        formatVeNumber(m.quantity, 2),
        formatVeNumber(unitCost, 2),
        formatVeNumber(totalCost, 2),
        formatVeNumber(rate, 2),
        m.referenceDoc || 'S/R',
        m.supplierNameSnapshot || '',
        m.supplierTaxIdSnapshot || '',
        m.type === 'entrada'
          ? m.paymentCondition === 'credito'
            ? 'Crédito'
            : 'Contado'
          : 'N/A',
        m.payableNumber || '-',
        m.performedBy,
      ];
    });

    exportToCsv(`Compras_Movimientos_${this.currencyMode()}_${new Date().toISOString().slice(0, 10)}`, headers, rows);
  }

  public exportMovementsExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const headers = [
      'Fecha',
      'Insumo / Materia Prima',
      'Tipo de Operación',
      'Cantidad',
      `Costo Unitario (${isBs ? 'Bs.' : 'USD'})`,
      `Monto Total (${isBs ? 'Bs.' : 'USD'})`,
      'Tasa del Día (Bs./USD)',
      'Documento de Referencia',
      'Proveedor',
      'RIF / Cédula',
      'Condición de pago',
      'CxP generada',
      'Responsable',
    ];

    const rows = this.filteredMovements().map(m => {
      const rate = m.exchangeRateUsed || this.api.exchangeRates()?.currentUsd || 48.35;
      const unitCost = isBs ? (m.costPerUnitBs || m.costPerUnit * rate) : m.costPerUnit;
      const totalCost = isBs ? (m.totalCostBs || m.totalCost * rate) : m.totalCost;
      return [
        m.date,
        m.materialName,
        m.type === 'entrada' ? 'Compra / Entrada' : m.type === 'salida_produccion' ? 'Consumo Cocción' : 'Ajuste / Merma',
        formatVeNumber(m.quantity, 2),
        formatVeNumber(unitCost, 2),
        formatVeNumber(totalCost, 2),
        formatVeNumber(rate, 2),
        m.referenceDoc || 'S/R',
        m.supplierNameSnapshot || '',
        m.supplierTaxIdSnapshot || '',
        m.type === 'entrada'
          ? m.paymentCondition === 'credito'
            ? 'Crédito'
            : 'Contado'
          : 'N/A',
        m.payableNumber || '-',
        m.performedBy,
      ];
    });

    exportToExcel(
      `Compras_Movimientos_${this.currencyMode()}_${new Date().toISOString().slice(0, 10)}`,
      'Historial de Movimientos',
      headers,
      rows,
      {
        moneda: isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)',
        tasaCambio: `Tasa media: Bs. ${formatVeNumber(this.api.exchangeRates()?.currentUsd || 48.35, 2)}`,
      }
    );
  }

  public exportMovementsPdf() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Fecha',
      'Insumo',
      'Tipo',
      'Cantidad',
      `Unitario (${isBs ? 'Bs.' : '$'})`,
      `Total (${isBs ? 'Bs.' : '$'})`,
      'Tasa (Bs.)',
      'Documento',
      'Proveedor',
      'Cond.',
      'CxP',
    ];

    let totalDesembolsos = 0;
    const rows = this.filteredMovements().map(m => {
      const itemRate = m.exchangeRateUsed || rate;
      const unitCost = isBs ? (m.costPerUnitBs || m.costPerUnit * itemRate) : m.costPerUnit;
      const totalCost = isBs ? (m.totalCostBs || m.totalCost * itemRate) : m.totalCost;
      if (m.type === 'entrada') {
        totalDesembolsos += totalCost;
      }
      return [
        m.date,
        m.materialName,
        m.type === 'entrada' ? 'Compra' : m.type === 'salida_produccion' ? 'Cocción' : 'Merma',
        formatVeNumber(m.quantity, 2),
        `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(unitCost, 2)}`,
        `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(totalCost, 2)}`,
        formatVeNumber(itemRate, 2),
        m.referenceDoc || '-',
        m.supplierNameSnapshot || '-',
        m.type === 'entrada'
          ? m.paymentCondition === 'credito'
            ? 'Crédito'
            : 'Contado'
          : 'N/A',
        m.payableNumber || '-',
      ];
    });

    void exportToPdf({
      title: 'Reporte de Compras y Movimientos de Inventario',
      subtitle: `Registro histórico de compras y consumos expresado en ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'}`,
      exchangeRateUsed: rate,
      currencyLabel: isBs ? 'Bolívares (Bs.)' : 'Dólares Americanos (USD)',
      headers,
      rows,
      totals: [
        {
          label: `Total en Compras de Insumos (${isBs ? 'Bs.' : 'USD'})`,
          value: `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(totalDesembolsos, 2)}`,
        },
      ],
      notes: 'Cada operación registra fielmente la tasa de cambio del día en que se ejecutó la compra o despacho de almacén.',
    });
  }
}
