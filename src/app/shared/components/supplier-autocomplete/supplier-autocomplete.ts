import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormControl,
  FormGroup,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../../core/services/erp-api.service';
import {
  DEFAULT_SUPPLIER_TYPES,
  Supplier,
} from '../../../core/models/erp.models';
import {
  isValidTaxId,
  normalizeTaxId,
  sameTaxId,
} from '../../../core/utils/tax-id.utils';

export interface SupplierSelection {
  supplierId: string;
  businessName: string;
  taxId: string;
  eventual?: boolean;
}

/**
 * Selector reutilizable del maestro de proveedores.
 *
 * El valor del control es la razón social (texto), por lo que puede usarse con
 * `formControlName` en cualquier formulario reactivo. La selección estructurada
 * se expone por `supplierSelected` para persistir `supplierId` y el RIF/Cédula.
 */
@Component({
  selector: 'app-supplier-autocomplete',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatIconModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SupplierAutocompleteComponent),
      multi: true,
    },
  ],
  templateUrl: './supplier-autocomplete.html',
})
export class SupplierAutocompleteComponent implements ControlValueAccessor {
  public api = inject(ErpApiService);

  public label = input<string>('Proveedor o Beneficiario');
  public placeholder = input<string>('Busca por razón social, código, RIF/Cédula o contacto');
  public id = input<string>('supplier-autocomplete');
  public required = input<boolean>(false);
  public showQuickCreate = input<boolean>(true);
  public allowEventual = input<boolean>(false);

  public supplierSelected = output<SupplierSelection>();

  public query = signal<string>('');
  public disabled = signal<boolean>(false);
  public showCreateForm = signal<boolean>(false);
  public duplicate = signal<Supplier | null>(null);
  public formError = signal<string>('');

  public quickForm = new FormGroup({
    businessName: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    taxId: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(60)],
    }),
    primaryContact: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    primaryPhone: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(60)],
    }),
    fiscalAddress: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(500)],
    }),
    supplierType: new FormControl<string>('servicios', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    paymentTerms: new FormControl<string>('Contado', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    status: new FormControl<'activo' | 'inactivo'>('activo', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  public suggestions = computed<Supplier[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (q.length < 2) return [];
    return this.api
      .suppliers()
      .filter((s) =>
        [s.businessName, s.code, s.taxId, s.primaryContact].some((field) =>
          (field || '').toLowerCase().includes(q)
        )
      )
      .slice(0, 8);
  });

  public exactMatch = computed<Supplier | undefined>(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return undefined;
    return this.api.suppliers().find(
      (s) => s.businessName.toLowerCase() === q || sameTaxId(s.taxId, q)
    );
  });

  public datalistId = computed(() => `supplier-options-${this.id()}`);

  public supplierTypeOptions = computed(() => {
    const active = this.api.supplierTypes().filter((t) => t.active);
    return active.length ? active : DEFAULT_SUPPLIER_TYPES.filter((t) => t.active);
  });

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  public writeValue(value: unknown): void {
    this.query.set(typeof value === 'string' ? value : '');
  }

  public registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  public onInput(value: string): void {
    this.query.set(value);
    this.onChange(value);
    this.duplicate.set(null);
    this.formError.set('');
    const match = this.exactMatch();
    if (match) {
      this.selectSupplier(match);
    }
  }

  public onBlur(): void {
    this.onTouched();
  }

  public selectSupplier(supplier: Supplier): void {
    this.query.set(supplier.businessName);
    this.onChange(supplier.businessName);
    this.onTouched();
    this.supplierSelected.emit({
      supplierId: supplier.id,
      businessName: supplier.businessName,
      taxId: normalizeTaxId(supplier.taxId),
    });
    this.showCreateForm.set(false);
    this.duplicate.set(null);
    this.formError.set('');
  }

  public clearSupplier(): void {
    this.query.set('');
    this.onChange('');
    this.supplierSelected.emit({supplierId: '', businessName: '', taxId: ''});
    this.showCreateForm.set(false);
    this.duplicate.set(null);
    this.formError.set('');
  }

  public useEventualBeneficiary(): void {
    this.onTouched();
    this.supplierSelected.emit({
      supplierId: '',
      businessName: this.query().trim(),
      taxId: '',
      eventual: true,
    });
    this.showCreateForm.set(false);
  }

  public openQuickCreate(): void {
    const types = this.supplierTypeOptions();
    this.quickForm.reset({
      businessName: this.query().trim(),
      taxId: isValidTaxId(this.query()) ? normalizeTaxId(this.query()) : '',
      primaryContact: '',
      primaryPhone: '',
      fiscalAddress: '',
      supplierType: types[0]?.code || 'servicios',
      paymentTerms: 'Contado',
      status: 'activo',
    });
    this.showCreateForm.set(true);
    this.duplicate.set(null);
    this.formError.set('');
  }

  public closeQuickCreate(): void {
    this.showCreateForm.set(false);
    this.duplicate.set(null);
    this.formError.set('');
  }

  public async submitQuickCreate(): Promise<void> {
    if (this.quickForm.invalid) {
      this.quickForm.markAllAsTouched();
      this.formError.set('Completa los campos obligatorios del proveedor.');
      return;
    }
    const v = this.quickForm.getRawValue();
    const taxId = normalizeTaxId(v.taxId);
    if (!isValidTaxId(taxId)) {
      this.formError.set(
        'El RIF/Cédula debe tener prefijo V-, J-, G-, E- o C- y entre 6 y 9 dígitos.'
      );
      return;
    }
    const existing = this.api
      .suppliers()
      .find((s) => sameTaxId(s.taxId, taxId));
    if (existing) {
      this.duplicate.set(existing);
      this.formError.set('Ya existe un proveedor con este RIF/Cédula.');
      return;
    }
    try {
      const created = await this.api.addSupplier({
        businessName: v.businessName.trim(),
        taxId,
        primaryContact: v.primaryContact.trim(),
        primaryPhone: v.primaryPhone.trim(),
        fiscalAddress: v.fiscalAddress.trim(),
        supplierType: v.supplierType,
        paymentTerms: v.paymentTerms.trim(),
        status: v.status,
      });
      this.selectSupplier(created);
    } catch (err: unknown) {
      this.formError.set(
        err instanceof Error ? err.message : 'No se pudo registrar el proveedor.'
      );
    }
  }

  public useExistingDuplicate(): void {
    const supplier = this.duplicate();
    if (supplier) this.selectSupplier(supplier);
  }

  public supplierTypeLabel(code: string): string {
    return this.supplierTypeOptions().find((t) => t.code === code)?.label || code;
  }
}
