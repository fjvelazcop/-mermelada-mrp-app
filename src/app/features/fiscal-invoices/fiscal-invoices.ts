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
import {
  FiscalAdjustmentNote,
  FiscalAdjustmentReason,
  FiscalAdjustmentType,
  FiscalBooksReport,
  FiscalInvoice,
} from '../../core/models/erp.models';
import {VeCurrencyPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {spanishCurrencyWords} from '../../core/utils/spanish-currency-words';
import {exportToCsv} from '../../core/utils/export.utils';

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
  public invoiceToAdjust = signal<FiscalInvoice | null>(null);
  public creatingAdjustment = signal<boolean>(false);
  public selectedAdjustmentNote = signal<FiscalAdjustmentNote | null>(null);
  public printingAdjustment = signal<boolean>(false);
  public duplicateAdjustmentPrint = signal<boolean>(false);
  public bookYear = signal<number>(new Date().getFullYear());
  public bookMonth = signal<number>(new Date().getMonth() + 1);
  public booksReport = signal<FiscalBooksReport | null>(null);
  public booksLoading = signal<boolean>(false);
  public booksError = signal<string>('');

  public annulForm = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(500)],
    }),
  });

  public adjustmentForm = new FormGroup({
    type: new FormControl<FiscalAdjustmentType>('nota_credito', {nonNullable: true}),
    reason: new FormControl<FiscalAdjustmentReason>('devolucion', {nonNullable: true}),
    reasonDetails: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
    subtotal: new FormControl(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0.01)],
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

  public fiscalAdjustmentNotes = computed(() =>
    [...this.api.fiscalAdjustmentNotes()].sort(
      (a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime()
    )
  );

  public bookYears = computed(() => {
    const years = new Set<number>([new Date().getFullYear()]);
    for (const invoice of this.api.fiscalInvoices()) years.add(invoice.periodYear);
    for (const note of this.api.fiscalAdjustmentNotes()) years.add(note.periodYear);
    for (const expense of this.api.expenses()) {
      const year = Number(expense.date.slice(0, 4));
      if (Number.isInteger(year) && year >= 2000) years.add(year);
    }
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
    void this.api.refreshFiscalAdjustmentNotes().catch(() => undefined);
    if (this.isAdmin()) void this.loadFiscalBooks();
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

  public totalInWords(value: number, currency: 'dólar' | 'bolívar'): string {
    return spanishCurrencyWords(value, currency);
  }

  public paymentMethodLabel(method: FiscalInvoice['paymentMethod']): string {
    const labels: Record<FiscalInvoice['paymentMethod'], string> = {
      transferencia_bancaria: 'Transferencia bancaria',
      pago_movil: 'Pago móvil',
      efectivo_usd: 'Efectivo USD',
      efectivo_bs: 'Efectivo Bs.',
      zelle: 'Zelle',
      tarjeta: 'Tarjeta',
      credito: 'Crédito',
    };
    return labels[method];
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
      await Promise.all([
        this.api.refreshFiscalInvoices(),
        this.api.refreshFiscalAdjustmentNotes(),
      ]);
      this.api.showToast('Facturas y notas fiscales actualizadas.', 'info');
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

  public openAdjustment(invoice: FiscalInvoice): void {
    if (invoice.subtotal <= 0) return;
    this.selectedInvoice.set(null);
    this.invoiceToAdjust.set(invoice);
    this.adjustmentForm.reset({
      type: 'nota_credito',
      reason: 'devolucion',
      reasonDetails: '',
      subtotal: this.creditableSubtotal(invoice) || invoice.subtotal,
    });
  }

  public closeAdjustment(): void {
    if (this.creatingAdjustment()) return;
    this.invoiceToAdjust.set(null);
    this.adjustmentForm.reset({
      type: 'nota_credito',
      reason: 'devolucion',
      reasonDetails: '',
      subtotal: 0,
    });
  }

  public creditableSubtotal(invoice: FiscalInvoice): number {
    const credited = this.fiscalAdjustmentNotes()
      .filter((note) => note.fiscalInvoiceId === invoice.id && note.type === 'nota_credito')
      .reduce((sum, note) => sum + note.subtotal, 0);
    return Number(Math.max(0, invoice.subtotal - credited).toFixed(2));
  }

  public async createAdjustment(): Promise<void> {
    const invoice = this.invoiceToAdjust();
    if (!invoice || this.creatingAdjustment()) return;
    if (this.adjustmentForm.invalid) {
      this.adjustmentForm.markAllAsTouched();
      return;
    }
    const value = this.adjustmentForm.getRawValue();
    const requestedSubtotal = Number(value.subtotal);
    if (value.type === 'nota_credito' && requestedSubtotal > this.creditableSubtotal(invoice)) {
      this.adjustmentForm.controls.subtotal.setErrors({max: true});
      return;
    }

    this.creatingAdjustment.set(true);
    try {
      const factor = requestedSubtotal / invoice.subtotal;
      let subtotalSum = 0;
      const items = invoice.items.map((item, index) => {
        let subtotal = Number((item.subtotal * factor).toFixed(2));
        if (index === invoice.items.length - 1) {
          subtotal = Number((requestedSubtotal - subtotalSum).toFixed(2));
        }
        subtotalSum = Number((subtotalSum + subtotal).toFixed(2));
        return {
          description: item.description,
          subtotal,
          taxCategory: item.taxCategory ?? 'gravado',
          taxRatePercent: item.taxRatePercent,
        };
      }).filter((item) => item.subtotal > 0);
      const note = await this.api.createFiscalAdjustmentNote({
        type: value.type,
        fiscalInvoiceId: invoice.id,
        reason: value.reason,
        reasonDetails: value.reasonDetails.trim() || undefined,
        items,
      });
      this.invoiceToAdjust.set(null);
      this.adjustmentForm.reset({
        type: 'nota_credito',
        reason: 'devolucion',
        reasonDetails: '',
        subtotal: 0,
      });
      this.openAdjustmentNote(note);
    } catch {
      // The service surfaces API errors; keep the draft available for correction.
    } finally {
      this.creatingAdjustment.set(false);
    }
  }

  public noteNumber(note: FiscalAdjustmentNote): string {
    return `${note.serie}-${String(note.noteNumber).padStart(8, '0')}`;
  }

  public openAdjustmentNote(note: FiscalAdjustmentNote): void {
    this.duplicateAdjustmentPrint.set(false);
    this.selectedAdjustmentNote.set(note);
  }

  public closeAdjustmentNote(): void {
    this.selectedAdjustmentNote.set(null);
  }

  public adjustmentReasonLabel(reason: FiscalAdjustmentReason): string {
    const labels: Record<FiscalAdjustmentReason, string> = {
      devolucion: 'Devolución',
      descuento: 'Descuento',
      bonificacion: 'Bonificación',
      error_precio: 'Error de precio',
      anulacion_parcial: 'Anulación parcial',
      otro: 'Otro',
    };
    return labels[reason];
  }

  public async printAdjustmentNote(): Promise<void> {
    const note = this.selectedAdjustmentNote();
    if (!note || this.printingAdjustment()) return;
    this.printingAdjustment.set(true);
    try {
      const result = await this.api.recordFiscalAdjustmentNotePrint(note.id);
      this.duplicateAdjustmentPrint.set(result.isDuplicate);
      this.selectedAdjustmentNote.set(result.note);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      window.print();
    } catch {
      // The API service reports the failure and the note must not print untracked.
    } finally {
      this.printingAdjustment.set(false);
    }
  }

  public async loadFiscalBooks(): Promise<void> {
    this.booksLoading.set(true);
    this.booksError.set('');
    try {
      const report = await this.api.getFiscalBooks(this.bookYear(), this.bookMonth());
      this.booksReport.set(report);
    } catch (error) {
      this.booksError.set(error instanceof Error ? error.message : 'No se pudieron cargar los libros.');
    } finally {
      this.booksLoading.set(false);
    }
  }

  public setBookYear(value: string): void {
    this.bookYear.set(Number(value));
  }

  public setBookMonth(value: string): void {
    this.bookMonth.set(Number(value));
  }

  public async closeFiscalBooks(): Promise<void> {
    const report = this.booksReport();
    if (!report || report.isClosed || !this.isAdmin()) return;
    const period = `${report.year}-${String(report.month).padStart(2, '0')}`;
    if (!window.confirm(`¿Cerrar definitivamente el período fiscal ${period}? Esta acción bloqueará nuevas facturas, notas y cambios en gastos de ese mes.`)) {
      return;
    }
    try {
      await this.api.closeFiscalBooks(report.year, report.month);
      await this.loadFiscalBooks();
    } catch {
      // The API service surfaces the close failure.
    }
  }

  public exportFiscalBooks(): void {
    const report = this.booksReport();
    if (!report) return;
    const rates = report.salesTotals.taxableBases.map((group) => group.rate);
    exportToCsv(`libro-ventas-${report.year}-${String(report.month).padStart(2, '0')}`, [
      'Fecha', 'Tipo', 'Documento', 'Control', 'Cliente', 'RIF', 'Condición',
      ...rates.flatMap((rate) => [`Base ${rate}%`, `IVA ${rate}%`]),
      'Exento', 'No sujeto', 'IVA total', 'Total',
    ], report.salesRows.map((row) => [
      row.date,
      row.documentType,
      row.documentNumber,
      row.controlNumber,
      row.customerName,
      row.customerTaxId,
      row.saleCondition,
      ...rates.flatMap((rate) => {
        const group = row.taxableBases.find((item) => item.rate === rate);
        return [group?.base || 0, group?.tax || 0];
      }),
      row.exemptAmount,
      row.nonSubjectAmount,
      row.taxAmount,
      row.total,
    ]));
    exportToCsv(`libro-compras-${report.year}-${String(report.month).padStart(2, '0')}`, [
      'Fecha', 'Tipo', 'Documento', 'Proveedor', 'RIF', 'Base gravada', 'Alícuota',
      'IVA', 'Exento', 'No sujeto', 'Retención IVA', 'Total', 'Crédito fiscal',
    ], report.purchaseRows.map((row) => [
      row.date,
      row.documentType,
      row.documentNumber,
      row.supplierName,
      row.supplierTaxId,
      row.taxableBase,
      row.taxRatePercent,
      row.taxAmount,
      row.exemptAmount,
      row.nonSubjectAmount,
      row.vatWithholding,
      row.total,
      row.fiscalCreditEligible ? 'Sí' : 'No',
    ]));
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
