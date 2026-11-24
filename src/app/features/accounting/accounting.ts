import {ChangeDetectionStrategy, Component, computed, effect, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ModuleHelpComponent} from '../../shared/components/module-help/module-help';
import {LEGAL_ENTITY_DRAFT} from '../../core/config/legal-entity-draft';
import {
  Account,
  AccountingBookReport,
  AccountingBookType,
  AccountingEntry,
  AccountingOpeningDraft,
  AccountType,
  createDefaultAccountingOpening,
  newOpeningRowId,
  normalizeOpeningAmount,
  OpeningAdjustmentDirection,
  OpeningAuxiliaryKind,
  OpeningReconciliation,
  summarizeOpening,
} from '../../core/models/erp.models';
import {
  AccountingOpeningPayload,
  ErpApiService,
  OpeningAdjustmentPayload,
} from '../../core/services/erp-api.service';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';
import {
  defaultDocumentRate,
  resolveDocumentRate,
} from '../../core/utils/exchange-rate.utils';

type AccountingTab = 'accounts' | 'opening' | 'entries' | 'books' | 'periods' | 'withholdings';

@Component({
  selector: 'app-accounting',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, MatIconModule, ModuleHelpComponent],
  templateUrl: './accounting.html',
})
export class AccountingComponent {
  public api = inject(ErpApiService);

  /** Ficha jurídica y capital del acta: referencia de solo lectura para #13. */
  public readonly legalEntityDraft = LEGAL_ENTITY_DRAFT;

  public activeTab = signal<AccountingTab>('accounts');
  public accountSearch = signal<string>('');
  public entryPeriodFilter = signal<string>('all');
  public entryStatusFilter = signal<string>('all');
  public selectedEntry = signal<AccountingEntry | null>(null);
  public annulReason = signal<string>('');
  public showAccountModal = signal<boolean>(false);
  public showEntryModal = signal<boolean>(false);
  public showAnnulModal = signal<boolean>(false);

  /** Snapshot en vivo del formulario de apertura para el cuadre inmediato. */
  public openingLive = signal<AccountingOpeningDraft | null>(null);
  private hydratedOpeningAt = '';

  public openingForm = new FormGroup({
    currentName: new FormControl('', {nonNullable: true}),
    convertedName: new FormControl('', {nonNullable: true}),
    legalForm: new FormControl('', {nonNullable: true}),
    reconversionInstrument: new FormControl('', {nonNullable: true}),
    reconversionDate: new FormControl('', {nonNullable: true}),
    cutoffDate: new FormControl('', {nonNullable: true}),
    notes: new FormControl('', {nonNullable: true}),
  });

  public openingGeneralRows = new FormArray<FormGroup>([]);
  public openingAuxRows = new FormArray<FormGroup>([]);
  public openingShareholderRows = new FormArray<FormGroup>([]);

  public openingAdjustmentForm = new FormGroup({
    date: new FormControl(new Date().toISOString().slice(0, 10), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    accountCode: new FormControl('3.01', {nonNullable: true, validators: [Validators.required]}),
    description: new FormControl('', {nonNullable: true, validators: [Validators.required]}),
    direction: new FormControl<OpeningAdjustmentDirection>('credito', {nonNullable: true}),
    amountUsd: new FormControl(0, {nonNullable: true, validators: [Validators.min(0)]}),
    amountBs: new FormControl(0, {nonNullable: true, validators: [Validators.min(0)]}),
    exchangeRateUsed: new FormControl(defaultDocumentRate(this.api.exchangeRates()), {
      nonNullable: true,
      validators: [Validators.min(0)],
    }),
  });

  public bookType = signal<AccountingBookType>('diario');
  public bookYear = signal<number>(new Date().getFullYear());
  public bookMonth = signal<number>(new Date().getMonth() + 1);
  public bookLoading = signal<boolean>(false);

  constructor() {
    const initialOpening =
      this.api.accountingOpening() ||
      createDefaultAccountingOpening(defaultDocumentRate(this.api.exchangeRates()));
    this.hydrateOpening(initialOpening);
    this.openingForm.valueChanges.subscribe(() => this.syncOpeningLive());
    this.openingGeneralRows.valueChanges.subscribe(() => this.syncOpeningLive());
    this.openingAuxRows.valueChanges.subscribe(() => this.syncOpeningLive());
    this.openingShareholderRows.valueChanges.subscribe(() => this.syncOpeningLive());

    effect(() => {
      const opening = this.api.accountingOpening();
      if (opening && opening.updatedAt !== this.hydratedOpeningAt) {
        this.hydrateOpening(opening);
      }
    });

    effect(() => {
      const requested = this.api.requestedAccountingBookType();
      if (!requested) return;
      this.activeTab.set('books');
      this.bookType.set(requested);
      this.api.requestedAccountingBookType.set(null);
      void this.loadAccountingBook();
    });
  }

  public bookTypes: {id: AccountingBookType; label: string}[] = [
    {id: 'diario', label: 'Diario'},
    {id: 'mayor', label: 'Mayor'},
    {id: 'balance_comprobacion', label: 'Balance de comprobación'},
    {id: 'balance_general', label: 'Balance general'},
    {id: 'inventario', label: 'Inventario (VEN-NIF)'},
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

  public accountKinds: NonNullable<Account['kind']>[] = ['otra', 'caja', 'banco'];
  public accountCurrencies: NonNullable<Account['currency']>[] = ['USD', 'Bs', 'AMBAS'];

  public accountForm = new FormGroup({
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d+(\.\d+)*$/)],
    }),
    name: new FormControl('', {nonNullable: true, validators: [Validators.required]}),
    type: new FormControl<AccountType>('activo', {nonNullable: true}),
    nature: new FormControl<'debito' | 'credito'>('debito', {nonNullable: true}),
    parentCode: new FormControl('', {nonNullable: true}),
    description: new FormControl('', {nonNullable: true}),
    kind: new FormControl<NonNullable<Account['kind']>>('otra', {nonNullable: true}),
    bankCode: new FormControl('', {nonNullable: true}),
    bankName: new FormControl('', {nonNullable: true}),
    accountNumber: new FormControl('', {nonNullable: true}),
    currency: new FormControl<NonNullable<Account['currency']>>('USD', {nonNullable: true}),
    referenceBalanceUsd: new FormControl<number>(0, {
      nonNullable: true,
      validators: [Validators.min(0)],
    }),
    referenceBalanceNote: new FormControl('', {nonNullable: true}),
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
    exchangeRateUsed: new FormControl(defaultDocumentRate(this.api.exchangeRates()), {
      nonNullable: true,
      validators: [Validators.min(1)],
    }),
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

  // --- APERTURA #13 ---

  private amountGroup(amount: {
    amountUsd?: number;
    amountBs?: number;
    exchangeRateUsed?: number;
    rateSource?: string;
  }): FormGroup {
    return new FormGroup({
      amountUsd: new FormControl(Number(amount.amountUsd) || 0, {
        nonNullable: true,
        validators: [Validators.min(0)],
      }),
      amountBs: new FormControl(Number(amount.amountBs) || 0, {
        nonNullable: true,
        validators: [Validators.min(0)],
      }),
      exchangeRateUsed: new FormControl(Number(amount.exchangeRateUsed) || 0, {
        nonNullable: true,
        validators: [Validators.min(0)],
      }),
      rateSource: new FormControl(
        (amount.rateSource as 'currentUsd (referencia)' | 'Tasa capturada en apertura') ||
          'currentUsd (referencia)',
        {nonNullable: true}
      ),
    });
  }

  private generalRow(id: string, accountCode: string, amountUsd = 0): FormGroup {
    const fallbackRate = defaultDocumentRate(this.api.exchangeRates());
    const amount = normalizeOpeningAmount({amountUsd, exchangeRateUsed: fallbackRate}, fallbackRate);
    return new FormGroup({
      id: new FormControl(id, {nonNullable: true}),
      accountCode: new FormControl(accountCode, {nonNullable: true, validators: [Validators.required]}),
      memo: new FormControl('', {nonNullable: true}),
      ...this.amountGroup(amount).controls,
    });
  }

  private auxRow(
    id: string,
    kind: OpeningAuxiliaryKind,
    name: string,
    accountCode: string,
    amountUsd = 0
  ): FormGroup {
    const fallbackRate = defaultDocumentRate(this.api.exchangeRates());
    const amount = normalizeOpeningAmount({amountUsd, exchangeRateUsed: fallbackRate}, fallbackRate);
    return new FormGroup({
      id: new FormControl(id, {nonNullable: true}),
      kind: new FormControl(kind, {nonNullable: true}),
      name: new FormControl(name, {nonNullable: true, validators: [Validators.required]}),
      accountCode: new FormControl(accountCode, {nonNullable: true, validators: [Validators.required]}),
      memo: new FormControl('', {nonNullable: true}),
      ...this.amountGroup(amount).controls,
    });
  }

  private shareholderRow(name: string, amountUsd = 0): FormGroup {
    const fallbackRate = defaultDocumentRate(this.api.exchangeRates());
    const amount = normalizeOpeningAmount({amountUsd, exchangeRateUsed: fallbackRate}, fallbackRate);
    return new FormGroup({
      id: new FormControl(newOpeningRowId('ob-acc'), {nonNullable: true}),
      name: new FormControl(name, {nonNullable: true, validators: [Validators.required]}),
      taxId: new FormControl('', {nonNullable: true}),
      contributionType: new FormControl('', {nonNullable: true}),
      accountCode: new FormControl('3.01', {nonNullable: true}),
      ...this.amountGroup(amount).controls,
    });
  }

  private hydrateOpening(opening: AccountingOpeningDraft): void {
    this.hydratedOpeningAt = opening.updatedAt;
    this.openingForm.patchValue(
      {
        currentName: opening.legalEntity.currentName,
        convertedName: opening.legalEntity.convertedName,
        legalForm: opening.legalEntity.legalForm,
        reconversionInstrument: opening.legalEntity.reconversionInstrument,
        reconversionDate: opening.legalEntity.reconversionDate,
        cutoffDate: opening.cutoffDate,
        notes: `${opening.notes}\n\n${opening.legalEntity.notes}`.trim(),
      },
      {emitEvent: false}
    );
    this.openingGeneralRows.clear({emitEvent: false});
    for (const balance of opening.generalBalances) {
      this.openingGeneralRows.push(this.generalRow(balance.id, balance.accountCode), {emitEvent: false});
      this.openingGeneralRows.at(-1)!.patchValue(
        {
          memo: balance.memo || '',
          amountUsd: balance.amountUsd,
          amountBs: balance.amountBs,
          exchangeRateUsed: balance.exchangeRateUsed,
          rateSource: balance.rateSource,
        },
        {emitEvent: false}
      );
    }
    this.openingAuxRows.clear({emitEvent: false});
    for (const balance of opening.auxiliaryBalances) {
      this.openingAuxRows.push(
        this.auxRow(balance.id, balance.kind, balance.name, balance.accountCode),
        {emitEvent: false}
      );
      this.openingAuxRows.at(-1)!.patchValue(
        {
          memo: balance.memo || '',
          amountUsd: balance.amountUsd,
          amountBs: balance.amountBs,
          exchangeRateUsed: balance.exchangeRateUsed,
          rateSource: balance.rateSource,
        },
        {emitEvent: false}
      );
    }
    this.openingShareholderRows.clear({emitEvent: false});
    for (const shareholder of opening.shareholders) {
      this.openingShareholderRows.push(this.shareholderRow(shareholder.name), {emitEvent: false});
      this.openingShareholderRows.at(-1)!.patchValue(
        {
          id: shareholder.id,
          taxId: shareholder.taxId || '',
          contributionType: shareholder.contributionType || '',
          accountCode: shareholder.accountCode || '3.01',
          amountUsd: shareholder.amountUsd,
          amountBs: shareholder.amountBs,
          exchangeRateUsed: shareholder.exchangeRateUsed,
          rateSource: shareholder.rateSource,
        },
        {emitEvent: false}
      );
    }
    this.syncOpeningLive();
  }

  private buildOpeningPayload(): AccountingOpeningPayload {
    const value = this.openingForm.getRawValue();
    const fallbackRate = defaultDocumentRate(this.api.exchangeRates());
    const notes = value.notes.split('\n\nReferencia del acta:')[0]!.trim();
    return {
      legalEntity: {
        currentName: value.currentName,
        convertedName: value.convertedName,
        legalForm: value.legalForm,
        reconversionInstrument: value.reconversionInstrument,
        reconversionDate: value.reconversionDate,
        notes: value.notes.includes('Referencia del acta:')
          ? `Referencia del acta:${value.notes.split('Referencia del acta:')[1]}`
          : '',
      },
      cutoffDate: value.cutoffDate,
      generalBalances: this.openingGeneralRows.getRawValue().map((row) => ({
        id: row['id'],
        accountCode: row['accountCode'],
        memo: row['memo'],
        ...normalizeOpeningAmount(row, fallbackRate),
      })),
      auxiliaryBalances: this.openingAuxRows.getRawValue().map((row) => ({
        id: row['id'],
        kind: row['kind'],
        name: row['name'],
        accountCode: row['accountCode'],
        memo: row['memo'],
        ...normalizeOpeningAmount(row, fallbackRate),
      })),
      shareholders: this.openingShareholderRows.getRawValue().map((row) => ({
        id: row['id'],
        name: row['name'],
        taxId: row['taxId'],
        contributionType: row['contributionType'],
        accountCode: row['accountCode'],
        ...normalizeOpeningAmount(row, fallbackRate),
      })),
      notes,
    };
  }

  private syncOpeningLive(): void {
    const base = this.api.accountingOpening() || createDefaultAccountingOpening();
    const payload = this.buildOpeningPayload();
    this.openingLive.set({
      ...base,
      status: 'borrador',
      postingStatus: 'borrador_provisional',
      legalEntity: payload.legalEntity,
      cutoffDate: payload.cutoffDate,
      generalBalances: payload.generalBalances,
      auxiliaryBalances: payload.auxiliaryBalances,
      shareholders: payload.shareholders,
      notes: payload.notes,
      updatedAt: base.updatedAt,
      updatedBy: base.updatedBy,
    });
  }

  public openingDraft = computed(
    () =>
      this.openingLive() ||
      this.api.accountingOpening() ||
      createDefaultAccountingOpening(defaultDocumentRate(this.api.exchangeRates()))
  );

  public openingReconciliation = computed<OpeningReconciliation>(() =>
    summarizeOpening(this.openingDraft(), this.api.accounts())
  );

  public openingAccountOptions = computed(() =>
    this.api.accounts().filter((account) => account.active && account.level >= 2)
  );
  public openingBankAccounts = computed(() =>
    this.openingAccountOptions().filter((account) => account.kind === 'banco' || account.code.startsWith('1.01'))
  );
  public openingReceivableAccounts = computed(() =>
    this.openingAccountOptions().filter((account) => account.code.startsWith('1.02'))
  );
  public openingPayableAccounts = computed(() =>
    this.openingAccountOptions().filter((account) => account.code.startsWith('2.01'))
  );
  public openingCapitalAccounts = computed(() =>
    this.openingAccountOptions().filter((account) => account.code.startsWith('3'))
  );

  public addGeneralRow(): void {
    this.openingGeneralRows.push(this.generalRow(newOpeningRowId('ob-gen'), ''));
  }

  public addAuxRow(kind: OpeningAuxiliaryKind): void {
    const account = kind === 'banco' ? '1.01.02' : kind === 'clientes' ? '1.02.01' : '2.01.01';
    this.openingAuxRows.push(this.auxRow(newOpeningRowId('ob-aux'), kind, kind, account));
  }

  public addShareholderRow(): void {
    this.openingShareholderRows.push(this.shareholderRow(''));
  }

  public removeRow(array: FormArray<FormGroup>, index: number): void {
    array.removeAt(index);
  }

  public async saveOpening(): Promise<void> {
    if (this.openingForm.invalid) {
      this.openingForm.markAllAsTouched();
      return;
    }
    try {
      await this.api.updateAccountingOpening(this.buildOpeningPayload());
    } catch {
      // El servicio ya mostró el error.
    }
  }

  public async addOpeningAdjustment(): Promise<void> {
    if (this.openingAdjustmentForm.invalid) {
      this.openingAdjustmentForm.markAllAsTouched();
      return;
    }
    const value = this.openingAdjustmentForm.getRawValue();
    if (!Number(value.amountUsd) && !Number(value.amountBs)) {
      this.api.showToast('Ingresa un monto USD o Bs. para el ajuste.', 'error');
      return;
    }
    const payload: OpeningAdjustmentPayload = {
      date: value.date,
      accountCode: value.accountCode,
      description: value.description,
      direction: value.direction,
      amountUsd: value.amountUsd,
      amountBs: value.amountBs,
      exchangeRateUsed: resolveDocumentRate(
        this.api.exchangeRates(),
        value.date,
        value.exchangeRateUsed
      ).rate,
    };
    try {
      await this.api.recordOpeningAdjustment(payload);
      this.openingAdjustmentForm.patchValue({description: '', amountUsd: 0, amountBs: 0});
    } catch {
      // El servicio ya mostró el error.
    }
  }

  public openingMoney(value: number, currency: 'USD' | 'BS'): string {
    return `${currency === 'USD' ? 'USD' : 'Bs.'} ${Number(value || 0).toFixed(2)}`;
  }

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
      type: 'activo',
      nature: 'debito',
      parentCode: '1.01',
      description: '',
      kind: 'otra',
      bankCode: '',
      bankName: '',
      accountNumber: '',
      currency: 'USD',
      referenceBalanceUsd: 0,
      referenceBalanceNote: '',
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
        kind: value.kind,
        bankCode: value.bankCode || undefined,
        bankName: value.bankName || undefined,
        accountNumber: value.accountNumber || undefined,
        currency: value.currency,
        referenceBalanceUsd: value.referenceBalanceUsd,
        referenceBalanceNote: value.referenceBalanceNote || undefined,
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

  /** Actualiza el saldo provisional (#13) sin generar asiento contable. */
  public async updateAccountBalance(account: Account, rawValue: string | number): Promise<void> {
    const referenceBalanceUsd = Number(rawValue);
    if (!Number.isFinite(referenceBalanceUsd) || referenceBalanceUsd < 0) {
      this.api.showToast('El saldo provisional debe ser un número mayor o igual a cero.', 'error');
      return;
    }
    try {
      await this.api.updateAccount(account.id, {referenceBalanceUsd});
      this.api.showToast(
        `Saldo provisional de ${account.code} actualizado (referencia #13, sin asiento).`
      );
    } catch {
      // El servicio ya mostró el error.
    }
  }

  public openEntryModal(): void {
    const date = new Date().toISOString().slice(0, 10);
    this.entryForm.reset({
      date,
      description: '',
      exchangeRateUsed: defaultDocumentRate(this.api.exchangeRates(), date),
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
        exchangeRateUsed: resolveDocumentRate(
          this.api.exchangeRates(),
          value.date,
          value.exchangeRateUsed
        ).rate,
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

  public async verifyHashChain(): Promise<void> {
    try {
      await this.api.verifyAccountingHash();
    } catch {
      // El servicio ya mostró el error en un toast.
    }
  }

  public async rebuildHashChain(): Promise<void> {
    try {
      await this.api.rebuildAccountingHash();
    } catch {
      // El servicio ya mostró el error en un toast.
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
      subtitle: `Período ${report.metadata.periodLabel} · ${report.metadata.provisional ? 'PROVISIONAL' : 'VEN-NIF'} · ${report.metadata.hash}`,
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
