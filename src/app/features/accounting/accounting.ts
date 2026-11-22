import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {
  Account,
  AccountingBookReport,
  AccountingBookType,
  AccountingEntry,
  AccountType,
} from '../../core/models/erp.models';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';

type AccountingTab = 'accounts' | 'entries' | 'books' | 'periods' | 'withholdings';

@Component({
  selector: 'app-accounting',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, MatIconModule],
  templateUrl: './accounting.html',
})
export class AccountingComponent {
  public api = inject(ErpApiService);

  public activeTab = signal<AccountingTab>('accounts');
  public accountSearch = signal<string>('');
  public entryPeriodFilter = signal<string>('all');
  public entryStatusFilter = signal<string>('all');
  public selectedEntry = signal<AccountingEntry | null>(null);
  public annulReason = signal<string>('');
  public showAccountModal = signal<boolean>(false);
  public showEntryModal = signal<boolean>(false);
  public showAnnulModal = signal<boolean>(false);

  public bookType = signal<AccountingBookType>('diario');
  public bookYear = signal<number>(new Date().getFullYear());
  public bookMonth = signal<number>(new Date().getMonth() + 1);
  public bookLoading = signal<boolean>(false);

  public bookTypes: {id: AccountingBookType; label: string}[] = [
    {id: 'diario', label: 'Diario'},
    {id: 'mayor', label: 'Mayor'},
    {id: 'balance_comprobacion', label: 'Balance de comprobación'},
    {id: 'balance_general', label: 'Balance general'},
    {id: 'inventario', label: 'Inventario (borrador/prueba)'},
    {id: 'estado_resultados', label: 'Estado de resultados'},
    {id: 'compras', label: 'Compras'},
    {id: 'ventas', label: 'Ventas'},
    {id: 'retenciones', label: 'Retenciones (vacío)'},
    {id: 'caja_banco', label: 'Caja y Banco'},
    {id: 'auxiliar_cxc', label: 'Auxiliar CxC'},
    {id: 'auxiliar_cxp', label: 'Auxiliar CxP'},
  ];

  public accountTypes: AccountType[] = [
    'activo',
    'pasivo',
    'patrimonio',
    'ingreso',
    'gasto',
    'costo',
  ];

  public accountForm = new FormGroup({
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d+(\.\d+)*$/)],
    }),
    name: new FormControl('', {nonNullable: true, validators: [Validators.required]}),
    type: new FormControl<AccountType>('gasto', {nonNullable: true}),
    nature: new FormControl<'debito' | 'credito'>('debito', {nonNullable: true}),
    parentCode: new FormControl('', {nonNullable: true}),
    description: new FormControl('', {nonNullable: true}),
  });

  private newEntryLine(): FormGroup {
    return new FormGroup({
      accountCode: new FormControl('', {nonNullable: true, validators: [Validators.required]}),
      debit: new FormControl(0, {nonNullable: true, validators: [Validators.min(0)]}),
      credit: new FormControl(0, {nonNullable: true, validators: [Validators.min(0)]}),
      memo: new FormControl('', {nonNullable: true}),
    });
  }

  public entryForm = new FormGroup({
    date: new FormControl(new Date().toISOString().slice(0, 10), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    description: new FormControl('', {nonNullable: true, validators: [Validators.required]}),
    lines: new FormArray<FormGroup>([this.newEntryLine(), this.newEntryLine()]),
  });

  public filteredAccounts = computed(() => {
    const query = this.accountSearch().trim().toLowerCase();
    const accounts = this.api.accounts();
    if (!query) return accounts;
    return accounts.filter((account) =>
      `${account.code} ${account.name}`.toLowerCase().includes(query)
    );
  });

  public filteredEntries = computed(() => {
    const period = this.entryPeriodFilter();
    const status = this.entryStatusFilter();
    return this.api.accountingEntries().filter((entry) => {
      if (period !== 'all' && entry.periodKey !== period) return false;
      if (status !== 'all' && entry.status !== status) return false;
      return true;
    });
  });

  public availablePeriods = computed(() => {
    const keys = new Set<string>([
      ...this.api.accountingPeriods().map((period) => period.key),
      ...this.api.accountingEntries().map((entry) => entry.periodKey),
    ]);
    return [...keys].sort().reverse();
  });

  public activeAccountCount = computed(() => this.api.accounts().filter((a) => a.active).length);

  public activeEntries = computed(() =>
    this.api.accountingEntries().filter((entry) => entry.status !== 'anulado')
  );

  public totalPostedUsd = computed(() =>
    this.activeEntries().reduce((sum, entry) => sum + entry.totalDebit, 0)
  );

  public openPeriods = computed(() =>
    this.api.accountingPeriods().filter((period) => period.status === 'abierto').length
  );

  public get lineGroups(): FormGroup[] {
    return this.entryForm.controls.lines.controls;
  }

  public accountName(code: string): string {
    return this.api.accounts().find((account) => account.code === code)?.name || code;
  }

  public openAccountModal(): void {
    this.accountForm.reset({
      code: '',
      name: '',
      type: 'gasto',
      nature: 'debito',
      parentCode: '',
      description: '',
    });
    this.showAccountModal.set(true);
  }

  public async saveAccount(): Promise<void> {
    if (this.accountForm.invalid) {
      this.accountForm.markAllAsTouched();
      return;
    }
    const value = this.accountForm.getRawValue();
    try {
      await this.api.addAccount({
        code: value.code,
        name: value.name,
        type: value.type,
        nature: value.nature,
        parentCode: value.parentCode || undefined,
        description: value.description || undefined,
        active: true,
      });
      this.showAccountModal.set(false);
    } catch {
      // El servicio ya mostró el error.
    }
  }

  public async toggleAccount(account: Account): Promise<void> {
    try {
      await this.api.updateAccount(account.id, {active: !account.active});
    } catch {
      // El servicio ya mostró el error.
    }
  }

  public openEntryModal(): void {
    this.entryForm.reset({
      date: new Date().toISOString().slice(0, 10),
      description: '',
    });
    this.entryForm.setControl('lines', new FormArray<FormGroup>([this.newEntryLine(), this.newEntryLine()]));
    this.showEntryModal.set(true);
  }

  public addLine(): void {
    this.entryForm.controls.lines.push(this.newEntryLine());
  }

  public removeLine(index: number): void {
    if (this.entryForm.controls.lines.length <= 2) return;
    this.entryForm.controls.lines.removeAt(index);
  }

  public entryDebitTotal(): number {
    return this.lineGroups.reduce((sum, line) => sum + (Number(line.controls['debit'].value) || 0), 0);
  }

  public entryCreditTotal(): number {
    return this.lineGroups.reduce((sum, line) => sum + (Number(line.controls['credit'].value) || 0), 0);
  }

  public entryIsBalanced(): boolean {
    return Math.abs(this.entryDebitTotal() - this.entryCreditTotal()) < 0.01;
  }

  public async saveEntry(): Promise<void> {
    if (this.entryForm.invalid) {
      this.entryForm.markAllAsTouched();
      return;
    }
    if (!this.entryIsBalanced()) {
      this.api.showToast('El asiento no está balanceado: débitos y créditos deben coincidir.', 'error');
      return;
    }
    const value = this.entryForm.getRawValue();
    try {
      const entry = await this.api.createAccountingEntry({
        date: value.date,
        description: value.description,
        lines: value.lines
          .map((line) => ({
            accountCode: line['accountCode'],
            debit: Number(line['debit']) || 0,
            credit: Number(line['credit']) || 0,
            memo: line['memo'] || undefined,
          }))
          .filter((line) => line.debit > 0 || line.credit > 0),
      });
      this.selectedEntry.set(entry);
      this.showEntryModal.set(false);
    } catch {
      // El servicio ya mostró el error.
    }
  }

  public async confirmEntry(entry: AccountingEntry): Promise<void> {
    try {
      await this.api.confirmAccountingEntry(entry.id);
    } catch {
      // El servicio ya mostró el error.
    }
  }

  public openAnnulModal(entry: AccountingEntry): void {
    this.selectedEntry.set(entry);
    this.annulReason.set('');
    this.showAnnulModal.set(true);
  }

  public async annulEntry(): Promise<void> {
    const entry = this.selectedEntry();
    if (!entry || !this.annulReason().trim()) return;
    try {
      await this.api.annulAccountingEntry(entry.id, this.annulReason());
      this.showAnnulModal.set(false);
    } catch {
      // El servicio ya mostró el error.
    }
  }

  public async setPeriodStatus(key: string, status: 'abierto' | 'cerrado'): Promise<void> {
    try {
      await this.api.setAccountingPeriodStatus(key, status);
    } catch {
      // El servicio ya mostró el error.
    }
  }

  public exportEntries(format: 'csv' | 'excel'): void {
    const headers = [
      'Número',
      'Fecha',
      'Descripción',
      'Período',
      'Estado',
      'Origen',
      'Débito USD',
      'Crédito USD',
    ];
    const rows = this.filteredEntries().map((entry) => [
      entry.entryNumber,
      entry.date,
      entry.description,
      entry.periodKey,
      entry.status,
      entry.sourceType,
      entry.totalDebit,
      entry.totalCredit,
    ]);
    if (format === 'csv') {
      exportToCsv('libro-diario', headers, rows);
    } else {
      exportToExcel('libro-diario', 'Libro Diario', headers, rows, {
        empresa: this.api.fiscalSettings()?.companyName,
        rif: this.api.fiscalSettings()?.companyTaxId,
        moneda: 'USD',
      });
    }
  }

  public async loadAccountingBook(): Promise<void> {
    this.bookLoading.set(true);
    try {
      await this.api.getAccountingBook(this.bookType(), this.bookYear(), this.bookMonth());
    } catch {
      // El servicio ya mostró el error.
    } finally {
      this.bookLoading.set(false);
    }
  }

  private bookExportRows(report: AccountingBookReport): (string | number | null)[][] {
    const width = Math.max(report.headers.length, 1);
    const pad = (cells: (string | number | null)[]): (string | number | null)[] => [
      ...cells,
      ...Array<string | number | null>(Math.max(0, width - cells.length)).fill(''),
    ];
    const meta = report.metadata;
    return [
      pad([report.title]),
      pad([`Período: ${meta.periodLabel} · ${meta.startDate} al ${meta.endDate}`]),
      pad([`Razón social: ${meta.companyName} · RIF: ${meta.taxId}`]),
      pad([`Dirección fiscal: ${meta.fiscalAddress}`]),
      pad([`Moneda: ${meta.currencyLabel} · Tasa de referencia: ${meta.exchangeRateUsed}`]),
      pad([
        `Estado del período: ${report.periodStatus} · Generado: ${meta.generatedAt} por ${meta.generatedBy}`,
      ]),
      pad([`Saldo de control: ${meta.totalControl.toFixed(2)} · Hash: ${meta.hash}`]),
      ...report.rows.map((item) => pad(item.cells)),
      ...report.notes.map((note) => pad([`* ${note}`])),
      pad([meta.signatureLabel]),
    ];
  }

  public async exportAccountingBook(format: 'csv' | 'excel' | 'pdf'): Promise<void> {
    const report = this.api.accountingBook();
    if (!report) {
      this.api.showToast('Primero genera el libro para el período seleccionado.', 'error');
      return;
    }
    const filename = `libro-${report.type}-${report.periodKey}`;
    const rows = this.bookExportRows(report);
    if (format === 'csv') {
      exportToCsv(filename, report.headers, rows);
      return;
    }
    if (format === 'excel') {
      exportToExcel(filename, report.title.slice(0, 31), report.headers, rows, {
        empresa: report.metadata.companyName,
        rif: report.metadata.taxId,
        fecha: report.metadata.generatedAt,
        tasaCambio: String(report.metadata.exchangeRateUsed),
        moneda: 'USD',
      });
      return;
    }
    await exportToPdf({
      title: report.title,
      subtitle: `Período ${report.metadata.periodLabel} · PROVISIONAL · ${report.metadata.hash}`,
      empresa: report.metadata.companyName,
      rif: report.metadata.taxId,
      exchangeRateUsed: report.metadata.exchangeRateUsed,
      currencyLabel: 'USD',
      headers: report.headers,
      rows: report.rows.map((item) => item.cells),
      totals: report.totals.map((item) => ({label: item.label, value: item.value.toFixed(2)})),
      notes: `${report.notes.join(' · ')} · ${report.metadata.signatureLabel}`,
    });
  }

  public trackById(_: number, item: {id: string}): string {
    return item.id;
  }
}
