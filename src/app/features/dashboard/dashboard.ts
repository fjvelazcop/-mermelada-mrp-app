import {
  ChangeDetectionStrategy,
  Component,
  inject,
  computed,
  signal,
  PLATFORM_ID,
  viewChild,
  ElementRef,
  effect,
  OnDestroy,
  afterNextRender,
} from '@angular/core';
import {isPlatformBrowser} from '@angular/common';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {VeCurrencyPipe, VeNumberPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';
import {
  MonthlySalesStat,
  WeeklySalesStat,
  InventoryTurnoverStat,
  InventoryTurnoverCategory,
  ProductionStockAlert,
  RecipeFeasibilityResult,
} from '../../core/models/erp.models';
import {DashboardRechartsManager} from './dashboard-charts.renderer';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    ReactiveFormsModule,
    VeCurrencyPipe,
    VeNumberPipe,
  ],
  templateUrl: './dashboard.html',
})
export class DashboardComponent implements OnDestroy {
  public api = inject(ErpApiService);
  private platformId = inject(PLATFORM_ID);
  public readonly isBrowser = isPlatformBrowser(this.platformId);
  public readonly Math = Math;

  public goToProduction() {
    this.api.navigateToTab('production');
  }

  // --- OPERATOR PRODUCTION DASHBOARD STATE & METHODS ---
  public operatorStatusFilter = signal<'pending' | 'en_proceso' | 'planificada' | 'completada' | 'all'>('pending');
  public operatorSearchQuery = signal<string>('');
  public isOperatorCreateModalOpen = signal<boolean>(false);
  public isProcessingOrderId = signal<string | null>(null);

  public operatorNewOrderForm = new FormGroup({
    recipeId: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    batchCount: new FormControl<number>(1, {nonNullable: true, validators: [Validators.required, Validators.min(1)]}),
    salesOrderId: new FormControl<string>('', {nonNullable: true}),
    lotNumber: new FormControl<string>('', {nonNullable: true}),
    operatorNotes: new FormControl<string>('', {nonNullable: true}),
  });

  public operatorInProcessCount = computed(() =>
    this.productionOrders().filter(o => o.status === 'en_proceso').length
  );

  public operatorPlannedCount = computed(() =>
    this.productionOrders().filter(o => o.status === 'planificada').length
  );

  public operatorPendingTotalCount = computed(() =>
    this.productionOrders().filter(o => o.status === 'en_proceso' || o.status === 'planificada').length
  );

  public operatorCompletedCount = computed(() =>
    this.productionOrders().filter(o => o.status === 'completada').length
  );

  public operatorTargetUnitsActive = computed(() =>
    this.productionOrders()
      .filter(o => o.status === 'en_proceso' || o.status === 'planificada')
      .reduce((acc, o) => acc + (o.targetUnits || 0), 0)
  );

  public operatorFilteredOrders = computed(() => {
    const filter = this.operatorStatusFilter();
    const query = this.operatorSearchQuery().trim().toLowerCase();
    let orders = this.productionOrders();

    if (filter === 'pending') {
      orders = orders.filter(o => o.status === 'en_proceso' || o.status === 'planificada');
    } else if (filter === 'en_proceso') {
      orders = orders.filter(o => o.status === 'en_proceso');
    } else if (filter === 'planificada') {
      orders = orders.filter(o => o.status === 'planificada');
    } else if (filter === 'completada') {
      orders = orders.filter(o => o.status === 'completada');
    }

    if (query) {
      orders = orders.filter(o =>
        o.orderNumber.toLowerCase().includes(query) ||
        o.recipeName.toLowerCase().includes(query) ||
        o.flavor.toLowerCase().includes(query) ||
        o.lotNumber.toLowerCase().includes(query) ||
        (o.customerName && o.customerName.toLowerCase().includes(query))
      );
    }

    return [...orders].sort((a, b) => {
      const rank = (s: string) => s === 'en_proceso' ? 0 : s === 'planificada' ? 1 : 2;
      return rank(a.status) - rank(b.status);
    });
  });

  public operatorOrderPreview = computed(() => {
    const recipeId = this.operatorNewOrderForm.controls.recipeId.value;
    const batchCount = this.operatorNewOrderForm.controls.batchCount.value || 1;
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

  public openOperatorCreateModal() {
    const firstRec = this.recipes()[0]?.id || '';
    const autoLot = 'L-COC-' + new Date().toISOString().slice(2, 4) + (new Date().getMonth() + 1).toString().padStart(2, '0') + '-' + Math.floor(Math.random() * 80 + 10);
    this.operatorNewOrderForm.patchValue({
      recipeId: firstRec,
      batchCount: 1,
      salesOrderId: '',
      lotNumber: autoLot,
      operatorNotes: '',
    });
    this.isOperatorCreateModalOpen.set(true);
  }

  public closeOperatorCreateModal() {
    this.isOperatorCreateModalOpen.set(false);
  }

  public async submitOperatorOrder() {
    if (this.operatorNewOrderForm.invalid) return;
    const v = this.operatorNewOrderForm.getRawValue();
    await this.api.createProductionOrder({
      recipeId: v.recipeId,
      batchCount: Number(v.batchCount),
      salesOrderId: v.salesOrderId || undefined,
      lotNumber: v.lotNumber,
      operatorNotes: v.operatorNotes,
    });
    this.closeOperatorCreateModal();
  }

  public async processOperatorOrder(orderId: string) {
    this.isProcessingOrderId.set(orderId);
    try {
      await this.api.processProductionOrder(orderId);
    } finally {
      this.isProcessingOrderId.set(null);
    }
  }

  public getPresentationLabel(presentation: string): string {
    switch (presentation) {
      case 'pequena_250g': return 'Frasco de Vidrio 250g';
      case 'grande_1000g': return 'Frasco Institucional 1000g (1 kg)';
      case 'galon_5kg': return 'Galón Industrial 5kg';
      case 'balde_15kg': return 'Balde Industrial 15kg';
      case 'pote_20kg': return 'Pote / Cuñete Industrial 20kg';
      case 'caja_20kg': return 'Caja Bag-in-Box 20kg';
      default: return presentation;
    }
  }

  // Chart Containers for Recharts
  public salesBarContainer = viewChild<ElementRef<HTMLDivElement>>('salesBarContainer');
  public salesLineContainer = viewChild<ElementRef<HTMLDivElement>>('salesLineContainer');
  public turnoverLineContainer = viewChild<ElementRef<HTMLDivElement>>('turnoverLineContainer');
  public turnoverBarContainer = viewChild<ElementRef<HTMLDivElement>>('turnoverBarContainer');

  private rechartsManager = new DashboardRechartsManager();

  public currencyMode = signal<'USD' | 'Bs'>('USD');
  public metrics = computed(() => this.api.dashboardData());
  public costData = computed(() => this.api.costStructure());
  public rawMaterials = computed(() => this.api.rawMaterials());
  public salesOrders = computed(() => this.api.salesOrders());
  public productionOrders = computed(() => this.api.productionOrders());
  public rates = computed(() => this.api.exchangeRates());

  // Data signals extracted directly from ErpApiService as requested
  public weeklySales = computed<WeeklySalesStat[]>(() => this.api.weeklySales());
  public inventoryTurnover = computed<InventoryTurnoverStat[]>(() => this.api.inventoryTurnover());
  public inventoryTurnoverCategories = computed<InventoryTurnoverCategory[]>(() =>
    this.api.inventoryTurnoverCategories()
  );

  public latestTurnover = computed(() => {
    const list = this.inventoryTurnover();
    return list.length > 0 ? list[list.length - 1] : null;
  });

  public lowStockCount = computed(() => {
    return this.rawMaterials().filter(m => m.currentStock <= m.minStock).length;
  });

  public pendingDeliveriesCount = computed(() => {
    return this.salesOrders().filter(s => s.status === 'listo_despacho' || s.status === 'en_produccion').length;
  });

  public activeBatchesCount = computed(() => {
    return this.productionOrders().filter(p => p.status === 'en_proceso' || p.status === 'planificada').length;
  });

  // --- INVENTORY MINIMUM STOCK & PRODUCTION SUFFICIENCY ALERTS ---
  public productionStockAlerts = computed<ProductionStockAlert[]>(() => this.api.productionStockAlerts());
  public criticalAlertsCount = computed(() => this.productionStockAlerts().filter(a => a.severity === 'critical').length);
  public warningAlertsCount = computed(() => this.productionStockAlerts().filter(a => a.severity === 'warning').length);
  public totalAlertsCount = computed(() => this.productionStockAlerts().length);
  public alertsFilter = signal<'all' | 'critical' | 'warning'>('all');

  public filteredAlerts = computed(() => {
    const filter = this.alertsFilter();
    const alerts = this.productionStockAlerts();
    if (filter === 'critical') return alerts.filter(a => a.severity === 'critical');
    if (filter === 'warning') return alerts.filter(a => a.severity === 'warning');
    return alerts;
  });

  // Interactive Recipe Feasibility Simulator
  public recipes = computed(() => this.api.recipes());
  public selectedRecipeForSim = signal<string>('');
  public simBatchCount = signal<number>(1);

  public simFeasibilityResult = computed<RecipeFeasibilityResult | null>(() => {
    const list = this.recipes();
    if (list.length === 0) return null;
    const selectedId = this.selectedRecipeForSim() || list[0].id;
    return this.api.checkRecipeFeasibility(selectedId, this.simBatchCount());
  });

  // Quick Restock Modal for Alerted Materials
  public isRestockModalOpen = signal<boolean>(false);
  public selectedAlertForRestock = signal<ProductionStockAlert | null>(null);

  public restockForm = new FormGroup({
    quantity: new FormControl<number>(50, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1)],
    }),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  // Modal states for Exchange Rates
  public isEditRateModalOpen = signal<boolean>(false);
  public isRateHistoryModalOpen = signal<boolean>(false);

  // Quick converter state
  public converterAmountUsd = signal<number>(10);
  public selectedConverterTarget = signal<'usd' | 'usdt'>('usd');

  public rateForm = new FormGroup({
    usdRate: new FormControl<number>(48.35, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1)],
    }),
    usdtRate: new FormControl<number>(54.80, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1)],
    }),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  constructor() {
    if (this.isBrowser) {
      afterNextRender(() => {
        this.renderAllRecharts();
      });

      // Reactive update whenever signals (data, rates, currency mode) change
      effect(() => {
        // Track signals
        this.weeklySales();
        this.inventoryTurnover();
        this.inventoryTurnoverCategories();
        this.currencyMode();
        this.rates();

        this.renderAllRecharts();
      });
    }
  }

  public ngOnDestroy() {
    this.rechartsManager.destroy();
  }

  public renderAllRecharts() {
    if (!this.isBrowser) return;

    const weekly = this.weeklySales();
    const turnover = this.inventoryTurnover();
    const turnoverCats = this.inventoryTurnoverCategories();
    const mode = this.currencyMode();
    const rate = this.rates()?.currentUsd || 48.35;

    const sBarEl = this.salesBarContainer()?.nativeElement;
    const sLineEl = this.salesLineContainer()?.nativeElement;
    const tLineEl = this.turnoverLineContainer()?.nativeElement;
    const tBarEl = this.turnoverBarContainer()?.nativeElement;

    if (sBarEl && weekly.length > 0) {
      this.rechartsManager.renderWeeklySalesBar(sBarEl, weekly, mode, rate);
    }
    if (sLineEl && weekly.length > 0) {
      this.rechartsManager.renderWeeklySalesLine(sLineEl, weekly);
    }
    if (tLineEl && turnover.length > 0) {
      this.rechartsManager.renderInventoryTurnoverLine(tLineEl, turnover);
    }
    if (tBarEl && turnoverCats.length > 0) {
      this.rechartsManager.renderInventoryTurnoverBar(tBarEl, turnoverCats);
    }
  }

  public openEditRateModal() {
    const current = this.rates();
    if (current) {
      this.rateForm.patchValue({
        usdRate: current.currentUsd,
        usdtRate: current.currentUsdt,
        notes: '',
      });
    }
    this.isEditRateModalOpen.set(true);
  }

  public closeEditRateModal() {
    this.isEditRateModalOpen.set(false);
  }

  public async submitRateUpdate() {
    if (this.rateForm.invalid) return;
    const v = this.rateForm.getRawValue();
    await this.api.updateExchangeRateManual(
      Number(v.usdRate),
      Number(v.usdtRate),
      v.notes
    );
    this.closeEditRateModal();
  }

  public openRateHistoryModal() {
    this.isRateHistoryModalOpen.set(true);
  }

  public closeRateHistoryModal() {
    this.isRateHistoryModalOpen.set(false);
  }

  public async refreshRatesNow() {
    await this.api.refreshExchangeRates(true);
  }

  public updateConverterAmount(event: Event) {
    const input = event.target as HTMLInputElement;
    const val = parseFloat(input.value);
    this.converterAmountUsd.set(isNaN(val) ? 0 : val);
  }

  // --- EXPORT FUNCTIONALITY: RATES & EXECUTIVE DASHBOARD REPORT ---

  public exportRatesCsv() {
    const headers = [
      'Fecha',
      'Hora',
      'Tasa USD Oficial (Bs.)',
      'Var % USD',
      'Tasa USDT Cripto/P2P (Bs.)',
      'Var % USDT',
      'Fuente / Ventana',
      'Observaciones',
    ];

    const rows = (this.rates()?.history || []).map(r => [
      r.date,
      r.time,
      formatVeNumber(r.usdRate, 2),
      (r.variationUsdPercent ? formatVeNumber(r.variationUsdPercent, 2) : '0,00') + '%',
      formatVeNumber(r.usdtRate, 2),
      (r.variationUsdtPercent ? formatVeNumber(r.variationUsdtPercent, 2) : '0,00') + '%',
      r.source,
      r.notes || '',
    ]);

    exportToCsv(`historico_tasas_venezuela_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  public exportRatesExcel() {
    const headers = [
      'Fecha',
      'Hora',
      'Tasa USD Oficial (Bs.)',
      'Var % USD',
      'Tasa USDT Cripto/P2P (Bs.)',
      'Var % USDT',
      'Fuente / Ventana',
      'Observaciones',
    ];

    const rows = (this.rates()?.history || []).map(r => [
      r.date,
      r.time,
      r.usdRate,
      r.variationUsdPercent || 0,
      r.usdtRate,
      r.variationUsdtPercent || 0,
      r.source,
      r.notes || '',
    ]);

    exportToExcel(`historico_tasas_venezuela_${new Date().toISOString().slice(0, 10)}.xls`, 'Tasas USD USDT', headers, rows);
  }

  public exportRatesPdf() {
    const headers = [
      'Fecha/Hora',
      'USD BCV (Bs.)',
      'Var USD',
      'USDT P2P (Bs.)',
      'Var USDT',
      'Fuente',
    ];

    const rows = (this.rates()?.history || []).map(r => [
      `${r.date} ${r.time}`,
      formatVeNumber(r.usdRate, 2),
      (r.variationUsdPercent ? (r.variationUsdPercent > 0 ? '+' : '') + formatVeNumber(r.variationUsdPercent, 2) : '0,00') + '%',
      formatVeNumber(r.usdtRate, 2),
      (r.variationUsdtPercent ? (r.variationUsdtPercent > 0 ? '+' : '') + formatVeNumber(r.variationUsdtPercent, 2) : '0,00') + '%',
      r.source,
    ]);

    exportToPdf(
      'Registro Diario de Cotización de Divisas (USD y USDT) en Venezuela',
      `Tasa Oficial Actual: Bs. ${formatVeNumber(this.rates()?.currentUsd || 48.35, 2)} | Tasa USDT: Bs. ${formatVeNumber(this.rates()?.currentUsdt || 54.80, 2)}`,
      headers,
      rows
    );
  }

  public exportWeeklySalesCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.rates()?.currentUsd || 48.35;
    const mult = isBs ? rate : 1;
    const curr = isBs ? 'Bs.' : 'USD';

    const headers = [
      'Semana',
      'Fecha Inicio',
      'Fecha Fin',
      `Facturación (${curr})`,
      `Costo Directo (${curr})`,
      `Margen Bruto (${curr})`,
      'Margen %',
      'Frascos 250g',
      'Frascos 1000g',
      'Total Frascos',
      'Estado Operativo',
    ];

    const rows = this.weeklySales().map(w => [
      w.week,
      w.startDate,
      w.endDate,
      formatVeNumber(w.revenue * mult, 2),
      formatVeNumber(w.cost * mult, 2),
      formatVeNumber(w.margin * mult, 2),
      formatVeNumber(w.marginPercent, 1) + '%',
      formatVeNumber(w.smallUnitsSold, 0),
      formatVeNumber(w.largeUnitsSold, 0),
      formatVeNumber(w.totalUnits, 0),
      w.status === 'activa' ? 'Producción Regular' : 'Semana Inactiva / Mantenimiento',
    ]);

    exportToCsv(`ventas_semanales_recharts_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  public exportWeeklySalesExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.rates()?.currentUsd || 48.35;
    const mult = isBs ? rate : 1;
    const curr = isBs ? 'Bs.' : 'USD';

    const headers = [
      'Semana',
      'Fecha Inicio',
      'Fecha Fin',
      `Facturación (${curr})`,
      `Costo Directo (${curr})`,
      `Margen Bruto (${curr})`,
      'Margen %',
      'Frascos 250g',
      'Frascos 1000g',
      'Total Frascos',
      'Estado Operativo',
    ];

    const rows = this.weeklySales().map(w => [
      w.week,
      w.startDate,
      w.endDate,
      Number((w.revenue * mult).toFixed(2)),
      Number((w.cost * mult).toFixed(2)),
      Number((w.margin * mult).toFixed(2)),
      w.marginPercent,
      w.smallUnitsSold,
      w.largeUnitsSold,
      w.totalUnits,
      w.status === 'activa' ? 'Activa' : 'Inactiva',
    ]);

    exportToExcel(`ventas_semanales_recharts_${new Date().toISOString().slice(0, 10)}.xls`, 'Ventas Semanales', headers, rows);
  }

  public exportWeeklySalesPdf() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.rates()?.currentUsd || 48.35;
    const mult = isBs ? rate : 1;
    const curr = isBs ? 'Bs.' : '$';

    const headers = ['Semana', `Facturación (${curr})`, `Costo (${curr})`, `Margen (${curr})`, '% Margen', 'Uds 250g', 'Uds 1kg', 'Estado'];
    const rows = this.weeklySales().map(w => [
      w.week,
      formatVeNumber(w.revenue * mult, 2),
      formatVeNumber(w.cost * mult, 2),
      formatVeNumber(w.margin * mult, 2),
      `${formatVeNumber(w.marginPercent, 1)}%`,
      formatVeNumber(w.smallUnitsSold, 0),
      formatVeNumber(w.largeUnitsSold, 0),
      w.status === 'activa' ? 'Activa' : 'Inactiva',
    ]);

    exportToPdf(
      'Análisis Semanal de Ventas y Márgenes - PulpaCraft MRP',
      `Moneda: ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'} | Tasa de referencia BCV: Bs. ${formatVeNumber(rate, 2)}`,
      headers,
      rows
    );
  }

  public exportInventoryTurnoverCsv() {
    const headers = [
      'Período / Semana',
      'Rotación Global (veces)',
      'Días de Inventario (días)',
      'Rotación Pulpa/Fruta',
      'Rotación Producto Terminado',
      'Rotación Envases/Tapas',
      'Costo Inmovilización ($)',
      'Estado de Planta',
    ];

    const rows = this.inventoryTurnover().map(t => [
      t.period,
      formatVeNumber(t.turnoverRatio, 1) + 'x',
      formatVeNumber(t.daysOfSupply, 1),
      formatVeNumber(t.rawMaterialsTurnover, 1) + 'x',
      formatVeNumber(t.finishedGoodsTurnover, 1) + 'x',
      formatVeNumber(t.packagingTurnover, 1) + 'x',
      formatVeNumber(t.holdingCost, 2),
      t.status === 'activa' ? 'Operación Normal' : 'Semana Inactiva',
    ]);

    exportToCsv(`rotacion_inventario_turnover_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  public exportInventoryTurnoverExcel() {
    const headers = [
      'Período / Semana',
      'Rotación Global (veces)',
      'Días de Inventario (días)',
      'Rotación Pulpa/Fruta',
      'Rotación Producto Terminado',
      'Rotación Envases/Tapas',
      'Costo Inmovilización ($)',
      'Estado de Planta',
    ];

    const rows = this.inventoryTurnover().map(t => [
      t.period,
      t.turnoverRatio,
      t.daysOfSupply,
      t.rawMaterialsTurnover,
      t.finishedGoodsTurnover,
      t.packagingTurnover,
      t.holdingCost,
      t.status === 'activa' ? 'Operación Normal' : 'Semana Inactiva',
    ]);

    exportToExcel(`rotacion_inventario_turnover_${new Date().toISOString().slice(0, 10)}.xls`, 'Rotación Inventario', headers, rows);
  }

  public exportInventoryTurnoverPdf() {
    const headers = ['Período', 'Rotación (veces)', 'Días de Stock', 'Fruta Criolla', 'Terminado MTO', 'Envases', 'Inmovilización'];
    const rows = this.inventoryTurnover().map(t => [
      t.period,
      `${formatVeNumber(t.turnoverRatio, 1)}x`,
      `${formatVeNumber(t.daysOfSupply, 1)} días`,
      `${formatVeNumber(t.rawMaterialsTurnover, 1)}x`,
      `${formatVeNumber(t.finishedGoodsTurnover, 1)}x`,
      `${formatVeNumber(t.packagingTurnover, 1)}x`,
      `$ ${formatVeNumber(t.holdingCost, 2)}`,
    ]);

    exportToPdf(
      'Reporte de Rotación de Inventarios (Inventory Turnover) - PulpaCraft',
      'Monitoreo del ciclo de rotación y mitigación de mermas en frutas perecederas y envases',
      headers,
      rows
    );
  }

  public exportMonthlySalesCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.rates()?.currentUsd || 48.35;
    const mult = isBs ? rate : 1;
    const headers = [
      'Mes',
      'Año',
      'Uds Pequeñas (250g)',
      'Uds Grandes (1000g)',
      'Tasa del Día (Bs./USD)',
      `Facturación Total (${isBs ? 'Bs.' : 'USD'})`,
      `Margen Bruto (${isBs ? 'Bs.' : 'USD'})`,
      'Margen Bruto (%)',
    ];

    const rows = (this.metrics()?.monthlySales || []).map((s: MonthlySalesStat) => [
      s.month,
      s.year,
      formatVeNumber(s.smallUnitsSold, 0),
      formatVeNumber(s.largeUnitsSold, 0),
      formatVeNumber(rate, 2),
      formatVeNumber(s.totalRevenue * mult, 2),
      formatVeNumber(s.grossMargin * mult, 2),
      formatVeNumber(s.grossMarginPercent, 1) + '%',
    ]);

    exportToCsv(`ventas_mensuales_comparativo_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  public exportMonthlySalesExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.rates()?.currentUsd || 48.35;
    const mult = isBs ? rate : 1;
    const headers = [
      'Mes',
      'Año',
      'Uds Pequeñas (250g)',
      'Uds Grandes (1000g)',
      'Tasa del Día (Bs./USD)',
      `Facturación Total (${isBs ? 'Bs.' : 'USD'})`,
      `Margen Bruto (${isBs ? 'Bs.' : 'USD'})`,
      'Margen Bruto (%)',
    ];

    const rows = (this.metrics()?.monthlySales || []).map((s: MonthlySalesStat) => [
      s.month,
      s.year,
      s.smallUnitsSold,
      s.largeUnitsSold,
      rate,
      Number((s.totalRevenue * mult).toFixed(2)),
      Number((s.grossMargin * mult).toFixed(2)),
      s.grossMarginPercent,
    ]);

    exportToExcel(`ventas_mensuales_comparativo_${new Date().toISOString().slice(0, 10)}.xls`, 'Ventas Mensuales', headers, rows);
  }

  public exportMonthlySalesPdf() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.rates()?.currentUsd || 48.35;
    const mult = isBs ? rate : 1;
    const headers = [
      'Mes',
      'Uds 250g',
      'Uds 1kg',
      'Tasa',
      `Ventas (${isBs ? 'Bs.' : '$'})`,
      `Margen (${isBs ? 'Bs.' : '$'})`,
      '% Margen',
    ];

    const rows = (this.metrics()?.monthlySales || []).map((s: MonthlySalesStat) => [
      `${s.month} ${s.year}`,
      formatVeNumber(s.smallUnitsSold, 0),
      formatVeNumber(s.largeUnitsSold, 0),
      `Bs. ${formatVeNumber(rate, 2)}`,
      formatVeNumber(s.totalRevenue * mult, 2),
      formatVeNumber(s.grossMargin * mult, 2),
      `${formatVeNumber(s.grossMarginPercent, 1)}%`,
    ]);

    exportToPdf(
      'Comparativo Mensual de Ventas y Márgenes de Producción - PulpaCraft',
      `Moneda: ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'} | Tasa de referencia BCV: Bs. ${formatVeNumber(rate, 2)}`,
      headers,
      rows
    );
  }

  public exportExecutiveReportPdf() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.rates()?.currentUsd || 48.35;
    const mult = isBs ? rate : 1;
    const m = this.metrics();

    const headers = ['Métrica / Indicador', `Valor (${isBs ? 'Bs.' : 'USD'})`, 'Detalle Operativo'];
    const rows = [
      ['Ventas Totales Facturadas', `${isBs ? 'Bs. ' : '$'}${formatVeNumber((m?.totalRevenue || 0) * mult, 2)}`, 'Pedidos de clientes mayoristas'],
      ['Costos Operacionales Totales', `${isBs ? 'Bs. ' : '$'}${formatVeNumber((m?.totalCosts || 0) * mult, 2)}`, 'Materia prima, mano de obra y CIF'],
      ['Utilidad Neta', `${isBs ? 'Bs. ' : '$'}${formatVeNumber((m?.netProfit || 0) * mult, 2)}`, `Margen Global: ${m?.profitMarginPercent || 0}%`],
      ['Tasa Oficial BCV Usada', `Bs. ${formatVeNumber(rate, 2)}`, 'Tasa de conversión oficial del día'],
      ['Tasa USDT Paralelo / P2P', `Bs. ${formatVeNumber(this.rates()?.currentUsdt || 54.80, 2)}`, 'Cotización criptoactivo'],
      ['Unidades Producidas Mes', `${formatVeNumber(m?.unitsProducedMonth || 0, 0)} frascos`, 'Presentaciones pequeña y grande'],
    ];

    exportToPdf(
      'Informe Ejecutivo de Rentabilidad y Operaciones PulpaCraft MRP',
      `Moneda: ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'} | Generado: ${new Date().toLocaleDateString('es-VE')}`,
      headers,
      rows
    );
  }

  // --- STOCK ALERT METHODS ---
  public setAlertsFilter(f: 'all' | 'critical' | 'warning') {
    this.alertsFilter.set(f);
  }

  public notifyAlert(alert: ProductionStockAlert) {
    this.api.notifyStockAlert(alert);
  }

  public selectRecipeForSim(recipeId: string) {
    this.selectedRecipeForSim.set(recipeId);
  }

  public updateSimBatchCount(event: Event) {
    const input = event.target as HTMLInputElement;
    const val = parseInt(input.value, 10);
    this.simBatchCount.set(isNaN(val) || val < 1 ? 1 : val);
  }

  public notifySimulationResult() {
    const result = this.simFeasibilityResult();
    if (!result) return;
    if (result.canProduce) {
      this.api.showToast(
        `✅ ¡Factibilidad Confirmada! Todos los insumos están en stock para cocinar ${result.batchCount} tanda(s) (${result.targetUnits} unidades) de "${result.recipeName}".`,
        'success'
      );
    } else {
      const missingList = result.missingMaterials
        .map(m => `${m.materialName} (Faltan ${m.deficit} ${m.unit})`)
        .join(', ');
      this.api.showToast(
        `🚨 ¡Alerta de Insumos Insuficientes! No se puede completar la producción de "${result.recipeName}". Faltan: ${missingList}.`,
        'error'
      );
    }
  }

  public openRestockModal(alert: ProductionStockAlert) {
    this.selectedAlertForRestock.set(alert);
    const suggested = Math.max(
      alert.productionShortage,
      alert.minStock - alert.currentStock,
      alert.minStock
    );
    this.restockForm.patchValue({
      quantity: Math.max(1, Math.ceil(suggested)),
      notes: `Reabastecimiento rápido por alerta en Dashboard para ${alert.materialName}`,
    });
    this.isRestockModalOpen.set(true);
  }

  public closeRestockModal() {
    this.isRestockModalOpen.set(false);
    this.selectedAlertForRestock.set(null);
  }

  public async submitQuickRestock() {
    const alert = this.selectedAlertForRestock();
    if (!alert || this.restockForm.invalid) return;
    const qty = Number(this.restockForm.value.quantity) || 1;
    await this.api.quickRestockMaterial(alert.materialId, qty);
    this.closeRestockModal();
  }

  public exportStockAlertsPdf() {
    const alerts = this.productionStockAlerts();
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.rates()?.currentUsd || 48.35;
    const headers = [
      'Insumo / Código',
      'Categoría',
      'Stock Actual',
      'Stock Mínimo',
      'Requerido Prod.',
      'Déficit',
      'Severidad',
      `Costo Reponer (${isBs ? 'Bs.' : '$'})`,
    ];
    const rows = alerts.map(a => [
      `${a.materialName} (${a.materialCode})`,
      a.category.toUpperCase(),
      `${formatVeNumber(a.currentStock, 1)} ${a.unit}`,
      `${formatVeNumber(a.minStock, 1)} ${a.unit}`,
      `${formatVeNumber(a.requiredForActiveOrders, 1)} ${a.unit}`,
      a.productionShortage > 0 ? `-${formatVeNumber(a.productionShortage, 1)} ${a.unit}` : 'OK',
      a.severity === 'critical' ? 'BLOQUEO PRODUCCIÓN' : a.severity === 'warning' ? 'BAJO MÍNIMO' : 'PRECAUCIÓN',
      isBs ? `Bs. ${formatVeNumber(a.estimatedReplenishCostBs, 2)}` : `$ ${formatVeNumber(a.estimatedReplenishCostUsd, 2)}`,
    ]);

    exportToPdf(
      'Auditoría y Alertas de Stock Mínimo e Insumos para Producción - PulpaCraft',
      `Tasa Oficial BCV: Bs. ${formatVeNumber(rate, 2)} | Alertas Críticas: ${this.criticalAlertsCount()} | Bajo Mínimo: ${this.warningAlertsCount()}`,
      headers,
      rows
    );
  }
}
