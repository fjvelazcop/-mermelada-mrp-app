import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ModuleHelpComponent} from '../../shared/components/module-help/module-help';
import {ErpApiService} from '../../core/services/erp-api.service';
import {AccountingBookType, Expense, ExpenseCategoryConfig, ExpenseTaxCategory} from '../../core/models/erp.models';
import {VeCurrencyPipe} from '../../core/pipes/ve-currency.pipe';
import {
  VENEZUELAN_BANKS,
  bankLabel,
  findBank,
} from '../../core/data/venezuelan-banks';
import {exportToCsv, exportToExcel} from '../../core/utils/export.utils';
import {defaultDocumentRate} from '../../core/utils/exchange-rate.utils';
import {AuditLog} from '../../shared/components/audit-log/audit-log';
import {
  SupplierAutocompleteComponent,
  SupplierSelection,
} from '../../shared/components/supplier-autocomplete/supplier-autocomplete';
import {AccountsPayableComponent} from '../accounts-payable/accounts-payable';

export interface CategoryBudgetAnalysis {
  category: ExpenseCategoryConfig;
  actualAmountUsd: number;
  actualAmountBs: number;
  monthlyBudgetUsd: number;
  differenceUsd: number; // monthlyBudgetUsd - actualAmountUsd (positive = within budget, negative = exceeded)
  percentageConsumed: number;
  status: 'normal' | 'warning' | 'danger';
  expenseCount: number;
  barWidthPercent: number; // 0 to 100 for visual bar
}

@Component({
  selector: 'app-expenses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, MatIconModule, VeCurrencyPipe, AuditLog, SupplierAutocompleteComponent, AccountsPayableComponent, ModuleHelpComponent],
  templateUrl: './expenses.html',
})
export class ExpensesComponent {
  public api = inject(ErpApiService);

  public currencyMode = signal<'USD' | 'Bs'>('USD');
  public activeSubTab = signal<'list' | 'payables' | 'future_books' | 'audit'>('list');
  public categoryFilter = signal<string>('all');
  public searchQuery = signal<string>('');

  // Monthly Filter: e.g. '2026-10' or 'all'
  public selectedMonthFilter = signal<string>('2026-10');

  /** Catálogo oficial SUDEBAN para autocompletar el banco emisor. */
  public banks = VENEZUELAN_BANKS;
  public bankQuery = signal<string>('');
  public bankLabel = bankLabel;
  public bankPaymentMethods: Expense['paymentMethod'][] = [
    'transferencia_bancaria',
    'pago_movil',
    'tarjeta',
    'zelle',
  ];

  // Modals state
  public isCreateModalOpen = signal<boolean>(false);
  public isDetailModalOpen = signal<boolean>(false);
  public isCategoryModalOpen = signal<boolean>(false);
  public isBudgetModalOpen = signal<boolean>(false);
  public selectedExpenseForDetail = signal<Expense | null>(null);
  public editingCategoryForBudget = signal<ExpenseCategoryConfig | null>(null);

  // Available icon options for custom categories
  public availableIcons: string[] = [
    'warehouse',
    'bolt',
    'directions_car',
    'person_pin',
    'build',
    'local_shipping',
    'badge',
    'inventory',
    'more_horiz',
    'storefront',
    'precision_manufacturing',
    'science',
    'local_gas_station',
    'water_drop',
    'security',
    'verified',
    'restaurant',
    'campaign',
  ];

  // Available color options for custom categories
  public availableColors: { id: string; label: string; bg: string; text: string; border: string }[] = [
    { id: 'amber', label: 'Ámbar', bg: 'bg-amber-100', text: 'text-amber-900', border: 'border-amber-300' },
    { id: 'sky', label: 'Cielo', bg: 'bg-sky-100', text: 'text-sky-900', border: 'border-sky-300' },
    { id: 'emerald', label: 'Esmeralda', bg: 'bg-emerald-100', text: 'text-emerald-900', border: 'border-emerald-300' },
    { id: 'purple', label: 'Púrpura', bg: 'bg-purple-100', text: 'text-purple-900', border: 'border-purple-300' },
    { id: 'orange', label: 'Naranja', bg: 'bg-orange-100', text: 'text-orange-900', border: 'border-orange-300' },
    { id: 'indigo', label: 'Índigo', bg: 'bg-indigo-100', text: 'text-indigo-900', border: 'border-indigo-300' },
    { id: 'rose', label: 'Rosa', bg: 'bg-rose-100', text: 'text-rose-900', border: 'border-rose-300' },
    { id: 'teal', label: 'Turquesa', bg: 'bg-teal-100', text: 'text-teal-900', border: 'border-teal-300' },
    { id: 'stone', label: 'Piedra', bg: 'bg-stone-100', text: 'text-stone-900', border: 'border-stone-300' },
  ];

  // Reactive Form: Expense
  public expenseForm = new FormGroup({
    concept: new FormControl<string>('', {nonNullable: true, validators: [Validators.required, Validators.minLength(4)]}),
    category: new FormControl<string>('alquiler_instalaciones', {nonNullable: true, validators: [Validators.required]}),
    // The operator captures the expense in bolívares; USD is derived with the
    // local rate so both amounts always stay coherent.
    amountBs: new FormControl<number>(0, {nonNullable: true, validators: [Validators.required, Validators.min(0.01)]}),
    amountUsd: new FormControl<number>(0, {nonNullable: true}),
    exchangeRateUsed: new FormControl<number>(defaultDocumentRate(this.api.exchangeRates()), {nonNullable: true, validators: [Validators.required, Validators.min(1)]}),
    supplierOrBeneficiary: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    supplierId: new FormControl<string>('', {nonNullable: true}),
    taxId: new FormControl<string>('', {nonNullable: true}),
    documentType: new FormControl<'factura_fiscal' | 'recibo_pago' | 'nota_debito' | 'vale_caja' | 'otro'>('factura_fiscal', {nonNullable: true}),
    documentNumber: new FormControl<string>('', {nonNullable: true}),
    paymentMethod: new FormControl<'transferencia_bancaria' | 'pago_movil' | 'efectivo_usd' | 'efectivo_bs' | 'zelle' | 'tarjeta'>('transferencia_bancaria', {nonNullable: true}),
    issuingBankCode: new FormControl<string>('', {nonNullable: true}),
    paymentAccountCode: new FormControl<string>('1.01.02', {nonNullable: true}),
    paymentReference: new FormControl<string>('', {nonNullable: true}),
    taxCategory: new FormControl<ExpenseTaxCategory>('con_factura_iva', {nonNullable: true}),
    taxRatePercent: new FormControl<number>(16.0, {nonNullable: true}),
    fiscalBookEligible: new FormControl<boolean>(true, {nonNullable: true}),
    accountingAccountCode: new FormControl<string>('5.1.01.01', {nonNullable: true}),
    accountingAccountName: new FormControl<string>('Alquileres de Planta de Producción', {nonNullable: true}),
    date: new FormControl<string>(new Date().toISOString().slice(0, 10), {nonNullable: true, validators: [Validators.required]}),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  constructor() {
    const syncUsd = () => {
      const bs = Number(this.expenseForm.controls.amountBs.value) || 0;
      const rate =
        defaultDocumentRate(this.api.exchangeRates(), undefined, this.expenseForm.controls.exchangeRateUsed.value);
      const usd = Number((bs / rate).toFixed(2));
      if (this.expenseForm.controls.amountUsd.value !== usd) {
        this.expenseForm.controls.amountUsd.setValue(usd, {emitEvent: false});
      }
    };
    this.expenseForm.controls.amountBs.valueChanges.subscribe(syncUsd);
    this.expenseForm.controls.exchangeRateUsed.valueChanges.subscribe(syncUsd);
  }

  // Reactive Form: Custom Category Definition
  public categoryForm = new FormGroup({
    name: new FormControl<string>('', {nonNullable: true, validators: [Validators.required, Validators.minLength(3)]}),
    icon: new FormControl<string>('storefront', {nonNullable: true, validators: [Validators.required]}),
    color: new FormControl<string>('amber', {nonNullable: true, validators: [Validators.required]}),
    monthlyBudgetUsd: new FormControl<number>(200.00, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    accountingAccountCode: new FormControl<string>('5.1.05.01', {nonNullable: true}),
    accountingAccountName: new FormControl<string>('Gastos Operativos Generales', {nonNullable: true}),
    defaultTaxCategory: new FormControl<ExpenseTaxCategory>('con_factura_iva', {nonNullable: true}),
    description: new FormControl<string>('', {nonNullable: true}),
  });

  // Reactive Form: Quick Budget Edit
  public budgetEditForm = new FormGroup({
    monthlyBudgetUsd: new FormControl<number>(0, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
  });

  public expensesList = computed<Expense[]>(() => this.api.expenses());

  // Distinct Months available for filtering
  public availableMonths = computed<{ value: string; label: string }[]>(() => {
    const exps = this.expensesList();
    const monthsSet = new Set<string>();
    for (const e of exps) {
      if (e.date && e.date.length >= 7) {
        monthsSet.add(e.date.slice(0, 7));
      }
    }
    const currentMonthStr = '2026-10';
    monthsSet.add(currentMonthStr);

    const sorted = Array.from(monthsSet).sort().reverse();
    const monthNames: Record<string, string> = {
      '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
      '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
      '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
    };

    return sorted.map(m => {
      const [year, month] = m.split('-');
      const name = monthNames[month] || month;
      return {
        value: m,
        label: `${name} ${year}`,
      };
    });
  });

  // Comparative Category Budget Analysis (For selected month)
  public categoryBudgetAnalyses = computed<CategoryBudgetAnalysis[]>(() => {
    const month = this.selectedMonthFilter();
    const allExpenses = this.expensesList();
    const categories = this.api.expenseCategories();
    const rate = defaultDocumentRate(this.api.exchangeRates());

    // Filter expenses by selected month (or all)
    const monthExpenses = month === 'all'
      ? allExpenses
      : allExpenses.filter(e => e.date?.startsWith(month));

    return categories.map(cat => {
      const matchingExpenses = monthExpenses.filter(
        e => e.category === cat.id || e.categoryLabel?.toLowerCase() === cat.name.toLowerCase()
      );
      const actualAmountUsd = matchingExpenses.reduce((sum, e) => sum + (Number(e.amountUsd) || 0), 0);
      const actualAmountBs = actualAmountUsd * rate;
      const monthlyBudgetUsd = Number(cat.monthlyBudgetUsd) || 0;
      const differenceUsd = monthlyBudgetUsd - actualAmountUsd;
      const percentageConsumed = monthlyBudgetUsd > 0
        ? Number(((actualAmountUsd / monthlyBudgetUsd) * 100).toFixed(1))
        : (actualAmountUsd > 0 ? 100 : 0);

      let status: 'normal' | 'warning' | 'danger' = 'normal';
      if (percentageConsumed >= 100) {
        status = 'danger';
      } else if (percentageConsumed >= 70) {
        status = 'warning';
      }

      const barWidthPercent = Math.min(100, percentageConsumed);

      return {
        category: cat,
        actualAmountUsd,
        actualAmountBs,
        monthlyBudgetUsd,
        differenceUsd,
        percentageConsumed,
        status,
        expenseCount: matchingExpenses.length,
        barWidthPercent,
      };
    });
  });

  // Overall Monthly Budget Summary
  public budgetSummary = computed(() => {
    const analyses = this.categoryBudgetAnalyses();
    const totalActualUsd = analyses.reduce((sum, a) => sum + a.actualAmountUsd, 0);
    const totalBudgetUsd = analyses.reduce((sum, a) => sum + a.monthlyBudgetUsd, 0);
    const totalDifferenceUsd = totalBudgetUsd - totalActualUsd;
    const overallPercentage = totalBudgetUsd > 0
      ? Number(((totalActualUsd / totalBudgetUsd) * 100).toFixed(1))
      : 0;
    const exceededCategories = analyses.filter(a => a.status === 'danger');
    const warningCategories = analyses.filter(a => a.status === 'warning');

    return {
      totalActualUsd,
      totalBudgetUsd,
      totalDifferenceUsd,
      overallPercentage,
      exceededCount: exceededCategories.length,
      warningCount: warningCategories.length,
      exceededCategories,
    };
  });

  // Contextual budget check for selected category in registration form
  public selectedCategoryBudgetWarning = computed(() => {
    const catId = this.expenseForm.controls.category.value;
    const amount = Number(this.expenseForm.controls.amountUsd.value) || 0;
    const analyses = this.categoryBudgetAnalyses();
    const target = analyses.find(a => a.category.id === catId);

    if (!target) return null;

    const projectedTotal = target.actualAmountUsd + amount;
    const isCurrentlyExceeded = target.status === 'danger';
    const willExceed = target.monthlyBudgetUsd > 0 && projectedTotal > target.monthlyBudgetUsd;

    return {
      categoryName: target.category.name,
      currentActual: target.actualAmountUsd,
      monthlyBudget: target.monthlyBudgetUsd,
      projectedTotal,
      percentageNow: target.percentageConsumed,
      isCurrentlyExceeded,
      willExceed,
      remaining: target.differenceUsd,
    };
  });

  // Filtered Expenses for List
  public filteredExpenses = computed<Expense[]>(() => {
    const all = this.expensesList();
    const cat = this.categoryFilter();
    const month = this.selectedMonthFilter();
    const query = this.searchQuery().trim().toLowerCase();

    return all.filter(exp => {
      // Month match
      if (month !== 'all' && !exp.date?.startsWith(month)) {
        return false;
      }

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
    return this.filteredExpenses().reduce((acc, e) => acc + (Number(e.amountUsd) || 0), 0);
  });

  public totalAmountBs = computed<number>(() => {
    return this.filteredExpenses().reduce((acc, e) => acc + (Number(e.amountBs) || 0), 0);
  });

  public operationalAmountUsd = computed<number>(() => {
    return this.filteredExpenses()
      .filter(e => e.category !== 'gastos_personales_socios')
      .reduce((acc, e) => acc + (Number(e.amountUsd) || 0), 0);
  });

  public personalPartnersAmountUsd = computed<number>(() => {
    return this.filteredExpenses()
      .filter(e => e.category === 'gastos_personales_socios')
      .reduce((acc, e) => acc + (Number(e.amountUsd) || 0), 0);
  });

  public fiscalCreditIvaAmountUsd = computed<number>(() => {
    return this.filteredExpenses()
      .filter(e => e.fiscalBookEligible && e.taxAmountUsd)
      .reduce((acc, e) => acc + (Number(e.taxAmountUsd) || 0), 0);
  });

  public fiscalCreditIvaAmountBs = computed<number>(() => {
    return this.filteredExpenses()
      .filter(e => e.fiscalBookEligible && e.taxAmountBs)
      .reduce((acc, e) => acc + (Number(e.taxAmountBs) || 0), 0);
  });

  public expensesAuditCount = computed<number>(() => {
    return this.api.auditLogs().filter(l => l.module === 'gastos').length;
  });

  /** Conteos reales para las tarjetas de libros de la pestaña de preparación. */
  public purchasesBookCount = computed<number>(() =>
    this.api.expenses().filter(e => e.fiscalBookEligible).length
  );
  public salesBookCount = computed<number>(() => this.api.fiscalInvoices().length);
  public accountingEntriesCount = computed<number>(() => this.api.accountingEntries().length);

  /** Última exportación de libros registrada en la bitácora (si existe). */
  public lastBookExportLabel = computed<string>(() => {
    const entry = this.api
      .auditLogs()
      .find(log => log.module === 'contabilidad' && /export|libro/i.test(log.title));
    if (!entry) return 'Sin exportaciones registradas';
    return new Date(entry.timestamp).toLocaleString('es-VE', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  });

  /** Abre el libro correspondiente en Contabilidad, preseleccionando el tipo. */
  public openAccountingBook(type: AccountingBookType): void {
    this.api.navigateToAccountingBook(type);
  }

  // Category Color Badge Helpers
  public getCategoryColorClass(color?: string): string {
    switch (color) {
      case 'amber': return 'bg-amber-100 text-amber-900 border-amber-200';
      case 'sky': return 'bg-sky-100 text-sky-900 border-sky-200';
      case 'emerald': return 'bg-emerald-100 text-emerald-900 border-emerald-200';
      case 'purple': return 'bg-purple-100 text-purple-900 border-purple-200';
      case 'orange': return 'bg-orange-100 text-orange-900 border-orange-200';
      case 'indigo': return 'bg-indigo-100 text-indigo-900 border-indigo-200';
      case 'rose': return 'bg-rose-100 text-rose-900 border-rose-200';
      case 'teal': return 'bg-teal-100 text-teal-900 border-teal-200';
      default: return 'bg-stone-100 text-stone-900 border-stone-200';
    }
  }

  public getCategoryBarColor(status: 'normal' | 'warning' | 'danger', color?: string): string {
    if (status === 'danger') return 'bg-rose-500';
    if (status === 'warning') return 'bg-amber-500';
    switch (color) {
      case 'emerald': return 'bg-emerald-500';
      case 'sky': return 'bg-sky-500';
      case 'purple': return 'bg-purple-500';
      case 'indigo': return 'bg-indigo-500';
      case 'teal': return 'bg-teal-500';
      case 'orange': return 'bg-orange-500';
      default: return 'bg-amber-600';
    }
  }

  // Auto-fill form on category change
  public onCategoryChange(catId: string) {
    const cat = this.api.expenseCategories().find(c => c.id === catId);
    if (!cat) return;

    const isPartner = cat.id === 'gastos_personales_socios';
    const isTravel = cat.id === 'viajes_viaticos';

    this.expenseForm.patchValue({
      accountingAccountCode: cat.accountingAccountCode || '5.1.01.01',
      accountingAccountName: cat.accountingAccountName || cat.name,
      taxCategory: cat.defaultTaxCategory || 'con_factura_iva',
      fiscalBookEligible: !isPartner && !isTravel,
      documentType: isPartner ? 'vale_caja' : (isTravel ? 'recibo_pago' : 'factura_fiscal'),
    });
  }

  /** Sincroniza el maestro de proveedores con los campos fiscales del egreso. */
  public onSupplierSelected(selection: SupplierSelection): void {
    this.expenseForm.controls.supplierId.setValue(selection.supplierId);
    this.expenseForm.controls.taxId.setValue(selection.taxId || '');
  }

  public openCreateModal() {
    const activeRate = defaultDocumentRate(this.api.exchangeRates());
    const defaultCat = this.api.expenseCategories()[0]?.id || 'alquiler_instalaciones';
    this.expenseForm.reset({
      concept: '',
      category: defaultCat,
      amountBs: Number((150 * activeRate).toFixed(2)),
      amountUsd: 150.00,
      exchangeRateUsed: activeRate,
      supplierOrBeneficiary: '',
      supplierId: '',
      taxId: '',
      documentType: 'factura_fiscal',
      documentNumber: '',
      paymentMethod: 'transferencia_bancaria',
      issuingBankCode: '',
      paymentAccountCode: '1.01.02',
      paymentReference: '',
      taxCategory: 'con_factura_iva',
      taxRatePercent: 16.0,
      fiscalBookEligible: true,
      accountingAccountCode: '5.1.01.01',
      accountingAccountName: 'Alquileres de Planta de Producción',
      date: new Date().toISOString().slice(0, 10),
      notes: '',
    });
    this.bankQuery.set('');
    this.onCategoryChange(defaultCat);
    this.isCreateModalOpen.set(true);
  }

  public closeCreateModal() {
    this.isCreateModalOpen.set(false);
  }

  public requiresIssuingBank(): boolean {
    return this.bankPaymentMethods.includes(
      this.expenseForm.controls.paymentMethod.value
    );
  }

  public onBankQueryChange(value: string) {
    this.bankQuery.set(value);
    const bank = findBank(value);
    this.expenseForm.controls.issuingBankCode.setValue(bank?.code || '');
  }

  public selectedBankName(): string {
    const code = this.expenseForm.controls.issuingBankCode.value;
    return findBank(code)?.name || '';
  }

  public openDetailModal(exp: Expense) {
    this.selectedExpenseForDetail.set(exp);
    this.isDetailModalOpen.set(true);
  }

  public closeDetailModal() {
    this.isDetailModalOpen.set(false);
    this.selectedExpenseForDetail.set(null);
  }

  // Categories & Budget Modal Handlers
  public openCategoryModal() {
    this.categoryForm.reset({
      name: '',
      icon: 'storefront',
      color: 'amber',
      monthlyBudgetUsd: 250.00,
      accountingAccountCode: '5.1.05.01',
      accountingAccountName: 'Gastos de Operación y Logística',
      defaultTaxCategory: 'con_factura_iva',
      description: '',
    });
    this.isCategoryModalOpen.set(true);
  }

  public closeCategoryModal() {
    this.isCategoryModalOpen.set(false);
  }

  public async submitCategory() {
    if (this.categoryForm.invalid) return;
    const v = this.categoryForm.getRawValue();

    await this.api.addExpenseCategory({
      name: v.name,
      icon: v.icon,
      color: v.color,
      monthlyBudgetUsd: Number(v.monthlyBudgetUsd) || 0,
      accountingAccountCode: v.accountingAccountCode || undefined,
      accountingAccountName: v.accountingAccountName || undefined,
      defaultTaxCategory: v.defaultTaxCategory,
      description: v.description || undefined,
      isSystem: false,
    });

    this.closeCategoryModal();
  }

  public openBudgetModal(cat: ExpenseCategoryConfig) {
    this.editingCategoryForBudget.set(cat);
    this.budgetEditForm.reset({
      monthlyBudgetUsd: cat.monthlyBudgetUsd || 0,
    });
    this.isBudgetModalOpen.set(true);
  }

  public closeBudgetModal() {
    this.isBudgetModalOpen.set(false);
    this.editingCategoryForBudget.set(null);
  }

  public async saveBudgetEdit() {
    const cat = this.editingCategoryForBudget();
    if (!cat) return;
    const newBudget = Number(this.budgetEditForm.controls.monthlyBudgetUsd.value) || 0;

    await this.api.updateExpenseCategory(cat.id, {
      monthlyBudgetUsd: newBudget,
    });

    this.closeBudgetModal();
  }

  public async deleteCategory(cat: ExpenseCategoryConfig) {
    if (cat.isSystem) {
      this.api.showToast('No se pueden eliminar las categorías base del sistema.', 'error');
      return;
    }
    if (confirm(`¿Deseas eliminar la categoría personalizada "${cat.name}"? Los egresos existentes conservarán su registro.`)) {
      await this.api.deleteExpenseCategory(cat.id);
    }
  }

  public async submitExpense() {
    if (this.expenseForm.invalid) return;
    const v = this.expenseForm.getRawValue();
    if (this.requiresIssuingBank() && !v.issuingBankCode) {
      this.api.showToast(
        'Selecciona el banco emisor del pago desde el catálogo oficial SUDEBAN.',
        'error'
      );
      return;
    }
    const bank = v.issuingBankCode ? findBank(v.issuingBankCode) : undefined;
    const rate = defaultDocumentRate(this.api.exchangeRates(), undefined, v.exchangeRateUsed);
    // Bolívares is the source of truth: USD is derived from the local rate.
    const amountBs = Number(v.amountBs) || 0;
    const amountUsd = Number((amountBs / rate).toFixed(2));

    const catMeta = this.api.expenseCategories().find(c => c.id === v.category);
    const categoryLabel = catMeta ? catMeta.name : 'Gasto General';

    // Tax calculation on the gross amount captured in bolívares.
    let taxAmountUsd: number | undefined = undefined;
    let taxAmountBs: number | undefined = undefined;
    if (v.taxCategory === 'con_factura_iva' && v.taxRatePercent) {
      const baseBs = amountBs / (1 + (v.taxRatePercent / 100));
      taxAmountBs = Number((amountBs - baseBs).toFixed(2));
      taxAmountUsd = Number((taxAmountBs / rate).toFixed(2));
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
      supplierId: v.supplierId || undefined,
      taxId: v.taxId || undefined,
      documentType: v.documentType,
      documentNumber: v.documentNumber || undefined,
      paymentMethod: v.paymentMethod,
      issuingBankCode: bank?.code,
      issuingBankName: bank?.name,
      paymentAccountCode: v.paymentAccountCode || undefined,
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
