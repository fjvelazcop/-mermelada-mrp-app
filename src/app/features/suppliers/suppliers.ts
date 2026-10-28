import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {
  Supplier,
  SupplierPrice,
  SupplierType,
} from '../../core/models/erp.models';
import {VeCurrencyPipe} from '../../core/pipes/ve-currency.pipe';

@Component({
  selector: 'app-suppliers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, ReactiveFormsModule, VeCurrencyPipe],
  templateUrl: './suppliers.html',
})
export class SuppliersComponent {
  public api = inject(ErpApiService);

  public searchQuery = signal<string>('');
  public typeFilter = signal<string>('all');
  public expandedSupplierId = signal<string | null>(null);
  public isSupplierModalOpen = signal<boolean>(false);
  public isPriceModalOpen = signal<boolean>(false);
  public editingSupplierId = signal<string | null>(null);
  public selectedSupplierForPrice = signal<Supplier | null>(null);

  public supplierForm = new FormGroup({
    businessName: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3)],
    }),
    taxId: new FormControl<string>('J-', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    primaryContact: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    primaryPhone: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    secondaryPhone: new FormControl<string>('', {nonNullable: true}),
    email: new FormControl<string>('', {nonNullable: true}),
    fiscalAddress: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    physicalAddress: new FormControl<string>('', {nonNullable: true}),
    supplierType: new FormControl<SupplierType>('fruta', {nonNullable: true}),
    paymentTerms: new FormControl<string>('Contado', {nonNullable: true}),
    status: new FormControl<'activo' | 'inactivo'>('activo', {
      nonNullable: true,
    }),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  public priceForm = new FormGroup({
    productName: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    materialId: new FormControl<string>('', {nonNullable: true}),
    unit: new FormControl<SupplierPrice['unit']>('kg', {nonNullable: true}),
    priceUsd: new FormControl<number>(1, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0.01)],
    }),
    validFrom: new FormControl<string>(new Date().toISOString().slice(0, 10), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  public supplierTypes: {value: SupplierType; label: string}[] = [
    {value: 'fruta', label: 'Fruta / Pulpa'},
    {value: 'aditivo', label: 'Aditivo / Azúcar'},
    {value: 'empaque', label: 'Empaque / Etiqueta'},
    {value: 'quimico', label: 'Químico / Conservante'},
    {value: 'servicios', label: 'Servicios'},
    {value: 'otro', label: 'Otro'},
  ];

  public suppliers = computed(() => this.api.suppliers());

  public filteredSuppliers = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const type = this.typeFilter();
    return this.suppliers().filter((supplier) => {
      const matchesType = type === 'all' || supplier.supplierType === type;
      if (!matchesType) return false;
      if (!query) return true;
      return (
        supplier.businessName.toLowerCase().includes(query) ||
        supplier.taxId.toLowerCase().includes(query) ||
        supplier.primaryContact.toLowerCase().includes(query) ||
        supplier.code.toLowerCase().includes(query)
      );
    });
  });

  public currentPrices = computed(() =>
    this.api.supplierPrices().filter((price) => price.isCurrent)
  );

  public activeCount = computed(
    () => this.suppliers().filter((supplier) => supplier.status === 'activo').length
  );

  public canCreate = computed(() => this.api.hasPermission('suppliers', 'canCreate'));
  public canEdit = computed(() => this.api.hasPermission('suppliers', 'canEdit'));
  public canDelete = computed(() => this.api.hasPermission('suppliers', 'canDelete'));

  public supplierPrices(supplierId: string): SupplierPrice[] {
    return this.api.supplierPricesFor(supplierId);
  }

  public typeLabel(type: string): string {
    return this.supplierTypes.find((t) => t.value === type)?.label || type;
  }

  public togglePrices(supplierId: string) {
    this.expandedSupplierId.update((current) =>
      current === supplierId ? null : supplierId
    );
  }

  public openNewSupplier() {
    this.editingSupplierId.set(null);
    this.supplierForm.reset({
      businessName: '',
      taxId: 'J-',
      primaryContact: '',
      primaryPhone: '+58 ',
      secondaryPhone: '',
      email: '',
      fiscalAddress: '',
      physicalAddress: '',
      supplierType: 'fruta',
      paymentTerms: 'Contado',
      status: 'activo',
      notes: '',
    });
    this.isSupplierModalOpen.set(true);
  }

  public openEditSupplier(supplier: Supplier) {
    this.editingSupplierId.set(supplier.id);
    this.supplierForm.reset({
      businessName: supplier.businessName,
      taxId: supplier.taxId,
      primaryContact: supplier.primaryContact,
      primaryPhone: supplier.primaryPhone,
      secondaryPhone: supplier.secondaryPhone || '',
      email: supplier.email || '',
      fiscalAddress: supplier.fiscalAddress,
      physicalAddress: supplier.physicalAddress || '',
      supplierType: supplier.supplierType,
      paymentTerms: supplier.paymentTerms,
      status: supplier.status,
      notes: supplier.notes || '',
    });
    this.isSupplierModalOpen.set(true);
  }

  public closeSupplierModal() {
    this.isSupplierModalOpen.set(false);
  }

  public async submitSupplier() {
    if (this.supplierForm.invalid) {
      this.supplierForm.markAllAsTouched();
      return;
    }
    const v = this.supplierForm.getRawValue();
    const payload = {
      businessName: v.businessName,
      taxId: v.taxId,
      primaryContact: v.primaryContact,
      primaryPhone: v.primaryPhone,
      secondaryPhone: v.secondaryPhone || undefined,
      email: v.email || undefined,
      fiscalAddress: v.fiscalAddress,
      physicalAddress: v.physicalAddress || undefined,
      supplierType: v.supplierType,
      paymentTerms: v.paymentTerms,
      status: v.status,
      notes: v.notes || undefined,
    };

    const editingId = this.editingSupplierId();
    if (editingId) {
      await this.api.updateSupplier(editingId, payload);
    } else {
      await this.api.addSupplier(payload);
    }
    this.closeSupplierModal();
  }

  public async deleteSupplier(supplier: Supplier) {
    if (!this.canDelete()) {
      this.api.showToast('No tienes permisos para eliminar proveedores.', 'error');
      return;
    }
    if (
      confirm(
        `¿Eliminar el proveedor "${supplier.businessName}" y todo su historial de precios?`
      )
    ) {
      await this.api.deleteSupplier(supplier.id);
    }
  }

  public openPriceModal(supplier: Supplier) {
    this.selectedSupplierForPrice.set(supplier);
    this.priceForm.reset({
      productName: '',
      materialId: '',
      unit: 'kg',
      priceUsd: 1,
      validFrom: new Date().toISOString().slice(0, 10),
      notes: '',
    });
    this.isPriceModalOpen.set(true);
  }

  public closePriceModal() {
    this.isPriceModalOpen.set(false);
    this.selectedSupplierForPrice.set(null);
  }

  public onMaterialSelected(materialId: string) {
    this.priceForm.controls.materialId.setValue(materialId);
    const material = this.api.rawMaterials().find((m) => m.id === materialId);
    if (material) {
      this.priceForm.patchValue({
        productName: material.name,
        unit: material.unit,
        priceUsd: material.costPerUnit || 1,
      });
    }
  }

  public async submitPrice() {
    const supplier = this.selectedSupplierForPrice();
    if (!supplier || this.priceForm.invalid) {
      this.priceForm.markAllAsTouched();
      return;
    }
    const v = this.priceForm.getRawValue();
    await this.api.addSupplierPrice(supplier.id, {
      materialId: v.materialId || undefined,
      productName: v.productName,
      unit: v.unit,
      priceUsd: Number(v.priceUsd),
      validFrom: v.validFrom,
      notes: v.notes || undefined,
    });
    this.closePriceModal();
  }
}
