import {ChangeDetectionStrategy, Component, computed, inject, output, signal} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {SalesOrder} from '../../core/models/erp.models';
import {ErpApiService} from '../../core/services/erp-api.service';
import {formatVeNumber, VeCurrencyPipe, VeNumberPipe} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';
import {
  buildReceivableRows,
  computeTotals,
  filterReceivables,
  ReceivableSort,
  sortReceivables,
  summarizeByCustomer,
} from './accounts-receivable.calculations';
import {
  AgingBucket,
  ReceivableBucketFilter,
  ReceivableRow,
  ReceivableStatusFilter,
} from './accounts-receivable.model';

const BUCKET_LABELS: Record<AgingBucket, string> = {
  corriente: 'Corriente',
  '1-30': '1 – 30 días',
  '31-60': '31 – 60 días',
  '61-90': '61 – 90 días',
  '>90': 'Más de 90 días',
};

const STATUS_LABELS = {
  cobrado: 'Cobrado',
  vigente: 'Vigente',
  vencido: 'Vencido',
} as const;

@Component({
  selector: 'app-accounts-receivable',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, VeCurrencyPipe, VeNumberPipe],
  templateUrl: './accounts-receivable.html',
})
export class AccountsReceivableComponent {
  public api = inject(ErpApiService);

  /** Solicita al módulo de Ventas que abra el modal de cobro para este pedido. */
  public collect = output<SalesOrder>();

  /** Solicita el drawer con el historial de abonos del pedido. */
  public viewHistory = output<SalesOrder>();

  public readonly bucketLabels = BUCKET_LABELS;
  public readonly statusLabels = STATUS_LABELS;
  public readonly agingBuckets: AgingBucket[] = [
    'corriente',
    '1-30',
    '31-60',
    '61-90',
    '>90',
  ];
  public readonly bucketOptions: ReceivableBucketFilter[] = ['todos', ...this.agingBuckets];
  public readonly sortOptions: {value: ReceivableSort; label: string}[] = [
    {value: 'dueDate', label: 'Vencimiento'},
    {value: 'balance', label: 'Saldo'},
    {value: 'customer', label: 'Cliente'},
  ];

  public searchTerm = signal<string>('');
  public statusFilter = signal<ReceivableStatusFilter>('todos');
  public bucketFilter = signal<ReceivableBucketFilter>('todos');
  public creditOnly = signal<boolean>(false);
  public currencyMode = signal<'USD' | 'Bs'>('USD');
  public groupByCustomer = signal<boolean>(false);
  public sortBy = signal<ReceivableSort>('dueDate');

  private readonly today = new Date();

  public canExport = computed(() => this.api.hasPermission('sales', 'canExport'));
  public canCollect = computed(() => !this.api.isSupervisorPlanta());
  public currency = computed(() => (this.currencyMode() === 'Bs' ? 'Bs.' : '$'));

  public rows = computed(() =>
    buildReceivableRows({
      orders: this.api.salesOrders(),
      customers: this.api.customers(),
      invoices: this.api.fiscalInvoices(),
      notes: this.api.fiscalAdjustmentNotes(),
      exchangeRateUsd: this.api.exchangeRates()?.currentUsd,
      today: this.today,
    })
  );

  public filteredRows = computed(() =>
    filterReceivables(this.rows(), {
      search: this.searchTerm(),
      status: this.statusFilter(),
      bucket: this.bucketFilter(),
      creditOnly: this.creditOnly(),
    })
  );

  public sortedRows = computed(() => sortReceivables(this.filteredRows(), this.sortBy()));

  public totals = computed(() => computeTotals(this.filteredRows()));

  /** Distribución de aging sobre todos los pedidos, independiente del filtro activo. */
  public agingTotals = computed(() => computeTotals(this.rows()));

  public customerSummaries = computed(() =>
    summarizeByCustomer(
      this.filteredRows(),
      this.api.customers().map((customer) => ({
        id: customer.id,
        creditLimit: customer.creditLimit,
      }))
    )
  );

  public reportDate = this.today.toLocaleDateString('es-VE');

  public bucketLabel(bucket: AgingBucket): string {
    return BUCKET_LABELS[bucket];
  }

  public filterBucketLabel(option: ReceivableBucketFilter): string {
    return option === 'todos' ? 'Todas' : BUCKET_LABELS[option];
  }

  public bucketTotals(bucket: AgingBucket): {count: number; usd: number} {
    return this.agingTotals().buckets[bucket];
  }

  public displayTotal(usd: number, bs: number): number {
    return this.currencyMode() === 'Bs' ? bs : usd;
  }

  public statusLabel(row: ReceivableRow): string {
    if (row.partialCollection && row.balanceUsd > 0) return 'Cobro parcial';
    return STATUS_LABELS[row.status];
  }

  /** Convierte un importe USD a la moneda seleccionada en la vista. */
  public displayAmount(valueUsd: number, row: ReceivableRow): number {
    if (this.currencyMode() === 'USD') return valueUsd;
    return Number((valueUsd * row.exchangeRateUsed).toFixed(2));
  }

  public resetFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('todos');
    this.bucketFilter.set('todos');
    this.creditOnly.set(false);
    this.groupByCustomer.set(false);
    this.sortBy.set('dueDate');
  }

  public requestCollection(row: ReceivableRow): void {
    if (!this.canCollect() || row.balanceUsd <= 0) return;
    this.collect.emit(row.order);
  }

  public requestHistory(row: ReceivableRow): void {
    if (row.collectedUsd <= 0) return;
    this.viewHistory.emit(row.order);
  }

  public export(format: 'csv' | 'excel' | 'pdf'): void {
    if (!this.canExport()) return;
    const rows = this.sortedRows();
    if (!rows.length) {
      this.api.showToast('No hay datos para exportar con los filtros actuales.', 'error');
      return;
    }

    const headers = [
      'Cliente',
      'RIF',
      'Pedido',
      'Factura',
      'Condición',
      'Días crédito',
      'Vencimiento',
      'Días vencido',
      'Estado',
      'Total USD',
      'Cobrado USD',
      'Notas crédito USD',
      'Notas débito USD',
      'Saldo USD',
      'Saldo Bs.',
      'Tasa Bs./USD',
    ];
    const dataRows = rows.map((row) => [
      row.customerName,
      row.customerTaxId,
      row.orderNumber,
      row.invoiceNumber ?? 'SIN FACTURA',
      row.saleCondition === 'credito' ? 'Crédito' : 'Contado',
      row.creditDays,
      row.dueDate ?? 'N/D',
      row.daysOverdue,
      this.statusLabel(row),
      row.totalUsd,
      row.collectedUsd,
      row.creditNotesUsd,
      row.debitNotesUsd,
      row.balanceUsd,
      row.balanceBs,
      row.exchangeRateUsed,
    ]);
    const suffixes: string[] = [];
    if (this.searchTerm().trim()) suffixes.push('busqueda');
    if (this.statusFilter() !== 'todos') suffixes.push(this.statusFilter());
    if (this.bucketFilter() !== 'todos') suffixes.push(this.bucketFilter());
    if (this.creditOnly()) suffixes.push('credito');
    const filename = `cuentas-por-cobrar-${this.today.toISOString().slice(0, 10)}${
      suffixes.length ? `-${suffixes.join('-')}` : ''
    }`;
    const settings = this.api.fiscalSettings();
    const metadata = {
      empresa: settings?.companyName || 'Mermeladas Artesanales del Valle C.A.',
      rif: settings?.companyTaxId || '',
      fecha: this.reportDate,
      tasaCambio: formatVeNumber(this.api.exchangeRates()?.currentUsd || 48.35),
      moneda: 'USD / Bs.',
    };
    const totals = this.totals();

    if (format === 'csv') {
      exportToCsv(filename, headers, dataRows);
      return;
    }
    if (format === 'excel') {
      exportToExcel(filename, 'Cuentas por cobrar', headers, dataRows, metadata);
      return;
    }

    void exportToPdf({
      title: 'Cuentas por cobrar',
      subtitle: `Saldo pendiente por cliente al ${this.reportDate}`,
      empresa: metadata.empresa,
      rif: metadata.rif,
      exchangeRateUsed: this.api.exchangeRates()?.currentUsd || 48.35,
      currencyLabel: 'USD',
      headers,
      rows: dataRows,
      totals: [
        {label: 'Total por cobrar USD', value: formatVeNumber(totals.balanceUsd)},
        {label: 'Total vencido USD', value: formatVeNumber(totals.overdueUsd)},
        {label: 'Clientes con saldo', value: formatVeNumber(totals.customerCount, 0)},
      ],
      notes:
        'Reporte generado desde el ERP. Los saldos se calculan con facturas vigentes, notas de crédito/débito y cobros registrados.',
    });
  }
}
