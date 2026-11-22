import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {DatePipe} from '@angular/common';
import {FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {Expense, Payable, PayablePayment} from '../../core/models/erp.models';
import {ErpApiService} from '../../core/services/erp-api.service';
import {formatVeNumber, VeCurrencyPipe, VeNumberPipe} from '../../core/pipes/ve-currency.pipe';
import {
  VENEZUELAN_BANKS,
  bankLabel,
  findBank,
} from '../../core/data/venezuelan-banks';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';
import {
  buildPayableRows,
  computePayableTotals,
  filterPayables,
  payableOutstanding,
  paymentTermsToDays,
  PayableSort,
  sortPayables,
  summarizeBySupplier,
} from './payables.calculations';
import {
  PayableAgingBucket,
  PayableFilters,
  PayableRow,
  PayableStatusFilter,
} from './payables.model';

const BUCKET_LABELS: Record<PayableAgingBucket, string> = {
  corriente: 'Corriente',
  '1-30': '1 – 30 días',
  '31-60': '31 – 60 días',
  '61-90': '61 – 90 días',
  '>90': 'Más de 90 días',
};

const STATUS_LABELS: Record<PayableRow['status'], string> = {
  pendiente: 'Pendiente',
  parcial: 'Pago parcial',
  vencida: 'Vencida',
  pagada: 'Pagada',
  anulada: 'Anulada',
};

@Component({
  selector: 'app-accounts-payable',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatIconModule, ReactiveFormsModule, VeCurrencyPipe, VeNumberPipe],
  templateUrl: './accounts-payable.html',
})
export class AccountsPayableComponent {
  public api = inject(ErpApiService);

  public readonly bucketLabels = BUCKET_LABELS;
  public readonly statusLabels = STATUS_LABELS;
  public readonly agingBuckets: PayableAgingBucket[] = [
    'corriente',
    '1-30',
    '31-60',
    '61-90',
    '>90',
  ];
  public readonly bucketOptions: (PayableAgingBucket | 'todos')[] = [
    'todos',
    ...this.agingBuckets,
  ];
  public readonly sortOptions: {value: PayableSort; label: string}[] = [
    {value: 'dueDate', label: 'Vencimiento'},
    {value: 'balance', label: 'Saldo'},
    {value: 'supplier', label: 'Proveedor'},
  ];
  public readonly banks = VENEZUELAN_BANKS;
  public readonly bankLabel = bankLabel;
  public readonly findBank = findBank;
  public readonly bankPaymentMethods = [
    {value: 'transferencia_bancaria', label: 'Transferencia bancaria'},
    {value: 'pago_movil', label: 'Pago móvil'},
    {value: 'tarjeta', label: 'Tarjeta'},
    {value: 'zelle', label: 'Zelle'},
  ];

  public searchTerm = signal<string>('');
  public statusFilter = signal<PayableStatusFilter>('todos');
  public bucketFilter = signal<PayableAgingBucket | 'todos'>('todos');
  public supplierFilter = signal<string>('');
  public groupBySupplier = signal<boolean>(false);
  public currencyMode = signal<'USD' | 'Bs'>('USD');
  public sortBy = signal<PayableSort>('dueDate');

  public isCreateModalOpen = signal<boolean>(false);
  public isPayModalOpen = signal<boolean>(false);
  public isHistoryOpen = signal<boolean>(false);
  public payingPayable = signal<Payable | null>(null);
  public historyPayable = signal<Payable | null>(null);
  public paymentHistory = signal<PayablePayment[]>([]);
  public generatedExpense = signal<Expense | null>(null);
  public saving = signal<boolean>(false);

  private readonly today = new Date();

  public canCreate = computed(() => this.api.hasPermission('expenses', 'canCreate'));
  public canEdit = computed(() => this.api.hasPermission('expenses', 'canEdit'));
  public canExport = computed(() => this.api.hasPermission('expenses', 'canExport'));
  public currency = computed(() => (this.currencyMode() === 'Bs' ? 'Bs.' : '$'));

  public rows = computed(() =>
    buildPayableRows({
      payables: this.api.payables(),
      payments: this.api.payablePayments(),
      today: this.today,
    })
  );

  public filteredRows = computed(() =>
    filterPayables(this.rows(), {
      search: this.searchTerm(),
      status: this.statusFilter(),
      bucket: this.bucketFilter(),
      supplierId: this.supplierFilter() || undefined,
    } as PayableFilters)
  );

  public sortedRows = computed(() => sortPayables(this.filteredRows(), this.sortBy()));
  public totals = computed(() => computePayableTotals(this.filteredRows(), this.today));
  public supplierSummaries = computed(() => summarizeBySupplier(this.filteredRows()));
  public reportDate = this.today.toLocaleDateString('es-VE');

  public createForm = new FormGroup({
    supplierId: new FormControl<string>(''),
    supplierName: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    taxId: new FormControl<string>(''),
    invoiceNumber: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    controlNumber: new FormControl<string>(''),
    issueDate: new FormControl<string>(this.today.toISOString().slice(0, 10), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    dueDate: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    amountUsd: new FormControl<number>(0, {nonNullable: true, validators: [Validators.min(0.01), Validators.required]}),
    exchangeRateUsed: new FormControl<number>(this.api.exchangeRates()?.currentUsd || 48.35, {
      nonNullable: true,
      validators: [Validators.min(0.01)],
    }),
    taxAmountUsd: new FormControl<number>(0),
    category: new FormControl<string>('materia_prima', {nonNullable: true}),
    notes: new FormControl<string>(''),
  });

  public payForm = new FormGroup({
    bankCode: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    paymentMethod: new FormControl<string>('transferencia_bancaria', {nonNullable: true}),
    reference: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    amountUsd: new FormControl<number>(0, {nonNullable: true, validators: [Validators.min(0.01)]}),
    exchangeRateUsed: new FormControl<number>(this.api.exchangeRates()?.currentUsd || 48.35, {
      nonNullable: true,
      validators: [Validators.min(0.01)],
    }),
  });

  public bucketLabel(bucket: PayableAgingBucket): string {
    return BUCKET_LABELS[bucket];
  }

  public filterBucketLabel(option: PayableAgingBucket | 'todos'): string {
    return option === 'todos' ? 'Todas' : BUCKET_LABELS[option];
  }

  public bucketTotals(bucket: PayableAgingBucket): {count: number; usd: number} {
    return computePayableTotals(this.rows(), this.today).buckets[bucket];
  }

  public statusLabel(row: PayableRow): string {
    return STATUS_LABELS[row.status];
  }

  public displayAmount(valueUsd: number, exchangeRateUsed: number): number {
    return this.currencyMode() === 'Bs'
      ? Number((valueUsd * exchangeRateUsed).toFixed(2))
      : valueUsd;
  }

  public resetFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('todos');
    this.bucketFilter.set('todos');
    this.supplierFilter.set('');
    this.groupBySupplier.set(false);
    this.sortBy.set('dueDate');
  }

  public onSupplierChange(id: string): void {
    this.createForm.patchValue({supplierId: id});
    if (!id) return;
    const supplier = this.api.suppliers().find((candidate) => candidate.id === id);
    if (!supplier) return;
    const days = paymentTermsToDays(supplier.paymentTerms);
    const issue = this.createForm.controls.issueDate.value;
    const base = issue ? new Date(`${issue}T00:00:00`) : new Date();
    if (days > 0 && !this.createForm.controls.dueDate.value) {
      base.setDate(base.getDate() + days);
      this.createForm.patchValue({
        supplierName: supplier.businessName,
        taxId: supplier.taxId,
        dueDate: base.toISOString().slice(0, 10),
      });
    } else {
      this.createForm.patchValue({supplierName: supplier.businessName, taxId: supplier.taxId});
    }
  }

  public openCreateModal(): void {
    if (!this.canCreate()) return;
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const issueDate = new Date().toISOString().slice(0, 10);
    this.createForm.reset({
      supplierId: '',
      supplierName: '',
      taxId: '',
      invoiceNumber: '',
      controlNumber: '',
      issueDate,
      dueDate: '',
      amountUsd: 0,
      exchangeRateUsed: rate,
      taxAmountUsd: 0,
      category: 'materia_prima',
      notes: '',
    });
    this.isCreateModalOpen.set(true);
  }

  public closeCreateModal(): void {
    this.isCreateModalOpen.set(false);
  }

  public async submitPayable(): Promise<void> {
    if (this.createForm.invalid || this.saving()) return;
    const value = this.createForm.getRawValue();
    this.saving.set(true);
    try {
      await this.api.addPayable({
        supplierId: value.supplierId || undefined,
        supplierName: value.supplierName.trim(),
        taxId: value.taxId?.trim() || undefined,
        invoiceNumber: value.invoiceNumber.trim(),
        controlNumber: value.controlNumber?.trim() || undefined,
        issueDate: value.issueDate,
        dueDate: value.dueDate,
        amountUsd: Number(value.amountUsd),
        exchangeRateUsed: Number(value.exchangeRateUsed),
        amountBs: Number((Number(value.amountUsd) * Number(value.exchangeRateUsed)).toFixed(2)),
        taxAmountUsd: Number(value.taxAmountUsd) || undefined,
        category: value.category,
        status: 'pendiente',
        notes: value.notes?.trim() || undefined,
      });
      this.closeCreateModal();
    } finally {
      this.saving.set(false);
    }
  }

  public outstandingFor(payable: Payable): number {
    return payableOutstanding(
      payable,
      this.api.payablePayments().filter((payment) => payment.payableId === payable.id)
    );
  }

  public openPayModal(payable: Payable): void {
    if (!this.canEdit() || this.outstandingFor(payable) <= 0) return;
    this.payingPayable.set(payable);
    this.generatedExpense.set(null);
    const rate = payable.exchangeRateUsed || this.api.exchangeRates()?.currentUsd || 48.35;
    this.payForm.reset({
      bankCode: '',
      paymentMethod: 'transferencia_bancaria',
      reference: '',
      amountUsd: this.outstandingFor(payable),
      exchangeRateUsed: rate,
    });
    this.isPayModalOpen.set(true);
  }

  public closePayModal(): void {
    this.isPayModalOpen.set(false);
    this.payingPayable.set(null);
    this.generatedExpense.set(null);
  }

  public async submitPayment(): Promise<void> {
    const payable = this.payingPayable();
    if (!payable || this.payForm.invalid || this.saving()) return;
    const value = this.payForm.getRawValue();
    const bank = findBank(value.bankCode);
    if (!bank) {
      this.api.showToast('Selecciona un banco receptor del catálogo oficial SUDEBAN.', 'error');
      return;
    }
    if (Number(value.amountUsd) > this.outstandingFor(payable) + 0.01) {
      this.api.showToast(
        `El monto supera el saldo pendiente ($${formatVeNumber(this.outstandingFor(payable), 2)}).`,
        'error'
      );
      return;
    }
    const reference = value.reference.trim().toLowerCase();
    const payments = this.api.payablePayments().filter((entry) => entry.payableId === payable.id);
    if (payments.some((entry) => entry.reference.trim().toLowerCase() === reference)) {
      this.api.showToast('Esa referencia ya fue registrada para esta factura.', 'error');
      return;
    }

    this.saving.set(true);
    try {
      const result = await this.api.payPayable(payable.id, {
        bankCode: bank.code,
        bankName: bank.name,
        paymentMethod: value.paymentMethod as PayablePayment['paymentMethod'],
        reference: value.reference.trim(),
        amountUsd: Number(value.amountUsd),
        exchangeRateUsed: Number(value.exchangeRateUsed),
      });
      this.generatedExpense.set(result.expense ?? null);
      this.closePayModal();
      this.api.showToast(
        result.expense
          ? 'Factura saldada. Se generó el comprobante de egreso para el Libro de Compras.'
          : 'Pago registrado correctamente.',
        'success'
      );
    } finally {
      this.saving.set(false);
    }
  }

  public openHistory(payable: Payable): void {
    this.historyPayable.set(payable);
    this.paymentHistory.set(
      this.api
        .payablePayments()
        .filter((payment) => payment.payableId === payable.id)
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
    );
    this.isHistoryOpen.set(true);
  }

  public closeHistory(): void {
    this.isHistoryOpen.set(false);
    this.historyPayable.set(null);
    this.paymentHistory.set([]);
  }

  public async annulPayable(payable: Payable): Promise<void> {
    if (!this.canEdit() || payable.status === 'anulada') return;
    if (!window.confirm(`¿Anular la factura por pagar ${payable.payableNumber}?`)) return;
    await this.api.updatePayable(payable.id, {status: 'anulada'});
  }

  public export(format: 'csv' | 'excel' | 'pdf'): void {
    if (!this.canExport()) return;
    const rows = this.sortedRows();
    if (!rows.length) {
      this.api.showToast('No hay datos para exportar con los filtros actuales.', 'error');
      return;
    }
    const headers = [
      'Factura por pagar',
      'Proveedor',
      'RIF',
      'Nro. factura',
      'Nro. control',
      'Emisión',
      'Vencimiento',
      'Días vencido',
      'Estado',
      'Total USD',
      'Pagado USD',
      'Saldo USD',
      'Saldo Bs.',
      'Tasa Bs./USD',
    ];
    const dataRows = rows.map((row) => [
      row.payableNumber,
      row.supplierName,
      row.taxId,
      row.invoiceNumber,
      row.controlNumber ?? '',
      row.issueDate,
      row.dueDate,
      row.daysOverdue,
      this.statusLabel(row),
      row.totalUsd,
      row.paidUsd,
      row.balanceUsd,
      row.balanceBs,
      row.exchangeRateUsed,
    ]);
    const filename = `cuentas-por-pagar-${this.today.toISOString().slice(0, 10)}`;
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
      exportToExcel(filename, 'Cuentas por pagar', headers, dataRows, metadata);
      return;
    }
    void exportToPdf({
      title: 'Cuentas por pagar',
      subtitle: `Saldo pendiente por proveedor al ${this.reportDate}`,
      empresa: metadata.empresa,
      rif: metadata.rif,
      exchangeRateUsed: this.api.exchangeRates()?.currentUsd || 48.35,
      currencyLabel: 'USD',
      headers,
      rows: dataRows,
      totals: [
        {label: 'Total por pagar USD', value: formatVeNumber(totals.balanceUsd)},
        {label: 'Total vencido USD', value: formatVeNumber(totals.overdueUsd)},
        {label: 'Proveedores con saldo', value: formatVeNumber(totals.supplierCount, 0)},
      ],
      notes:
        'Reporte generado desde el ERP. Los saldos se calculan con pagos registrados; al saldar se genera el gasto correspondiente para el Libro de Compras.',
    });
  }
}
