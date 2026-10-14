import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {DeliveryNote} from '../../core/models/erp.models';
import {VeCurrencyPipe, VeNumberPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf, downloadDeliveryNotePdf} from '../../core/utils/export.utils';

@Component({
  selector: 'app-sales',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ReactiveFormsModule, VeCurrencyPipe, VeNumberPipe],
  templateUrl: './sales.html',
})
export class SalesComponent {
  public api = inject(ErpApiService);

  public isNewOrderModalOpen = signal<boolean>(false);
  public isNewCustomerModalOpen = signal<boolean>(false);
  public isDeliveryNoteModalOpen = signal<boolean>(false);
  public isFiscalConfigModalOpen = signal<boolean>(false);

  public selectedDeliveryNote = signal<DeliveryNote | null>(null);

  // Currency View Mode: 'USD' ($) or 'Bs' (Bolívares)
  public currencyMode = signal<'USD' | 'Bs'>('USD');

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
    exchangeRateUsed: new FormControl<number>(48.35, {nonNullable: true, validators: [Validators.required, Validators.min(1)]}),
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
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    this.newOrderForm.patchValue({
      customerId: custs[0]?.id || '',
      finishedGoodId: fgs[0]?.id || '',
      quantity: 24,
      unitPrice: fgs[0]?.suggestedWholesalePrice || 1.65,
      exchangeRateUsed: rate,
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

    const rate = Number(v.exchangeRateUsed) || this.api.exchangeRates()?.currentUsd || 48.35;
    const subtotal = Number((Number(v.quantity) * Number(v.unitPrice)).toFixed(2));
    const taxRate = this.fiscalSettings()?.taxRatePercent || 16.0;
    const taxAmount = Number(((subtotal * taxRate) / 100).toFixed(2));
    const total = Number((subtotal + taxAmount).toFixed(2));

    const subtotalBs = Number((subtotal * rate).toFixed(2));
    const taxAmountBs = Number((taxAmount * rate).toFixed(2));
    const totalBs = Number((total * rate).toFixed(2));

    await this.api.addSalesOrder({
      customerId: cust.id,
      customerName: cust.businessName,
      customerTaxId: cust.taxId,
      orderDate: new Date().toISOString().slice(0, 10),
      deliveryDate: v.deliveryDate,
      status: fg.availableUnits >= Number(v.quantity) ? 'listo_despacho' : 'pendiente',
      exchangeRateUsed: rate,
      items: [
        {
          finishedGoodId: fg.id,
          flavor: fg.flavor,
          presentation: fg.presentation,
          presentationLabel: fg.presentationLabel,
          quantity: Number(v.quantity),
          unitPrice: Number(v.unitPrice),
          subtotal,
          unitPriceBs: Number((Number(v.unitPrice) * rate).toFixed(2)),
          subtotalBs,
        },
      ],
      subtotal,
      taxAmount,
      total,
      subtotalBs,
      taxAmountBs,
      totalBs,
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

  public exportCurrentDeliveryNotePdf() {
    const note = this.selectedDeliveryNote();
    if (!note) return;
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    downloadDeliveryNotePdf(note, this.fiscalSettings(), rate, this.currencyMode());
  }

  public exportSingleDeliveryNotePdf(note: DeliveryNote) {
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    downloadDeliveryNotePdf(note, this.fiscalSettings(), rate, this.currencyMode());
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

  // --- EXPORT FUNCTIONALITY: SALES ORDERS ---

  public exportOrdersCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const headers = [
      'Nro. Pedido',
      'Cliente',
      'RIF Cliente',
      'Fecha Pedido',
      'Fecha Entrega',
      'Estado',
      'Tasa del Día (Bs./USD)',
      `Subtotal (${isBs ? 'Bs.' : 'USD'})`,
      `IVA (${isBs ? 'Bs.' : 'USD'})`,
      `Total a Pagar (${isBs ? 'Bs.' : 'USD'})`,
    ];

    const rows = this.salesOrders().map(o => {
      const rate = o.exchangeRateUsed || this.api.exchangeRates()?.currentUsd || 48.35;
      const subtotal = isBs ? (o.subtotalBs || o.subtotal * rate) : o.subtotal;
      const tax = isBs ? (o.taxAmountBs || o.taxAmount * rate) : o.taxAmount;
      const total = isBs ? (o.totalBs || o.total * rate) : o.total;

      return [
        o.orderNumber,
        o.customerName,
        o.customerTaxId,
        o.orderDate,
        o.deliveryDate,
        o.status,
        formatVeNumber(rate, 2),
        formatVeNumber(subtotal, 2),
        formatVeNumber(tax, 2),
        formatVeNumber(total, 2),
      ];
    });

    exportToCsv(`Pedidos_Ventas_${this.currencyMode()}_${new Date().toISOString().slice(0, 10)}`, headers, rows);
  }

  public exportOrdersExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const headers = [
      'Nro. Pedido',
      'Cliente',
      'RIF / Identificación',
      'Fecha Pedido',
      'Fecha Entrega',
      'Estado',
      'Tasa del Día (Bs./USD)',
      `Subtotal (${isBs ? 'Bs.' : 'USD'})`,
      `IVA (${isBs ? 'Bs.' : 'USD'})`,
      `Total (${isBs ? 'Bs.' : 'USD'})`,
    ];

    const rows = this.salesOrders().map(o => {
      const rate = o.exchangeRateUsed || this.api.exchangeRates()?.currentUsd || 48.35;
      const subtotal = isBs ? (o.subtotalBs || o.subtotal * rate) : o.subtotal;
      const tax = isBs ? (o.taxAmountBs || o.taxAmount * rate) : o.taxAmount;
      const total = isBs ? (o.totalBs || o.total * rate) : o.total;

      return [
        o.orderNumber,
        o.customerName,
        o.customerTaxId,
        o.orderDate,
        o.deliveryDate,
        o.status,
        formatVeNumber(rate, 2),
        formatVeNumber(subtotal, 2),
        formatVeNumber(tax, 2),
        formatVeNumber(total, 2),
      ];
    });

    exportToExcel(
      `Pedidos_Ventas_${this.currencyMode()}_${new Date().toISOString().slice(0, 10)}`,
      'Pedidos Clientes',
      headers,
      rows,
      {
        moneda: isBs ? 'Bolívares (Bs.)' : 'Dólares Americanos (USD)',
        tasaCambio: `Tasa referencial: Bs. ${formatVeNumber(this.api.exchangeRates()?.currentUsd || 48.35, 2)}`,
      }
    );
  }

  public exportOrdersPdf() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Nro. Pedido',
      'Cliente',
      'Fecha',
      'Estado',
      'Tasa (Bs.)',
      `Subtotal (${isBs ? 'Bs.' : '$'})`,
      `Total (${isBs ? 'Bs.' : '$'})`,
    ];

    let grandTotal = 0;
    const rows = this.salesOrders().map(o => {
      const itemRate = o.exchangeRateUsed || rate;
      const subtotal = isBs ? (o.subtotalBs || o.subtotal * itemRate) : o.subtotal;
      const total = isBs ? (o.totalBs || o.total * itemRate) : o.total;
      grandTotal += total;

      return [
        o.orderNumber,
        o.customerName,
        o.orderDate,
        o.status,
        formatVeNumber(itemRate, 2),
        `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(subtotal, 2)}`,
        `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(total, 2)}`,
      ];
    });

    exportToPdf({
      title: 'Reporte Oficial de Pedidos de Venta',
      subtitle: `Registro comercial expresado en ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'}`,
      exchangeRateUsed: rate,
      currencyLabel: isBs ? 'Bolívares (Bs.)' : 'Dólares Americanos (USD)',
      headers,
      rows,
      totals: [
        {
          label: `Facturación Total Acumulada (${isBs ? 'Bs.' : 'USD'})`,
          value: `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(grandTotal, 2)}`,
        },
      ],
      notes: 'Cada pedido resguarda el valor de la tasa del día para fines de facturación legal y cobranza.',
    });
  }

  // --- EXPORT FUNCTIONALITY: DELIVERY NOTES ---

  public exportDeliveryNotesCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const headers = [
      'Nro. Nota Entrega',
      'Nro. Pedido',
      'Cliente',
      'RIF Cliente',
      'Fecha Despacho',
      'Tasa del Despacho (Bs./USD)',
      `Subtotal (${isBs ? 'Bs.' : 'USD'})`,
      `IVA (${isBs ? 'Bs.' : 'USD'})`,
      `Total Facturado (${isBs ? 'Bs.' : 'USD'})`,
      'Transportista',
      'Estado',
    ];

    const rows = this.deliveryNotes().map(dn => {
      const rate = dn.exchangeRateUsed || this.api.exchangeRates()?.currentUsd || 48.35;
      const subtotal = isBs ? (dn.subtotalBs || dn.subtotal * rate) : dn.subtotal;
      const tax = isBs ? (dn.taxAmountBs || dn.taxAmount * rate) : dn.taxAmount;
      const total = isBs ? (dn.totalBs || dn.total * rate) : dn.total;

      return [
        dn.noteNumber,
        dn.salesOrderNumber,
        dn.customerName,
        dn.customerTaxId,
        dn.dispatchDate,
        formatVeNumber(rate, 2),
        formatVeNumber(subtotal, 2),
        formatVeNumber(tax, 2),
        formatVeNumber(total, 2),
        dn.transporter || 'Planta',
        dn.status,
      ];
    });

    exportToCsv(`Notas_Entrega_${this.currencyMode()}_${new Date().toISOString().slice(0, 10)}`, headers, rows);
  }

  public exportDeliveryNotesExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const headers = [
      'Nro. Nota Entrega',
      'Nro. Pedido Origen',
      'Cliente',
      'RIF / Identificación',
      'Fecha Despacho',
      'Tasa de Despacho (Bs./USD)',
      `Subtotal (${isBs ? 'Bs.' : 'USD'})`,
      `IVA (${isBs ? 'Bs.' : 'USD'})`,
      `Total (${isBs ? 'Bs.' : 'USD'})`,
      'Transportista',
      'Estado',
    ];

    const rows = this.deliveryNotes().map(dn => {
      const rate = dn.exchangeRateUsed || this.api.exchangeRates()?.currentUsd || 48.35;
      const subtotal = isBs ? (dn.subtotalBs || dn.subtotal * rate) : dn.subtotal;
      const tax = isBs ? (dn.taxAmountBs || dn.taxAmount * rate) : dn.taxAmount;
      const total = isBs ? (dn.totalBs || dn.total * rate) : dn.total;

      return [
        dn.noteNumber,
        dn.salesOrderNumber,
        dn.customerName,
        dn.customerTaxId,
        dn.dispatchDate,
        formatVeNumber(rate, 2),
        formatVeNumber(subtotal, 2),
        formatVeNumber(tax, 2),
        formatVeNumber(total, 2),
        dn.transporter || 'Planta',
        dn.status,
      ];
    });

    exportToExcel(
      `Notas_Entrega_${this.currencyMode()}_${new Date().toISOString().slice(0, 10)}`,
      'Notas de Entrega Despacho',
      headers,
      rows,
      {
        moneda: isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)',
        tasaCambio: `Tasa referencial: Bs. ${formatVeNumber(this.api.exchangeRates()?.currentUsd || 48.35, 2)}`,
      }
    );
  }

  public exportDeliveryNotesPdf() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Nro. Nota',
      'Pedido',
      'Cliente',
      'Fecha Despacho',
      'Tasa (Bs.)',
      `Subtotal (${isBs ? 'Bs.' : '$'})`,
      `Total (${isBs ? 'Bs.' : '$'})`,
      'Estado',
    ];

    let totalDespachado = 0;
    const rows = this.deliveryNotes().map(dn => {
      const itemRate = dn.exchangeRateUsed || rate;
      const subtotal = isBs ? (dn.subtotalBs || dn.subtotal * itemRate) : dn.subtotal;
      const total = isBs ? (dn.totalBs || dn.total * itemRate) : dn.total;
      totalDespachado += total;

      return [
        dn.noteNumber,
        dn.salesOrderNumber,
        dn.customerName,
        dn.dispatchDate,
        formatVeNumber(itemRate, 2),
        `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(subtotal, 2)}`,
        `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(total, 2)}`,
        dn.status,
      ];
    });

    exportToPdf({
      title: 'Reporte de Despacho y Notas de Entrega Emitidas',
      subtitle: `Control de entregas físicas expresado en ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'}`,
      exchangeRateUsed: rate,
      currencyLabel: isBs ? 'Bolívares (Bs.)' : 'Dólares Americanos (USD)',
      headers,
      rows,
      totals: [
        {
          label: `Valor Total Despachado (${isBs ? 'Bs.' : 'USD'})`,
          value: `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(totalDespachado, 2)}`,
        },
      ],
      notes: 'Todas las notas de entrega certifican la recepción física del lote y su tasa de liquidación cambiaria.',
    });
  }
}
