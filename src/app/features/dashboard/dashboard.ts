import {ChangeDetectionStrategy, Component, inject, computed, signal} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {VeCurrencyPipe, VeNumberPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';
import {MonthlySalesStat} from '../../core/models/erp.models';

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
export class DashboardComponent {
  public api = inject(ErpApiService);
  public readonly Math = Math;

  public currencyMode = signal<'USD' | 'Bs'>('USD');
  public metrics = computed(() => this.api.dashboardData());
  public costData = computed(() => this.api.costStructure());
  public rawMaterials = computed(() => this.api.rawMaterials());
  public salesOrders = computed(() => this.api.salesOrders());
  public productionOrders = computed(() => this.api.productionOrders());
  public rates = computed(() => this.api.exchangeRates());

  public lowStockCount = computed(() => {
    return this.rawMaterials().filter(m => m.currentStock <= m.minStock).length;
  });

  public pendingDeliveriesCount = computed(() => {
    return this.salesOrders().filter(s => s.status === 'listo_despacho' || s.status === 'en_produccion').length;
  });

  public activeBatchesCount = computed(() => {
    return this.productionOrders().filter(p => p.status === 'en_proceso' || p.status === 'planificada').length;
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
}
