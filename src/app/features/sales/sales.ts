import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {DeliveryNote, FinishedGood, PriceTierType} from '../../core/models/erp.models';
import {VeCurrencyPipe, VeNumberPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf, downloadDeliveryNotePdf} from '../../core/utils/export.utils';
import {BankAutocomplete} from '../../shared/components/bank-autocomplete/bank-autocomplete';

export interface PriceTierOption {
  tier: PriceTierType;
  label: string;
  shortLabel: string;
  description: string;
  price: number;
  marginPercent: number;
  profitPerUnit: number;
  priceBs: number;
}

@Component({
  selector: 'app-sales',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ReactiveFormsModule, VeCurrencyPipe, VeNumberPipe, BankAutocomplete],
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

  // Product Autocomplete & 3-Tier Price Selection in New Order Modal
  public selectedProductId = signal<string>('');
  public productSearchQuery = signal<string>('');
  public isProductDropdownOpen = signal<boolean>(false);
  public selectedPriceTier = signal<PriceTierType>('mayorista');
  public currentUnitPrice = signal<number>(1.65);
  public currentExchangeRate = signal<number>(48.35);

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
    bank: new FormControl<string>('0108 - Banco Provincial', {nonNullable: true}),
  });

  public onCustomerBankSelected(event: { bank: any; formatted: string }) {
    this.newCustomerForm.patchValue({
      bank: event.formatted,
    });
  }

  public newOrderForm = new FormGroup({
    customerId: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    finishedGoodId: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    quantity: new FormControl<number>(24, {nonNullable: true, validators: [Validators.required, Validators.min(1)]}),
    unitPrice: new FormControl<number>(1.65, {nonNullable: true, validators: [Validators.required, Validators.min(0.01)]}),
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

  // Filtered finished goods for autocomplete dropdown
  public filteredProducts = computed<FinishedGood[]>(() => {
    const query = this.productSearchQuery().trim().toLowerCase();
    const all = this.finishedGoods();
    if (!query) return all;
    return all.filter(p =>
      p.flavor.toLowerCase().includes(query) ||
      p.code.toLowerCase().includes(query) ||
      p.presentationLabel.toLowerCase().includes(query)
    );
  });

  // Selected finished good in the modal
  public selectedFinishedGood = computed<FinishedGood | null>(() => {
    const id = this.selectedProductId();
    const all = this.finishedGoods();
    return all.find(p => p.id === id) || all[0] || null;
  });

  // Available 3 price tiers for the currently selected product with profit margins
  public availablePriceTiers = computed<PriceTierOption[]>(() => {
    const fg = this.selectedFinishedGood();
    if (!fg) return [];
    const rate = this.currentExchangeRate();
    const baseCost = fg.baseCost;

    const wholesalePrice = fg.suggestedWholesalePrice;
    const retailPrice = fg.suggestedRetailPrice;
    const specialPrice = fg.suggestedSpecialPrice || Number((baseCost * 1.35).toFixed(2));

    const calcMargin = (price: number) => {
      if (price <= 0) return 0;
      return Number((((price - baseCost) / price) * 100).toFixed(1));
    };

    return [
      {
        tier: 'mayorista',
        label: 'Mayorista / Distribuidor',
        shortLabel: 'Mayorista',
        description: 'Panaderías, distribuidores y compras recurrentes',
        price: wholesalePrice,
        marginPercent: calcMargin(wholesalePrice),
        profitPerUnit: Number((wholesalePrice - baseCost).toFixed(2)),
        priceBs: Number((wholesalePrice * rate).toFixed(2)),
      },
      {
        tier: 'detal',
        label: 'Detal / Minorista',
        shortLabel: 'Detal',
        description: 'Venta por menor, tiendas directas o consumidor final',
        price: retailPrice,
        marginPercent: calcMargin(retailPrice),
        profitPerUnit: Number((retailPrice - baseCost).toFixed(2)),
        priceBs: Number((retailPrice * rate).toFixed(2)),
      },
      {
        tier: 'especial',
        label: 'Especial / Institucional',
        shortLabel: 'Especial',
        description: 'Convenios por alto volumen, franquicias y corporativo',
        price: specialPrice,
        marginPercent: calcMargin(specialPrice),
        profitPerUnit: Number((specialPrice - baseCost).toFixed(2)),
        priceBs: Number((specialPrice * rate).toFixed(2)),
      },
    ];
  });

  // Live profit margin calculation for currently entered price
  public currentPricingAnalysis = computed(() => {
    const fg = this.selectedFinishedGood();
    const unitPrice = this.currentUnitPrice();
    const baseCost = fg ? fg.baseCost : 0;
    const rate = this.currentExchangeRate();

    const profitPerUnit = Number((unitPrice - baseCost).toFixed(2));
    const marginPercent = unitPrice > 0 ? Number((((unitPrice - baseCost) / unitPrice) * 100).toFixed(1)) : 0;
    const unitPriceBs = Number((unitPrice * rate).toFixed(2));

    let status: 'excellent' | 'good' | 'tight' | 'negative' = 'good';
    let statusLabel = 'Margen Saludable';
    let statusClass = 'text-emerald-700 bg-emerald-50 border-emerald-200';

    if (unitPrice <= baseCost) {
      status = 'negative';
      statusLabel = '¡Alerta de Pérdida! Por debajo o igual al costo base';
      statusClass = 'text-rose-700 bg-rose-50 border-rose-200';
    } else if (marginPercent < 20) {
      status = 'tight';
      statusLabel = 'Margen Ajustado (<20%)';
      statusClass = 'text-amber-700 bg-amber-50 border-amber-200';
    } else if (marginPercent >= 45) {
      status = 'excellent';
      statusLabel = 'Margen Óptimo (≥45%)';
      statusClass = 'text-teal-700 bg-teal-50 border-teal-200';
    }

    return {
      baseCost,
      unitPrice,
      unitPriceBs,
      profitPerUnit,
      marginPercent,
      status,
      statusLabel,
      statusClass,
    };
  });

  public openNewOrderModal() {
    const custs = this.customers();
    const fgs = this.finishedGoods();
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const initialFg = fgs[0];
    const initialPrice = initialFg ? initialFg.suggestedWholesalePrice : 1.65;

    this.selectedProductId.set(initialFg?.id || '');
    this.productSearchQuery.set(initialFg ? `${initialFg.flavor} - ${initialFg.presentationLabel}` : '');
    this.isProductDropdownOpen.set(false);
    this.selectedPriceTier.set('mayorista');
    this.currentUnitPrice.set(initialPrice);
    this.currentExchangeRate.set(rate);

    this.newOrderForm.patchValue({
      customerId: custs[0]?.id || '',
      finishedGoodId: initialFg?.id || '',
      quantity: 24,
      unitPrice: initialPrice,
      exchangeRateUsed: rate,
      notes: '',
    });
    this.isNewOrderModalOpen.set(true);
  }

  public selectProduct(fg: FinishedGood) {
    this.selectedProductId.set(fg.id);
    this.newOrderForm.patchValue({ finishedGoodId: fg.id });
    this.productSearchQuery.set(`${fg.flavor} - ${fg.presentationLabel}`);
    this.isProductDropdownOpen.set(false);

    // Apply currently chosen tier for this newly selected product
    const currentTier = this.selectedPriceTier();
    if (currentTier === 'detal') {
      this.applyPriceTier('detal', fg);
    } else if (currentTier === 'especial') {
      this.applyPriceTier('especial', fg);
    } else {
      this.applyPriceTier('mayorista', fg);
    }
  }

  public onProductSearchInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.productSearchQuery.set(input.value);
    this.isProductDropdownOpen.set(true);
  }

  public toggleProductDropdown() {
    this.isProductDropdownOpen.update(v => !v);
  }

  public closeProductDropdown() {
    this.isProductDropdownOpen.set(false);
  }

  public applyPriceTier(tier: PriceTierType, fgOverride?: FinishedGood) {
    if (tier === 'personalizado') return;
    const fg = fgOverride || this.selectedFinishedGood();
    if (!fg) return;

    let targetPrice = fg.suggestedWholesalePrice;
    if (tier === 'detal') targetPrice = fg.suggestedRetailPrice;
    if (tier === 'especial') targetPrice = fg.suggestedSpecialPrice || Number((fg.baseCost * 1.35).toFixed(2));

    this.selectedPriceTier.set(tier);
    this.currentUnitPrice.set(targetPrice);
    this.newOrderForm.patchValue({ unitPrice: targetPrice });
  }

  public onUnitPriceInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const price = parseFloat(input.value) || 0;
    this.currentUnitPrice.set(price);
    this.newOrderForm.patchValue({ unitPrice: price }, { emitEvent: false });

    // Check if manually typed price corresponds to any tier
    const fg = this.selectedFinishedGood();
    if (fg) {
      const specialPrice = fg.suggestedSpecialPrice || Number((fg.baseCost * 1.35).toFixed(2));
      if (Math.abs(price - fg.suggestedWholesalePrice) < 0.005) {
        this.selectedPriceTier.set('mayorista');
      } else if (Math.abs(price - fg.suggestedRetailPrice) < 0.005) {
        this.selectedPriceTier.set('detal');
      } else if (Math.abs(price - specialPrice) < 0.005) {
        this.selectedPriceTier.set('especial');
      } else {
        this.selectedPriceTier.set('personalizado');
      }
    }
  }

  public onExchangeRateInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const rate = parseFloat(input.value) || 48.35;
    this.currentExchangeRate.set(rate);
    this.newOrderForm.patchValue({ exchangeRateUsed: rate }, { emitEvent: false });
  }

  public onProductSelectChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const fg = this.finishedGoods().find(f => f.id === select.value);
    if (fg) {
      this.selectProduct(fg);
    }
  }

  public closeNewOrderModal() {
    this.isNewOrderModalOpen.set(false);
    this.isProductDropdownOpen.set(false);
  }

  public async submitSalesOrder() {
    if (this.newOrderForm.invalid) return;
    const v = this.newOrderForm.getRawValue();
    const cust = this.customers().find(c => c.id === v.customerId);
    const fg = this.finishedGoods().find(f => f.id === v.finishedGoodId);
    if (!cust || !fg) return;

    const rate = Number(v.exchangeRateUsed) || this.api.exchangeRates()?.currentUsd || 48.35;
    const unitPrice = Number(v.unitPrice);
    const quantity = Number(v.quantity);
    const subtotal = Number((quantity * unitPrice).toFixed(2));
    const taxRate = this.fiscalSettings()?.taxRatePercent || 16.0;
    const taxAmount = Number(((subtotal * taxRate) / 100).toFixed(2));
    const total = Number((subtotal + taxAmount).toFixed(2));

    const subtotalBs = Number((subtotal * rate).toFixed(2));
    const taxAmountBs = Number((taxAmount * rate).toFixed(2));
    const totalBs = Number((total * rate).toFixed(2));

    const tier = this.selectedPriceTier();
    const analysis = this.currentPricingAnalysis();

    await this.api.addSalesOrder({
      customerId: cust.id,
      customerName: cust.businessName,
      customerTaxId: cust.taxId,
      orderDate: new Date().toISOString().slice(0, 10),
      deliveryDate: v.deliveryDate,
      status: fg.availableUnits >= quantity ? 'listo_despacho' : 'pendiente',
      exchangeRateUsed: rate,
      items: [
        {
          finishedGoodId: fg.id,
          flavor: fg.flavor,
          presentation: fg.presentation,
          presentationLabel: fg.presentationLabel,
          quantity,
          unitPrice,
          subtotal,
          unitPriceBs: Number((unitPrice * rate).toFixed(2)),
          subtotalBs,
          priceTier: tier,
          profitMarginPercent: analysis.marginPercent,
          baseCost: fg.baseCost,
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
      bank: '0108 - Banco Provincial',
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
      bank: v.bank,
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
    this.api.showToast(`Nota de Entrega ${note.noteNumber} descargada en PDF.`);
  }

  public exportSingleDeliveryNotePdf(note: DeliveryNote) {
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    downloadDeliveryNotePdf(note, this.fiscalSettings(), rate, this.currencyMode());
    this.api.showToast(`Nota de Entrega ${note.noteNumber} descargada en PDF.`);
  }

  public emailDeliveryNoteToClient(note: DeliveryNote) {
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    // Download official PDF first
    downloadDeliveryNotePdf(note, this.fiscalSettings(), rate, this.currencyMode());

    const cust = this.customers().find(c => c.taxId === note.customerTaxId || c.businessName === note.customerName);
    const toEmail = cust?.email || '';
    const totalBs = note.totalBs || (note.total * rate);

    const itemsSummary = note.items.map(i => `• ${i.description} (${i.presentationLabel}): ${i.quantity} uds - $${i.subtotal.toFixed(2)}`).join('\n');

    const subject = encodeURIComponent(`Nota de Entrega N° ${note.noteNumber} - PulpaCraft MRP`);
    const body = encodeURIComponent(
`Estimado(a) ${note.customerName},

Le notificamos que su pedido (${note.salesOrderNumber}) ha sido despachado exitosamente bajo la Nota de Entrega oficial N° ${note.noteNumber}.

DETALLE DE PRODUCTOS DESPACHADOS:
${itemsSummary}

INFORMACIÓN DE PAGO & FISCAL:
- Total a Pagar: $ ${note.total.toFixed(2)} USD
- Total en Bolívares (Tasa Oficial BCV ${rate.toFixed(2)} Bs./USD): Bs. ${totalBs.toFixed(2)}
- Transportista asignado: ${note.transporter || 'Transporte Propio de Planta'}
- Fecha de Despacho: ${note.dispatchDate}

Adjuntamos el documento PDF formal con firma y sello de planta para su recepción y control contable.

Agradecemos su confianza comercial.

Atentamente,
Departamento de Logística & Facturación
PulpaCraft MRP · Mermeladas Artesanales del Valle C.A.
RIF: J-40899231-0`
    );

    if (typeof window !== 'undefined') {
      window.location.href = `mailto:${toEmail}?subject=${subject}&body=${body}`;
    }

    this.api.showToast(`Nota de Entrega ${note.noteNumber} preparada para envío por correo.`);
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
