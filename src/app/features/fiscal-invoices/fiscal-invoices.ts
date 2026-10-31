import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {FiscalInvoice} from '../../core/models/erp.models';
import {VeCurrencyPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';

const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

@Component({
  selector: 'app-fiscal-invoices',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, MatIconModule, VeCurrencyPipe],
  templateUrl: './fiscal-invoices.html',
})
export class FiscalInvoicesComponent implements OnInit {
  public api = inject(ErpApiService);

  public readonly monthLabels = MONTH_LABELS;

  public filterYear = signal<number | null>(null);
  public filterMonth = signal<number | null>(null);
  public searchTerm = signal<string>('');

  public selectedInvoice = signal<FiscalInvoice | null>(null);
  public invoiceToAnnul = signal<FiscalInvoice | null>(null);
  public annulling = signal<boolean>(false);
  public printing = signal<boolean>(false);
  public duplicatePrint = signal<boolean>(false);

  public annulForm = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(500)],
    }),
  });

  public isAdmin = computed(() => this.api.currentRole() === 'admin');

  /** All invoices, newest first. */
  public invoices = computed<FiscalInvoice[]>(() =>
    [...this.api.fiscalInvoices()].sort(
      (a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime()
    )
  );

  public availableYears = computed<number[]>(() => {
    const years = new Set<number>(this.invoices().map((invoice) => invoice.periodYear));
    return [...years].sort((a, b) => b - a);
  });

  public filteredInvoices = computed<FiscalInvoice[]>(() => {
    const year = this.filterYear();
    const month = this.filterMonth();
    const term = this.searchTerm().trim().toLowerCase();

    return this.invoices().filter((invoice) => {
      if (year && invoice.periodYear !== year) return false;
      if (month && invoice.periodMonth !== month) return false;
      if (!term) return true;

      const number = this.invoiceNumber(invoice).toLowerCase();
      const control = this.controlNumber(invoice).toLowerCase();
      return [
        number,
        control,
        invoice.customerSnapshot.businessName,
        invoice.customerSnapshot.taxId,
        invoice.salesOrderNumber || '',
        invoice.emitterSnapshot.companyName || '',
      ].some((value) => value.toLowerCase().includes(term));
    });
  });

  public summary = computed(() => {
    const invoices = this.filteredInvoices();
    const issued = invoices.filter((invoice) => invoice.status === 'emitida');
    const annulled = invoices.filter((invoice) => invoice.status === 'anulada');

    return {
      issuedCount: issued.length,
      annulledCount: annulled.length,
      totalUsd: issued.reduce((acc, invoice) => acc + invoice.total, 0),
      totalBs: issued.reduce((acc, invoice) => acc + this.totalBs(invoice), 0),
      taxUsd: issued.reduce((acc, invoice) => acc + invoice.taxAmount, 0),
      taxBs: issued.reduce((acc, invoice) => acc + this.taxBs(invoice), 0),
    };
  });

  public hasActiveFilters = computed(
    () => this.filterYear() !== null || this.filterMonth() !== null || this.searchTerm().trim() !== ''
  );

  ngOnInit() {
    void this.api.refreshFiscalInvoices().catch(() => undefined);
  }

  public invoiceNumber(invoice: FiscalInvoice): string {
    return `${invoice.serie}-${String(invoice.invoiceNumber).padStart(8, '0')}`;
  }

  public controlNumber(invoice: FiscalInvoice): string {
    return String(invoice.controlNumber).padStart(8, '0');
  }

  public totalBs(invoice: FiscalInvoice): number {
    if (invoice.totalBs !== undefined && invoice.totalBs !== null) return invoice.totalBs;
    return Number((invoice.total * (invoice.exchangeRateUsed || 0)).toFixed(2));
  }

  public taxBs(invoice: FiscalInvoice): number {
    if (invoice.taxAmountBs !== undefined && invoice.taxAmountBs !== null) return invoice.taxAmountBs;
    return Number((invoice.taxAmount * (invoice.exchangeRateUsed || 0)).toFixed(2));
  }

  public subtotalBs(invoice: FiscalInvoice): number {
    if (invoice.subtotalBs !== undefined && invoice.subtotalBs !== null) return invoice.subtotalBs;
    return Number((invoice.subtotal * (invoice.exchangeRateUsed || 0)).toFixed(2));
  }

  public lineSubtotalBs(invoice: FiscalInvoice, subtotal: number): number {
    return Number((subtotal * (invoice.exchangeRateUsed || 0)).toFixed(2));
  }

  public taxBreakdown(invoice: FiscalInvoice) {
    const groups = new Map<string, { label: string; subtotal: number; taxAmount: number }>();
    for (const item of invoice.items) {
      const category = item.taxCategory ?? 'gravado';
      const rate = category === 'gravado' ? item.taxRatePercent : 0;
      const label =
        category === 'exento'
          ? 'Exento'
          : category === 'no_sujeto'
            ? 'No sujeto'
            : `Gravado ${this.formatNumber(rate, 2)}%`;
      const current = groups.get(label) ?? { label, subtotal: 0, taxAmount: 0 };
      current.subtotal = Number((current.subtotal + item.subtotal).toFixed(2));
      current.taxAmount = Number((current.taxAmount + item.taxAmount).toFixed(2));
      groups.set(label, current);
    }
    return [...groups.values()];
  }

  public taxCategoryLabel(category?: FiscalInvoice['items'][number]['taxCategory']): string {
    switch (category) {
      case 'exento':
        return 'Exento';
      case 'no_sujeto':
        return 'No sujeto';
      default:
        return 'Gravado';
    }
  }

  public formatNumber(value: number, decimals = 2): string {
    return formatVeNumber(value, decimals);
  }

  public formatDate(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('es-VE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  public formatShortDate(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('es-VE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  public monthLabel(month?: number): string {
    if (!month) return '—';
    return MONTH_LABELS[month - 1] || String(month);
  }

  public setYear(value: string) {
    this.filterYear.set(value ? Number(value) : null);
  }

  public setMonth(value: string) {
    this.filterMonth.set(value ? Number(value) : null);
  }

  public onSearch(value: string) {
    this.searchTerm.set(value);
  }

  public clearFilters() {
    this.filterYear.set(null);
    this.filterMonth.set(null);
    this.searchTerm.set('');
  }

  public async refresh() {
    try {
      await this.api.refreshFiscalInvoices();
      this.api.showToast('Listado de facturas fiscales actualizado.', 'info');
    } catch {
      // The API service reports the failure and keeps the existing list intact.
    }
  }

  public openDetail(invoice: FiscalInvoice) {
    this.duplicatePrint.set(false);
    this.selectedInvoice.set(invoice);
  }

  public closeDetail() {
    this.selectedInvoice.set(null);
  }

  public openAnnul(invoice: FiscalInvoice) {
    this.selectedInvoice.set(null);
    this.invoiceToAnnul.set(invoice);
    this.annulForm.reset({reason: ''});
  }

  public closeAnnul() {
    if (this.annulling()) return;
    this.invoiceToAnnul.set(null);
    this.annulForm.reset({reason: ''});
  }

  public async confirmAnnul() {
    const invoice = this.invoiceToAnnul();
    if (!invoice || this.annulling()) return;
    if (this.annulForm.invalid) {
      this.annulForm.markAllAsTouched();
      return;
    }

    this.annulling.set(true);
    try {
      const updated = await this.api.annulFiscalInvoice(
        invoice.id,
        this.annulForm.controls.reason.value
      );
      this.invoiceToAnnul.set(null);
      this.annulForm.reset({reason: ''});
      this.selectedInvoice.set(updated);
    } catch {
      // annulFiscalInvoice already surfaces the error toast.
    } finally {
      this.annulling.set(false);
    }
  }

  public async printInvoice() {
    const invoice = this.selectedInvoice();
    if (!invoice || this.printing()) return;

    this.printing.set(true);
    try {
      const result = await this.api.recordFiscalInvoicePrint(invoice.id);
      this.duplicatePrint.set(result.isDuplicate);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      window.print();
    } catch {
      // The API service reports the failure and the invoice must not be printed untracked.
    } finally {
      this.printing.set(false);
    }
  }
}
