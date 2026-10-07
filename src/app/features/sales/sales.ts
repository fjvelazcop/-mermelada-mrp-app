import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {DeliveryNote} from '../../core/models/erp.models';

@Component({
  selector: 'app-sales',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, ReactiveFormsModule],
  templateUrl: './sales.html',
})
export class SalesComponent {
  public api = inject(ErpApiService);

  public isNewOrderModalOpen = signal<boolean>(false);
  public isNewCustomerModalOpen = signal<boolean>(false);
  public isDeliveryNoteModalOpen = signal<boolean>(false);
  public isFiscalConfigModalOpen = signal<boolean>(false);

  public selectedDeliveryNote = signal<DeliveryNote | null>(null);

  // Forms
  public newCustomerForm = new FormGroup({
    businessName: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    taxId: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    contactPerson: new FormControl<string>('', {nonNullable: true}),
    phone: new FormControl<string>('', {nonNullable: true}),
    email: new FormControl<string>('', {nonNullable: true}),
    address: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    clientType: new FormControl<'panaderia' | 'fabricante_bocadillos' | 'pasteleria' | 'distribuidor' | 'otro'>('panaderia', {nonNullable: true}),
    creditLimit: new FormControl<number>(500, {nonNullable: true}),
    paymentTerms: new FormControl<string>('Contado contra entrega', {nonNullable: true}),
  });

  public newOrderForm = new FormGroup({
    customerId: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    finishedGoodId: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    quantity: new FormControl<number>(24, {nonNullable: true, validators: [Validators.required, Validators.min(1)]}),
    unitPrice: new FormControl<number>(1.65, {nonNullable: true, validators: [Validators.required, Validators.min(0.1)]}),
    deliveryDate: new FormControl<string>(new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10), {nonNullable: true}),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  public fiscalConfigForm = new FormGroup({
    enabled: new FormControl<boolean>(true, {nonNullable: true}),
    companyName: new FormControl<string>('Mermeladas Artesanales del Valle C.A.', {nonNullable: true}),
    companyTaxId: new FormControl<string>('J-40899231-0', {nonNullable: true}),
    fiscalAddress: new FormControl<string>('Zona Industrial El Valle, Galpón PulpaCraft 4', {nonNullable: true}),
    taxRatePercent: new FormControl<number>(16.0, {nonNullable: true}),
    invoicePrefix: new FormControl<string>('FACT-', {nonNullable: true}),
    nextInvoiceNumber: new FormControl<number>(402, {nonNullable: true}),
    authorizationCode: new FormControl<string>('SENIAT-PROV-2026-00914', {nonNullable: true}),
    printNotes: new FormControl<string>('Contribuyente Ordinario. Retención de IVA aplicable según normativa fiscal vigente.', {nonNullable: true}),
  });

  public customers = computed(() => this.api.customers());
  public salesOrders = computed(() => this.api.salesOrders());
  public deliveryNotes = computed(() => this.api.deliveryNotes());
  public finishedGoods = computed(() => this.api.finishedGoods());
  public fiscalSettings = computed(() => this.api.fiscalSettings());

  public openNewOrderModal() {
    const custs = this.customers();
    const fgs = this.finishedGoods();
    this.newOrderForm.patchValue({
      customerId: custs[0]?.id || '',
      finishedGoodId: fgs[0]?.id || '',
      quantity: 24,
      unitPrice: fgs[0]?.suggestedWholesalePrice || 1.65,
      notes: '',
    });
    this.isNewOrderModalOpen.set(true);
  }

  public onProductSelectChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const fg = this.finishedGoods().find(f => f.id === select.value);
    if (fg) {
      this.newOrderForm.patchValue({ unitPrice: fg.suggestedWholesalePrice });
    }
  }

  public closeNewOrderModal() {
    this.isNewOrderModalOpen.set(false);
  }

  public async submitSalesOrder() {
    if (this.newOrderForm.invalid) return;
    const v = this.newOrderForm.getRawValue();
    const cust = this.customers().find(c => c.id === v.customerId);
    const fg = this.finishedGoods().find(f => f.id === v.finishedGoodId);
    if (!cust || !fg) return;

    const subtotal = Number((Number(v.quantity) * Number(v.unitPrice)).toFixed(2));
    const taxRate = this.fiscalSettings()?.taxRatePercent || 16.0;
    const taxAmount = Number(((subtotal * taxRate) / 100).toFixed(2));
    const total = Number((subtotal + taxAmount).toFixed(2));

    await this.api.addSalesOrder({
      customerId: cust.id,
      customerName: cust.businessName,
      customerTaxId: cust.taxId,
      orderDate: new Date().toISOString().slice(0, 10),
      deliveryDate: v.deliveryDate,
      status: fg.availableUnits >= Number(v.quantity) ? 'listo_despacho' : 'pendiente',
      items: [
        {
          finishedGoodId: fg.id,
          flavor: fg.flavor,
          presentation: fg.presentation,
          presentationLabel: fg.presentationLabel,
          quantity: Number(v.quantity),
          unitPrice: Number(v.unitPrice),
          subtotal,
        },
      ],
      subtotal,
      taxAmount,
      total,
      notes: v.notes,
    });

    this.closeNewOrderModal();
  }

  public openNewCustomerModal() {
    this.newCustomerForm.reset({
      businessName: '',
      taxId: 'J-',
      contactPerson: '',
      phone: '',
      email: '',
      address: '',
      clientType: 'panaderia',
      creditLimit: 500,
      paymentTerms: 'Contado contra entrega',
    });
    this.isNewCustomerModalOpen.set(true);
  }

  public closeNewCustomerModal() {
    this.isNewCustomerModalOpen.set(false);
  }

  public async submitNewCustomer() {
    if (this.newCustomerForm.invalid) return;
    const v = this.newCustomerForm.getRawValue();
    await this.api.addCustomer({
      businessName: v.businessName,
      taxId: v.taxId,
      contactPerson: v.contactPerson,
      phone: v.phone,
      email: v.email,
      address: v.address,
      clientType: v.clientType,
      creditLimit: Number(v.creditLimit),
      paymentTerms: v.paymentTerms,
    });
    this.closeNewCustomerModal();
  }

  public async triggerMTO(salesOrderId: string) {
    await this.api.triggerMTOProduction(salesOrderId);
  }

  public async generateDeliveryNote(salesOrderId: string) {
    const note = await this.api.generateDeliveryNote(salesOrderId);
    this.viewDeliveryNote(note);
  }

  public viewDeliveryNote(note: DeliveryNote) {
    this.selectedDeliveryNote.set(note);
    this.isDeliveryNoteModalOpen.set(true);
  }

  public closeDeliveryNoteModal() {
    this.isDeliveryNoteModalOpen.set(false);
    this.selectedDeliveryNote.set(null);
  }

  public printDeliveryNote() {
    window.print();
  }

  public openFiscalConfigModal() {
    const cfg = this.fiscalSettings();
    if (cfg) {
      this.fiscalConfigForm.patchValue(cfg);
    }
    this.isFiscalConfigModalOpen.set(true);
  }

  public closeFiscalConfigModal() {
    this.isFiscalConfigModalOpen.set(false);
  }

  public async saveFiscalConfig() {
    if (this.fiscalConfigForm.invalid) return;
    await this.api.saveFiscalSettings(this.fiscalConfigForm.getRawValue());
    this.closeFiscalConfigModal();
  }
}
