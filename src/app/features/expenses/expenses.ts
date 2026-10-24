import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {CommonModule, DecimalPipe} from '@angular/common';
import {FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {Expense, ExpenseCategory, ExpenseTaxCategory} from '../../core/models/erp.models';
import {VeCurrencyPipe} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel} from '../../core/utils/export.utils';
import {AuditLog} from '../../shared/components/audit-log/audit-log';

export interface CategoryOption {
  value: ExpenseCategory;
  label: string;
  icon: string;
  color: string;
  defaultAccountCode: string;
  defaultAccountName: string;
  defaultTaxCategory: ExpenseTaxCategory;
}

@Component({
  selector: 'app-expenses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, DecimalPipe, ReactiveFormsModule, MatIconModule, VeCurrencyPipe, AuditLog],
  templateUrl: './expenses.html',
})
export class ExpensesComponent {
  public api = inject(ErpApiService);

  public currencyMode = signal<'USD' | 'Bs'>('USD');
  public activeSubTab = signal<'list' | 'future_books' | 'audit'>('list');
  public categoryFilter = signal<string>('all');
  public searchQuery = signal<string>('');

  // Modals state
  public isCreateModalOpen = signal<boolean>(false);
  public isDetailModalOpen = signal<boolean>(false);
  public selectedExpenseForDetail = signal<Expense | null>(null);

  // Categories metadata
  public categories: CategoryOption[] = [
    {
      value: 'alquiler_instalaciones',
      label: 'Alquiler de Instalaciones / Planta',
      icon: 'warehouse',
      color: 'bg-amber-100 text-amber-900 border-amber-200',
      defaultAccountCode: '5.1.01.01',
      defaultAccountName: 'Alquileres de Planta de Producción',
      defaultTaxCategory: 'con_factura_iva',
    },
    {
      value: 'servicios_basicos',
      label: 'Servicios Básicos (Luz, Gas, Agua)',
      icon: 'bolt',
      color: 'bg-sky-100 text-sky-900 border-sky-200',
      defaultAccountCode: '5.1.03.02',
      defaultAccountName: 'Combustible, Gas y Servicios de Cocción',
      defaultTaxCategory: 'con_factura_iva',
    },
    {
      value: 'viajes_viaticos',
      label: 'Viajes, Combustible & Viáticos',
      icon: 'directions_car',
      color: 'bg-emerald-100 text-emerald-900 border-emerald-200',
      defaultAccountCode: '5.1.02.04',
      defaultAccountName: 'Gastos de Viaje, Combustible y Viáticos',
      defaultTaxCategory: 'no_sujeto',
    },
    {
      value: 'gastos_personales_socios',
      label: 'Gastos Personales & Retiros de Socios',
      icon: 'person_pin',
      color: 'bg-purple-100 text-purple-900 border-purple-200',
      defaultAccountCode: '5.2.01.01',
      defaultAccountName: 'Retiros Personales y Anticipos de Socios',
      defaultTaxCategory: 'no_sujeto',
    },
    {
      value: 'mantenimiento_reparacion',
      label: 'Mantenimiento & Reparación',
      icon: 'build',
      color: 'bg-orange-100 text-orange-900 border-orange-200',
      defaultAccountCode: '5.1.03.01',
      defaultAccountName: 'Mantenimiento de Maquinaria y Marmitas',
      defaultTaxCategory: 'con_factura_iva',
    },
    {
      value: 'ventas_fletes_marketing',
      label: 'Ventas, Fletes & Marketing',
      icon: 'local_shipping',
      color: 'bg-indigo-100 text-indigo-900 border-indigo-200',
      defaultAccountCode: '5.1.04.01',
      defaultAccountName: 'Fletes en Ventas y Publicidad Comercial',
      defaultTaxCategory: 'con_factura_iva',
    },
    {
      value: 'honorarios_profesionales',
      label: 'Honorarios Profesionales & Asesoría',
      icon: 'badge',
      color: 'bg-rose-100 text-rose-900 border-rose-200',
      defaultAccountCode: '5.2.02.01',
      defaultAccountName: 'Honorarios Contables y Legales',
      defaultTaxCategory: 'con_factura_iva',
    },
    {
      value: 'suministros_oficina_planta',
      label: 'Suministros de Oficina & Planta',
      icon: 'inventory',
      color: 'bg-teal-100 text-teal-900 border-teal-200',
      defaultAccountCode: '5.2.03.01',
      defaultAccountName: 'Materiales y Artículos de Oficina/Limpieza',
      defaultTaxCategory: 'con_factura_iva',
    },
    {
      value: 'otros',
      label: 'Otros Egresos Operativos',
      icon: 'more_horiz',
      color: 'bg-stone-100 text-stone-800 border-stone-200',
      defaultAccountCode: '5.3.01.01',
      defaultAccountName: 'Otros Gastos Generales',
      defaultTaxCategory: 'con_factura_iva',
    },
  ];

  // Expense Reactive Form
  public expenseForm = new FormGroup({
    concept: new FormControl<string>('', {nonNullable: true, validators: [Validators.required, Validators.minLength(4)]}),
    category: new FormControl<ExpenseCategory>('alquiler_instalaciones', {nonNullable: true, validators: [Validators.required]}),
    amountUsd: new FormControl<number>(100.00, {nonNullable: true, validators: [Validators.required, Validators.min(0.01)]}),
    exchangeRateUsed: new FormControl<number>(48.35, {nonNullable: true, validators: [Validators.required, Validators.min(1)]}),
    supplierOrBeneficiary: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    taxId: new FormControl<string>('', {nonNullable: true}),
    documentType: new FormControl<'factura_fiscal' | 'recibo_pago' | 'nota_debito' | 'vale_caja' | 'otro'>('factura_fiscal', {nonNullable: true}),
    documentNumber: new FormControl<string>('', {nonNullable: true}),
    paymentMethod: new FormControl<'transferencia_bancaria' | 'pago_movil' | 'efectivo_usd' | 'efectivo_bs' | 'zelle' | 'tarjeta'>('transferencia_bancaria', {nonNullable: true}),
    paymentReference: new FormControl<string>('', {nonNullable: true}),
    taxCategory: new FormControl<ExpenseTaxCategory>('con_factura_iva', {nonNullable: true}),
    taxRatePercent: new FormControl<number>(16.0, {nonNullable: true}),
    fiscalBookEligible: new FormControl<boolean>(true, {nonNullable: true}),
    accountingAccountCode: new FormControl<string>('5.1.01.01', {nonNullable: true}),
    accountingAccountName: new FormControl<string>('Alquileres de Planta de Producción', {nonNullable: true}),
    date: new FormControl<string>(new Date().toISOString().slice(0, 10), {nonNullable: true, validators: [Validators.required]}),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  public expensesList = computed<Expense[]>(() => this.api.expenses());

  // Filtered Expenses
  public filteredExpenses = computed<Expense[]>(() => {
    const all = this.expensesList();
    const cat = this.categoryFilter();
    const query = this.searchQuery().trim().toLowerCase();

    return all.filter(exp => {
      // Category match
      let matchesCat = true;
      if (cat !== 'all') {
        if (cat === 'fiscales') {
          matchesCat = exp.fiscalBookEligible;
        } else if (cat === 'operativos') {
          matchesCat = ['alquiler_instalaciones', 'servicios_basicos', 'mantenimiento_reparacion', 'suministros_oficina_planta'].includes(exp.category);
        } else if (cat === 'viajes') {
          matchesCat = ['viajes_viaticos', 'ventas_fletes_marketing'].includes(exp.category);
        } else if (cat === 'socios') {
          matchesCat = exp.category === 'gastos_personales_socios';
        } else {
          matchesCat = exp.category === cat;
        }
      }

      // Query search match
      let matchesQuery = true;
      if (query) {
        matchesQuery =
          exp.concept.toLowerCase().includes(query) ||
          exp.expenseNumber.toLowerCase().includes(query) ||
          exp.supplierOrBeneficiary.toLowerCase().includes(query) ||
          (exp.documentNumber ? exp.documentNumber.toLowerCase().includes(query) : false) ||
          (exp.taxId ? exp.taxId.toLowerCase().includes(query) : false) ||
          (exp.notes ? exp.notes.toLowerCase().includes(query) : false);
      }

      return matchesCat && matchesQuery;
    });
  });

  // KPI Computations
  public totalAmountUsd = computed<number>(() => {
    return this.expensesList().reduce((acc, e) => acc + (Number(e.amountUsd) || 0), 0);
  });

  public totalAmountBs = computed<number>(() => {
    return this.expensesList().reduce((acc, e) => acc + (Number(e.amountBs) || 0), 0);
  });

  public operationalAmountUsd = computed<number>(() => {
    return this.expensesList()
      .filter(e => e.category !== 'gastos_personales_socios')
      .reduce((acc, e) => acc + (Number(e.amountUsd) || 0), 0);
  });

  public personalPartnersAmountUsd = computed<number>(() => {
    return this.expensesList()
      .filter(e => e.category === 'gastos_personales_socios')
      .reduce((acc, e) => acc + (Number(e.amountUsd) || 0), 0);
  });

  public travelAndLogisticsAmountUsd = computed<number>(() => {
    return this.expensesList()
      .filter(e => e.category === 'viajes_viaticos' || e.category === 'ventas_fletes_marketing')
      .reduce((acc, e) => acc + (Number(e.amountUsd) || 0), 0);
  });

  public fiscalCreditIvaAmountUsd = computed<number>(() => {
    return this.expensesList()
      .filter(e => e.fiscalBookEligible && e.taxAmountUsd)
      .reduce((acc, e) => acc + (Number(e.taxAmountUsd) || 0), 0);
  });

  public fiscalCreditIvaAmountBs = computed<number>(() => {
    return this.expensesList()
      .filter(e => e.fiscalBookEligible && e.taxAmountBs)
      .reduce((acc, e) => acc + (Number(e.taxAmountBs) || 0), 0);
  });

  public expensesAuditCount = computed<number>(() => {
    return this.api.auditLogs().filter(l => l.module === 'gastos').length;
  });

  // Helper: on category change in form, auto-suggest account code and tax eligibility
  public onCategoryChange(catValue: ExpenseCategory) {
    const cat = this.categories.find(c => c.value === catValue);
    if (!cat) return;

    const isPartner = catValue === 'gastos_personales_socios';
    const isTravel = catValue === 'viajes_viaticos';

    this.expenseForm.patchValue({
      accountingAccountCode: cat.defaultAccountCode,
      accountingAccountName: cat.defaultAccountName,
      taxCategory: cat.defaultTaxCategory,
      fiscalBookEligible: !isPartner && !isTravel,
      documentType: isPartner ? 'vale_caja' : (isTravel ? 'recibo_pago' : 'factura_fiscal'),
    });
  }

  public openCreateModal() {
    const activeRate = this.api.exchangeRates()?.currentUsd || 48.35;
    this.expenseForm.reset({
      concept: '',
      category: 'alquiler_instalaciones',
      amountUsd: 150.00,
      exchangeRateUsed: activeRate,
      supplierOrBeneficiary: '',
      taxId: '',
      documentType: 'factura_fiscal',
      documentNumber: '',
      paymentMethod: 'transferencia_bancaria',
      paymentReference: '',
      taxCategory: 'con_factura_iva',
      taxRatePercent: 16.0,
      fiscalBookEligible: true,
      accountingAccountCode: '5.1.01.01',
      accountingAccountName: 'Alquileres de Planta de Producción',
      date: new Date().toISOString().slice(0, 10),
      notes: '',
    });
    this.isCreateModalOpen.set(true);
  }

  public closeCreateModal() {
    this.isCreateModalOpen.set(false);
  }

  public openDetailModal(exp: Expense) {
    this.selectedExpenseForDetail.set(exp);
    this.isDetailModalOpen.set(true);
  }

  public closeDetailModal() {
    this.isDetailModalOpen.set(false);
    this.selectedExpenseForDetail.set(null);
  }

  public async submitExpense() {
    if (this.expenseForm.invalid) return;
    const v = this.expenseForm.getRawValue();
    const rate = Number(v.exchangeRateUsed) || 48.35;
    const amountUsd = Number(v.amountUsd) || 0;
    const amountBs = Number((amountUsd * rate).toFixed(2));

    const catMeta = this.categories.find(c => c.value === v.category);
    const categoryLabel = catMeta ? catMeta.label : 'Gasto General';

    // Tax calculation
    let taxAmountUsd: number | undefined = undefined;
    let taxAmountBs: number | undefined = undefined;
    if (v.taxCategory === 'con_factura_iva' && v.taxRatePercent) {
      // In Venezuela, invoice total is base + IVA (or total includes IVA)
      // Base = total / (1 + rate/100)
      const base = amountUsd / (1 + (v.taxRatePercent / 100));
      taxAmountUsd = Number((amountUsd - base).toFixed(2));
      taxAmountBs = Number((taxAmountUsd * rate).toFixed(2));
    }

    const payload: Omit<Expense, 'id' | 'expenseNumber'> = {
      date: v.date,
      concept: v.concept,
      category: v.category,
      categoryLabel,
      amountUsd,
      exchangeRateUsed: rate,
      amountBs,
      supplierOrBeneficiary: v.supplierOrBeneficiary,
      taxId: v.taxId || undefined,
      documentType: v.documentType,
      documentNumber: v.documentNumber || undefined,
      paymentMethod: v.paymentMethod,
      paymentReference: v.paymentReference || undefined,
      notes: v.notes || undefined,
      registeredBy: `${this.api.currentUser().fullName} (${this.api.currentUser().roleName})`,
      taxCategory: v.taxCategory,
      taxRatePercent: v.taxRatePercent,
      taxAmountUsd,
      taxAmountBs,
      accountingAccountCode: v.accountingAccountCode || undefined,
      accountingAccountName: v.accountingAccountName || undefined,
      fiscalBookEligible: v.fiscalBookEligible,
    };

    await this.api.addExpense(payload);
    this.closeCreateModal();
  }

  public async deleteExpense(id: string) {
    if (!this.api.hasPermission('expenses', 'canDelete')) {
      this.api.showToast('No tienes permisos para eliminar egresos.', 'error');
      return;
    }
    if (confirm('¿Estás seguro de que deseas eliminar este comprobante de egreso? Esta acción será auditada.')) {
      await this.api.deleteExpense(id);
    }
  }

  // --- EXPORT TOOLS ---
  public exportExpensesCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const headers = [
      'Nro. Egreso',
      'Fecha',
      'Concepto',
      'Categoría',
      'Beneficiario / Proveedor',
      'RIF / Cédula',
      'Tipo Doc.',
      'Nro. Documento',
      'Método de Pago',
      'Referencia',
      `Monto (${isBs ? 'Bs.' : 'USD'})`,
      'Tasa Usada (Bs./USD)',
      'Tratamiento Fiscal',
      'Crédito IVA (USD)',
      'Cuenta Contable',
      'Registrado Por',
    ];

    const rows = this.filteredExpenses().map(e => [
      e.expenseNumber,
      e.date,
      e.concept,
      e.categoryLabel,
      e.supplierOrBeneficiary,
      e.taxId || 'N/A',
      e.documentType,
      e.documentNumber || 'S/N',
      e.paymentMethod,
      e.paymentReference || 'S/R',
      (isBs ? e.amountBs : e.amountUsd).toFixed(2),
      e.exchangeRateUsed.toFixed(2),
      e.taxCategory,
      (e.taxAmountUsd || 0).toFixed(2),
      e.accountingAccountCode ? `${e.accountingAccountCode} - ${e.accountingAccountName}` : 'S/C',
      e.registeredBy,
    ]);

    exportToCsv('Reporte_Egresos_PulpaCraft.csv', headers, rows);
  }

  public exportExpensesExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const headers = [
      'Nro. Egreso',
      'Fecha',
      'Concepto',
      'Categoría',
      'Beneficiario / Proveedor',
      'RIF / Cédula',
      'Tipo Doc.',
      'Nro. Documento',
      `Monto (${isBs ? 'Bs.' : 'USD'})`,
      'Tratamiento Fiscal',
      'Crédito IVA (USD)',
      'Cuenta Contable',
    ];

    const rows = this.filteredExpenses().map(e => [
      e.expenseNumber,
      e.date,
      e.concept,
      e.categoryLabel,
      e.supplierOrBeneficiary,
      e.taxId || 'N/A',
      e.documentType,
      e.documentNumber || 'S/N',
      (isBs ? e.amountBs : e.amountUsd).toFixed(2),
      e.taxCategory,
      (e.taxAmountUsd || 0).toFixed(2),
      e.accountingAccountCode || 'S/C',
    ]);

    exportToExcel('Reporte_Egresos_PulpaCraft.xlsx', 'Comprobantes de Egreso', headers, rows);
  }
}
