import {ChangeDetectionStrategy, Component, computed, inject, OnInit, signal} from '@angular/core';
import {FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ModuleHelpComponent} from '../../shared/components/module-help/module-help';
import {ErpApiService} from '../../core/services/erp-api.service';
import {
  AccountingBookSettingsInput,
  FiscalReferenceCatalogEntry,
  FiscalReferenceInput,
  FiscalReferenceKind,
  FiscalReferenceTaxpayerType,
  FiscalReferenceValue,
  FiscalReferenceStatus,
  FiscalReferenceValueUnit,
} from '../../core/models/erp.models';

/** Administración de históricos IVA/UT/ISLR y parámetros de la Fase 0 (#13). */
@Component({
  selector: 'app-fiscal-reference-values',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatIconModule, ModuleHelpComponent],
  templateUrl: './fiscal-reference-values.html',
})
export class FiscalReferenceValuesComponent implements OnInit {
  public api = inject(ErpApiService);

  public kind = signal<FiscalReferenceKind>('iva');
  public saving = signal(false);
  public settingsSaving = signal(false);
  public editingId = signal<string | null>(null);
  public annulTargetId = signal<string | null>(null);
  public annulReason = signal('');

  public isAdmin = computed(() => {
    const role = this.api.currentRole();
    return role === 'admin' || role === 'master' || this.api.isMaster();
  });

  public values = computed(() =>
    this.api.fiscalReferenceValues().filter((item) => item.kind === this.kind())
  );

  public active = computed(() =>
    this.kind() === 'iva'
      ? this.api.activeIva()
      : this.kind() === 'ut'
        ? this.api.activeUt()
        : null
  );

  public catalog = computed(() => this.api.fiscalReferenceCatalog());

  /** Estado comprensible del catálogo: solo la tasa general y la UT están validadas. */
  public catalogStatus(item: FiscalReferenceCatalogEntry): string {
    if (item.code === 'IVA-GEN-16') return 'Validado · tasa general';
    if (item.group === 'iva') return 'Por precisar si aplica';
    const loaded = this.api
      .fiscalReferenceValues()
      .some((value) => value.kind === 'islr' && value.conceptCode === item.code);
    return loaded ? 'Cargado en el histórico (solo consulta)' : 'Pendiente del contador';
  }

  public catalogIva = computed<FiscalReferenceCatalogEntry[]>(
    () => this.catalog()?.entries.filter((item) => item.group === 'iva') ?? []
  );

  public catalogIslr = computed<FiscalReferenceCatalogEntry[]>(
    () => this.catalog()?.entries.filter((item) => item.group === 'islr') ?? []
  );

  public form = new FormGroup({
    kind: new FormControl<FiscalReferenceKind>('iva', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    value: new FormControl(16, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0.0001)],
    }),
    valueUnit: new FormControl<FiscalReferenceValueUnit>('percent', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    conceptCode: new FormControl('', {nonNullable: true}),
    conceptLabel: new FormControl('', {nonNullable: true}),
    taxpayerType: new FormControl<FiscalReferenceTaxpayerType | ''>('', {nonNullable: true}),
    sustraendoUt: new FormControl<number | null>(null),
    effectiveFrom: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    effectiveTo: new FormControl('', {nonNullable: true}),
    instrumentType: new FormControl('', {nonNullable: true}),
    instrumentNumber: new FormControl('', {nonNullable: true}),
    officialGazette: new FormControl('', {nonNullable: true}),
    publicationDate: new FormControl('', {nonNullable: true}),
    legalBasis: new FormControl('', {nonNullable: true}),
    notes: new FormControl('', {nonNullable: true}),
    status: new FormControl<FiscalReferenceStatus>('referencia', {nonNullable: true}),
    confirmedByAccountant: new FormControl(false, {nonNullable: true}),
    supportDocument: new FormControl('', {nonNullable: true}),
  });

  public settingsForm = new FormGroup({
    approvedFormats: new FormControl('xlsx,pdf', {nonNullable: true}),
    auxiliaryFormat: new FormControl('csv', {nonNullable: true}),
    pagination: new FormControl('', {nonNullable: true}),
    signatureText: new FormControl('', {nonNullable: true}),
    signatureRole: new FormControl('', {nonNullable: true}),
    accountantSigner: new FormControl('Contador', {nonNullable: true}),
    partnerSigners: new FormControl('Socios', {nonNullable: true}),
    bookPageNumbering: new FormControl('', {nonNullable: true}),
    ratificationInstrument: new FormControl('', {nonNullable: true}),
    exchangeRatePolicy: new FormControl<'documento_con_fallback'>('documento_con_fallback', {
      nonNullable: true,
    }),
    notes: new FormControl('', {nonNullable: true}),
    approvedAt: new FormControl('', {nonNullable: true}),
  });

  public ngOnInit(): void {
    if (!this.isAdmin()) return;
    void this.api.refreshFiscalReferenceCatalog().catch(() => undefined);
    void this.api.refreshFiscalReferenceValues().catch(() => undefined);
    void this.api
      .refreshAccountingBookSettings()
      .then((settings) =>
        this.settingsForm.patchValue({
          approvedFormats: settings.approvedFormats,
          auxiliaryFormat: settings.auxiliaryFormat,
          pagination: settings.pagination,
          signatureText: settings.signatureText,
          signatureRole: settings.signatureRole,
          accountantSigner: settings.accountantSigner || 'Contador',
          partnerSigners: settings.partnerSigners || 'Socios',
          bookPageNumbering: settings.bookPageNumbering || '',
          ratificationInstrument: settings.ratificationInstrument || '',
          exchangeRatePolicy: 'documento_con_fallback',
          notes: settings.notes,
          approvedAt: settings.approvedAt,
        })
      )
      .catch(() => undefined);
  }

  public setKind(kind: FiscalReferenceKind): void {
    this.kind.set(kind);
    this.resetForm();
  }

  public loadCatalogConcept(entry: FiscalReferenceCatalogEntry): void {
    this.kind.set('islr');
    this.editingId.set(null);
    this.form.reset({
      kind: 'islr',
      value: entry.ratePercent ?? 0,
      valueUnit: 'percent',
      conceptCode: entry.code,
      conceptLabel: entry.label,
      taxpayerType: entry.taxpayerTypes[0] ?? '',
      sustraendoUt: entry.sustraendo,
      effectiveFrom: '',
      effectiveTo: '',
      instrumentType: '',
      instrumentNumber: '',
      officialGazette: '',
      publicationDate: '',
      legalBasis: entry.legalBasis,
      notes: entry.notes,
      status: 'referencia',
      confirmedByAccountant: false,
      supportDocument: '',
    });
  }

  public resetForm(): void {
    const kind = this.kind();
    this.editingId.set(null);
    this.form.reset({
      kind,
      value: kind === 'iva' ? 16 : kind === 'ut' ? 43 : 0,
      valueUnit: kind === 'ut' ? 'bs' : 'percent',
      conceptCode: '',
      conceptLabel: '',
      taxpayerType: '',
      sustraendoUt: null,
      effectiveFrom: kind === 'iva' ? '2020-01-01' : kind === 'ut' ? '2025-06-02' : '',
      effectiveTo: '',
      instrumentType: kind === 'ut' ? 'providencia' : kind === 'iva' ? 'decreto' : '',
      instrumentNumber: kind === 'ut' ? 'SNAT/2025/000048' : kind === 'iva' ? '4.079' : '',
      officialGazette:
        kind === 'ut' ? 'G.O. N° 43.140' : kind === 'iva' ? 'G.O. N° 41.788 del 26/12/2019' : '',
      publicationDate: kind === 'ut' ? '2025-06-02' : kind === 'iva' ? '2019-12-26' : '',
      legalBasis: '',
      notes: '',
      status: 'referencia',
      confirmedByAccountant: false,
      supportDocument: '',
    });
  }

  public edit(item: FiscalReferenceValue): void {
    this.kind.set(item.kind);
    this.editingId.set(item.id);
    this.form.patchValue({
      kind: item.kind,
      value: item.value,
      valueUnit: item.valueUnit,
      conceptCode: item.conceptCode,
      conceptLabel: item.conceptLabel,
      taxpayerType: item.taxpayerType,
      sustraendoUt: item.sustraendoUt,
      effectiveFrom: item.effectiveFrom,
      effectiveTo: item.effectiveTo,
      instrumentType: item.instrumentType,
      instrumentNumber: item.instrumentNumber,
      officialGazette: item.officialGazette,
      publicationDate: item.publicationDate,
      legalBasis: item.legalBasis,
      notes: item.notes,
      status: item.status,
      confirmedByAccountant: item.confirmedByAccountant,
      supportDocument: item.supportDocument,
    });
  }

  public async submit(): Promise<void> {
    if (!this.isAdmin() || this.form.invalid || this.saving()) return;
    this.saving.set(true);
    try {
      const raw = this.form.getRawValue();
      const input: FiscalReferenceInput = {
        ...raw,
        conceptCode: raw.conceptCode.trim(),
        conceptLabel: raw.conceptLabel.trim(),
        taxpayerType: raw.taxpayerType || '',
        sustraendoUt: raw.sustraendoUt,
        effectiveTo: raw.effectiveTo || '',
      };
      if (this.editingId()) {
        await this.api.updateFiscalReferenceValue(this.editingId()!, input);
      } else {
        await this.api.createFiscalReferenceValue(input);
      }
      this.resetForm();
    } finally {
      this.saving.set(false);
    }
  }

  public async annul(): Promise<void> {
    const id = this.annulTargetId();
    const reason = this.annulReason().trim();
    if (!this.isAdmin() || !id || reason.length < 3) return;
    this.saving.set(true);
    try {
      await this.api.annulFiscalReferenceValue(id, reason);
      this.annulTargetId.set(null);
      this.annulReason.set('');
    } finally {
      this.saving.set(false);
    }
  }

  public async saveSettings(): Promise<void> {
    if (!this.isAdmin() || this.settingsSaving()) return;
    this.settingsSaving.set(true);
    try {
      const input: AccountingBookSettingsInput = this.settingsForm.getRawValue();
      await this.api.updateAccountingBookSettings(input);
    } finally {
      this.settingsSaving.set(false);
    }
  }
}
