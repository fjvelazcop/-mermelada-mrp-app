import {ChangeDetectionStrategy, Component, computed, inject, OnInit, signal} from '@angular/core';
import {FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ModuleHelpComponent} from '../../shared/components/module-help/module-help';
import {ErpApiService} from '../../core/services/erp-api.service';
import {
  ActivationCurrency,
  ActivationRecord,
  ActivationStatus,
  LicenseEvent,
  LicenseAlert,
} from '../../core/models/erp.models';

export interface ActivationPayload {
  clientName: string;
  clientDocument?: string;
  concept: string;
  amount: number;
  currency: ActivationCurrency;
  paymentMethod: string;
  reference?: string;
  paymentDate: string;
  periodStart?: string;
  periodEnd?: string;
  status: ActivationStatus;
  notes?: string;
}

@Component({
  selector: 'app-activation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ReactiveFormsModule, ModuleHelpComponent],
  templateUrl: './activation.html',
})
export class ActivationComponent implements OnInit {
  public api = inject(ErpApiService);

  public searchQuery = signal<string>('');
  public statusFilter = signal<'all' | ActivationStatus>('all');
  public isModalOpen = signal<boolean>(false);
  public editingId = signal<string | null>(null);
  public isSaving = signal<boolean>(false);
  public isLicenseBusy = signal<boolean>(false);

  /** License history (master-only, populated on init). */
  public licenseEvents = signal<LicenseEvent[]>([]);
  public licenseAlerts = signal<LicenseAlert[]>([]);

  public readonly paymentMethods = [
    {value: 'transferencia', label: 'Transferencia bancaria'},
    {value: 'pago_movil', label: 'Pago móvil'},
    {value: 'efectivo_usd', label: 'Efectivo USD'},
    {value: 'efectivo_bs', label: 'Efectivo Bs.'},
    {value: 'zelle', label: 'Zelle'},
    {value: 'usdt', label: 'USDT'},
    {value: 'punto_venta', label: 'Punto de venta'},
    {value: 'otro', label: 'Otro'},
  ];

  public readonly statuses: {value: ActivationStatus; label: string}[] = [
    {value: 'activo', label: 'Activo'},
    {value: 'pendiente', label: 'Pendiente'},
    {value: 'vencido', label: 'Vencido'},
    {value: 'suspendido', label: 'Suspendido'},
  ];

  public activationForm = new FormGroup({
    clientName: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    clientDocument: new FormControl<string>('', {nonNullable: true}),
    concept: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    amount: new FormControl<number>(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0.01)],
    }),
    currency: new FormControl<ActivationCurrency>('USD', {nonNullable: true}),
    paymentMethod: new FormControl<string>('transferencia', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    reference: new FormControl<string>('', {nonNullable: true}),
    paymentDate: new FormControl<string>(this.today(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    periodStart: new FormControl<string>('', {nonNullable: true}),
    periodEnd: new FormControl<string>('', {nonNullable: true}),
    status: new FormControl<ActivationStatus>('activo', {nonNullable: true}),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  public totals = computed(() => {
    const records = this.api.activationRecords();
    return {
      count: records.length,
      active: records.filter((record) => record.status === 'activo').length,
      pending: records.filter(
        (record) => record.status === 'pendiente' || record.status === 'vencido'
      ).length,
      usd: records
        .filter((record) => record.currency === 'USD')
        .reduce((sum, record) => sum + record.amount, 0),
      bs: records
        .filter((record) => record.currency === 'Bs')
        .reduce((sum, record) => sum + record.amount, 0),
    };
  });

  public filteredRecords = computed(() => {
    const term = this.searchQuery().trim().toLowerCase();
    const status = this.statusFilter();
    return this.api.activationRecords().filter((record) => {
      if (status !== 'all' && record.status !== status) return false;
      if (!term) return true;
      return [
        record.clientName,
        record.clientDocument,
        record.concept,
        record.reference,
        record.paymentMethod,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(term));
    });
  });

  public openCreate(): void {
    this.editingId.set(null);
    this.activationForm.reset({
      clientName: '',
      clientDocument: '',
      concept: '',
      amount: 0,
      currency: 'USD',
      paymentMethod: 'transferencia',
      reference: '',
      paymentDate: this.today(),
      periodStart: '',
      periodEnd: '',
      status: 'activo',
      notes: '',
    });
    this.isModalOpen.set(true);
  }

  public openEdit(record: ActivationRecord): void {
    this.editingId.set(record.id);
    this.activationForm.reset({
      clientName: record.clientName,
      clientDocument: record.clientDocument || '',
      concept: record.concept,
      amount: record.amount,
      currency: record.currency,
      paymentMethod: record.paymentMethod,
      reference: record.reference || '',
      paymentDate: record.paymentDate,
      periodStart: record.periodStart || '',
      periodEnd: record.periodEnd || '',
      status: record.status,
      notes: record.notes || '',
    });
    this.isModalOpen.set(true);
  }

  public closeModal(): void {
    if (this.isSaving()) return;
    this.isModalOpen.set(false);
    this.editingId.set(null);
  }

  public async save(): Promise<void> {
    if (this.activationForm.invalid) {
      this.activationForm.markAllAsTouched();
      return;
    }

    const value = this.activationForm.getRawValue();
    const payload: ActivationPayload = {
      clientName: value.clientName.trim(),
      clientDocument: value.clientDocument.trim() || undefined,
      concept: value.concept.trim(),
      amount: Number(value.amount),
      currency: value.currency,
      paymentMethod: value.paymentMethod,
      reference: value.reference.trim() || undefined,
      paymentDate: value.paymentDate,
      periodStart: value.periodStart || undefined,
      periodEnd: value.periodEnd || undefined,
      status: value.status,
      notes: value.notes.trim() || undefined,
    };

    this.isSaving.set(true);
    try {
      const id = this.editingId();
      if (id) {
        await this.api.updateActivation(id, payload);
      } else {
        await this.api.addActivation(payload);
      }
      this.closeModal();
    } catch {
      // The API service already surfaced the failure reason.
    } finally {
      this.isSaving.set(false);
    }
  }

  public async remove(record: ActivationRecord): Promise<void> {
    if (
      !confirm(
        `¿Eliminar el registro de "${record.clientName}" por ${this.formatAmount(record)}?\n\nEsta acción no se puede deshacer.`
      )
    ) {
      return;
    }
    try {
      await this.api.deleteActivation(record.id);
    } catch {
      // Toast handled by the API service.
    }
  }

  public formatAmount(record: ActivationRecord): string {
    return record.currency === 'USD'
      ? this.formatUsd(record.amount)
      : this.formatBs(record.amount);
  }

  public formatUsd(amount: number): string {
    return new Intl.NumberFormat('es-VE', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount);
  }

  public formatBs(amount: number): string {
    return new Intl.NumberFormat('es-VE', {
      style: 'currency',
      currency: 'VES',
      minimumFractionDigits: 2,
    }).format(amount);
  }

  public paymentMethodLabel(value: string): string {
    return this.paymentMethods.find((method) => method.value === value)?.label || value;
  }

  public statusLabel(value: ActivationStatus): string {
    return this.statuses.find((status) => status.value === value)?.label || value;
  }

  public statusClasses(value: ActivationStatus): string {
    switch (value) {
      case 'activo':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'pendiente':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'vencido':
        return 'bg-rose-50 text-rose-800 border-rose-200';
      default:
        return 'bg-stone-100 text-stone-700 border-stone-200';
    }
  }

  public ngOnInit(): void {
    this.api.refreshLicense().catch(() => {/* non-blocking */});
    this.api.refreshLicenseAdminData().catch(() => {/* non-blocking */});
  }

  public readonly applyToken = signal<string>('');

  public readonly licenceExpiresDisplay = computed(() => {
    const lic = this.api.systemLicense();
    if (!lic) return '—';
    return new Date(lic.expiresAt).toLocaleDateString('es-VE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  });

  public licenseModeClass(mode: string): string {
    switch (mode) {
      case 'normal':
        return 'bg-emerald-50 text-emerald-800';
      case 'aviso':
        return 'bg-amber-50 text-amber-800';
      case 'gracia':
        return 'bg-rose-50 text-rose-800';
      default:
        return 'bg-stone-100 text-stone-700';
    }
  }

  public async applyLicense(): Promise<void> {
    const token = this.applyToken().trim();
    if (!token) {
      this.api.showToast('Ingrese un token de licencia', 'error');
      return;
    }
    this.isSaving.set(true);
    try {
      await this.api.applyLicenseToken(token);
      this.applyToken.set('');
    } catch {
      // The API service already surfaced the failure reason.
    } finally {
      this.isSaving.set(false);
    }
  }

  public copySshCommand(): void {
    const command = `ssh mermelada-erp 'cd /opt/mermelada && node scripts/license.mjs apply "<TOKEN_FIRMADO>"'`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(command)
        .then(() => this.api.showToast('Comando SSH copiado al portapapeles'))
        .catch(() => this.api.showToast('No se pudo copiar el comando', 'error'));
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = command;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    this.api.showToast('Comando SSH copiado al portapapeles');
  }

  public async suspendLicense(): Promise<void> {
    if (!confirm('¿Suspender la licencia global? El sistema quedará en modo solo lectura.')) {
      return;
    }
    this.isLicenseBusy.set(true);
    try {
      await this.api.suspendLicense('Suspendida desde el panel Master');
    } catch {
      // The API service already surfaced the failure reason.
    } finally {
      this.isLicenseBusy.set(false);
    }
  }

  public async sendLicenseTestEmail(): Promise<void> {
    this.isLicenseBusy.set(true);
    try {
      await this.api.sendLicenseTestEmail();
    } catch {
      // The API service already surfaced the failure reason.
    } finally {
      this.isLicenseBusy.set(false);
    }
  }

  public async runLicenseAlertCheck(): Promise<void> {
    this.isLicenseBusy.set(true);
    try {
      await this.api.runLicenseAlertCheck();
    } catch {
      // The API service already surfaced the failure reason.
    } finally {
      this.isLicenseBusy.set(false);
    }
  }

  public licenseEventLabel(action: string): string {
    const labels: Record<string, string> = {
      issue: 'Emitida',
      apply: 'Aplicada',
      suspend: 'Suspendida',
      reactivate: 'Reactivada',
      alert: 'Alerta enviada',
      check: 'Revisión',
    };
    return labels[action] || action;
  }

  public licenseAlertClasses(status: string): string {
    return status === 'sent' || status === 'enviado'
      ? 'bg-emerald-50 text-emerald-800'
      : status === 'error' || status === 'failed'
        ? 'bg-rose-50 text-rose-800'
        : 'bg-stone-100 text-stone-700';
  }

  public formatLicenseDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleString('es-VE', {dateStyle: 'short', timeStyle: 'short'});
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
