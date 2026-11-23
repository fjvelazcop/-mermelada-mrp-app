import type { Database } from 'better-sqlite3';
import type { DatabaseState } from '../erp-database.js';
import {
  Account,
  AccountingBookSettings,
  AccountingEntry,
  AccountingEntryLine,
  AccountingPeriod,
  AuditLogEntry,
  Customer,
  DailyExchangeRates,
  DeliveryNote,
  Employee,
  Expense,
  ExpenseCategoryConfig,
  FiscalAdjustmentNote,
  FiscalInvoice,
  FiscalPeriodClosure,
  FiscalObligationHistoryEntry,
  FiscalObligationRecord,
  FiscalReferenceValue,
  FiscalSettings,
  FinishedGood,
  InventoryMovement,
  MaterialCategoryConfig,
  Payable,
  PayablePayment,
  PayrollWeek,
  ProductionOrder,
  RawMaterial,
  RecipeBOM,
  SalesCollection,
  SalesOrder,
  Supplier,
  SupplierPrice,
  SupplierTypeConfig,
} from '../../app/core/models/erp.models.js';
import { getDb } from './persistence.js';

/**
 * Relational persistence for the ERP state.
 *
 * The business layer (`ErpDatabase`) keeps the state in memory for fast reads.
 * Whenever a mutating operation happens, the whole snapshot is written to the
 * normalized SQLite schema inside a single transaction. This keeps the
 * relational model as the source of truth on disk while avoiding a costly
 * rewrite of every business method.
 */

type Row = Record<string, any>;

/** Convert an optional value to `null` so better-sqlite3 can bind it. */
const v = <T>(value: T | undefined | null): T | null =>
  value === undefined || value === null ? null : value;

/** Convert a boolean flag into SQLite's 0/1 representation. */
const b = (value: boolean | undefined): number => (value ? 1 : 0);

/** Convert a nullable column back into an optional TypeScript value. */
const o = <T>(value: T | null | undefined): T | undefined =>
  value === null || value === undefined ? undefined : value;

function hasData(db: Database): boolean {
  const materials = db
    .prepare('SELECT COUNT(*) AS count FROM raw_materials')
    .get() as { count: number };
  if (materials.count > 0) return true;

  const fiscal = db
    .prepare('SELECT COUNT(*) AS count FROM fiscal_settings')
    .get() as { count: number };
  return fiscal.count > 0;
}

/** Read the complete ERP state from the normalized tables. */
export function loadRelationalState(): DatabaseState | null {
  const db = getDb();
  if (!hasData(db)) return null;

  const rawMaterials = (
    db.prepare('SELECT * FROM raw_materials ORDER BY rowid').all() as Row[]
  ).map(
    (r): RawMaterial => ({
      id: r['id'],
      code: r['code'],
      name: r['name'],
      category: r['category'],
      currentStock: r['current_stock'],
      minStock: r['min_stock'],
      unit: r['unit'],
      costPerUnit: r['cost_per_unit'],
      supplier: o(r['supplier']),
      lastRestockDate: r['last_restock_date'],
      notes: o(r['notes']),
    })
  );

  const inventoryMovements = (
    db.prepare('SELECT * FROM inventory_movements ORDER BY rowid').all() as Row[]
  ).map(
    (r): InventoryMovement => ({
      id: r['id'],
      materialId: r['material_id'],
      materialName: r['material_name'],
      type: r['type'],
      quantity: r['quantity'],
      costPerUnit: r['cost_per_unit'],
      totalCost: r['total_cost'],
      exchangeRateUsed: r['exchange_rate_used'],
      costPerUnitBs: o(r['cost_per_unit_bs']),
      totalCostBs: o(r['total_cost_bs']),
      referenceDoc: o(r['reference_doc']),
      supplierId: o(r['supplier_id']),
      supplierNameSnapshot: o(r['supplier_name_snapshot']),
      supplierTaxIdSnapshot: o(r['supplier_tax_id_snapshot']),
      notes: o(r['notes']),
      date: r['movement_date'],
      performedBy: r['performed_by'],
      paymentCondition: o(r['payment_condition']) as InventoryMovement['paymentCondition'],
      paymentMethod: o(r['payment_method']) as InventoryMovement['paymentMethod'],
      bankCode: o(r['bank_code']),
      bankName: o(r['bank_name']),
      paymentReference: o(r['payment_reference']),
      creditDays: r['credit_days'] === null || r['credit_days'] === undefined
        ? undefined
        : Number(r['credit_days']),
      dueDate: o(r['due_date']),
      payableId: o(r['payable_id']),
      payableNumber: o(r['payable_number']),
    })
  );

  const finishedGoods = (
    db.prepare('SELECT * FROM finished_goods ORDER BY rowid').all() as Row[]
  ).map(
    (r): FinishedGood => ({
      id: r['id'],
      code: r['code'],
      flavor: r['flavor'],
      presentation: r['presentation'],
      presentationLabel: r['presentation_label'],
      weightGrams: r['weight_grams'],
      stockUnits: r['stock_units'],
      reservedUnits: r['reserved_units'],
      availableUnits: r['available_units'],
      baseCost: r['base_cost'],
      suggestedWholesalePrice: r['suggested_wholesale_price'],
      suggestedRetailPrice: r['suggested_retail_price'],
      suggestedSpecialPrice: r['suggested_special_price'],
      minStock: r['min_stock'],
    })
  );

  const recipeItems = db
    .prepare('SELECT * FROM recipe_items ORDER BY id')
    .all() as Row[];
  const recipes = (
    db.prepare('SELECT * FROM recipes ORDER BY rowid').all() as Row[]
  ).map(
    (r): RecipeBOM => ({
      id: r['id'],
      code: r['code'],
      name: r['name'],
      flavor: r['flavor'],
      presentation: r['presentation'],
      batchSizeUnits: r['batch_size_units'],
      items: recipeItems
        .filter((item) => item['recipe_id'] === r['id'])
        .map((item) => ({
          materialId: item['material_id'],
          materialName: item['material_name'],
          quantity: item['quantity'],
          unit: item['unit'],
          estimatedCost: item['estimated_cost'],
        })),
      directLaborMinutes: r['direct_labor_minutes'],
      estimatedUtilityCost: r['estimated_utility_cost'],
      instructions: o(r['instructions']),
    })
  );

  const productionMaterials = db
    .prepare('SELECT * FROM production_order_materials ORDER BY id')
    .all() as Row[];
  const productionOrders = (
    db.prepare('SELECT * FROM production_orders ORDER BY rowid').all() as Row[]
  ).map(
    (r): ProductionOrder => ({
      id: r['id'],
      orderNumber: r['order_number'],
      recipeId: r['recipe_id'],
      recipeName: r['recipe_name'],
      flavor: r['flavor'],
      presentation: r['presentation'],
      targetUnits: r['target_units'],
      batchCount: r['batch_count'],
      lotNumber: r['lot_number'],
      status: r['status'],
      salesOrderId: o(r['sales_order_id']),
      customerName: o(r['customer_name']),
      startDate: r['start_date'],
      completionDate: o(r['completion_date']),
      createdAt: o(r['created_at']),
      exchangeRateUsed: o(r['exchange_rate_used']),
      consumedMaterials: productionMaterials
        .filter((item) => item['order_id'] === r['id'])
        .map((item) => ({
          materialId: item['material_id'],
          materialName: item['material_name'],
          quantityConsumed: item['quantity_consumed'],
          unit: item['unit'],
          unitCost: item['unit_cost'],
          totalCost: item['total_cost'],
        })),
      directMaterialCost: r['direct_material_cost'],
      directLaborCost: r['direct_labor_cost'],
      indirectCost: r['indirect_cost'],
      totalProductionCost: r['total_production_cost'],
      totalCost: o(r['total_cost']),
      unitCost: r['unit_cost'],
      totalProductionCostBs: o(r['total_production_cost_bs']),
      unitCostBs: o(r['unit_cost_bs']),
      operatorNotes: o(r['operator_notes']),
      mode: (r['mode'] as ProductionOrder['mode']) || 'automatico',
      formulas: r['formulas_json'] ? JSON.parse(r['formulas_json']) : undefined,
      manualSheet: r['manual_sheet_json']
        ? JSON.parse(r['manual_sheet_json'])
        : undefined,
      productionDate: r['production_date'] ? r['production_date'] : undefined,
      commitmentReference: o(r['commitment_reference']),
      createdBy: o(r['created_by']),
      updatedBy: o(r['updated_by']),
      processedBy: o(r['processed_by']),
      processedAt: o(r['processed_at']),
      annulledBy: o(r['annulled_by']),
      annulledAt: o(r['annulled_at']),
    })
  );

  const customers = (
    db.prepare('SELECT * FROM customers ORDER BY rowid').all() as Row[]
  ).map(
    (r): Customer => ({
      id: r['id'],
      businessName: r['business_name'],
      taxId: r['tax_id'],
      nit: o(r['nit']),
      contactPerson: r['contact_person'],
      phone: r['phone'],
      email: r['email'],
      address: r['address'],
      clientType: r['client_type'],
      creditLimit: r['credit_limit'],
      paymentTerms: r['payment_terms'],
    })
  );

  const salesItems = db
    .prepare('SELECT * FROM sales_order_items ORDER BY id')
    .all() as Row[];
  const salesOrders = (
    db.prepare('SELECT * FROM sales_orders ORDER BY rowid').all() as Row[]
  ).map(
    (r): SalesOrder => {
      const collections: SalesCollection[] | undefined = r['collections_json']
        ? JSON.parse(r['collections_json'])
        : undefined;
      const lastCollection: SalesCollection | undefined = collections?.length
        ? collections[collections.length - 1]
        : r['collection_json']
          ? (JSON.parse(r['collection_json']) as SalesCollection)
          : undefined;
      return {
      id: r['id'],
      orderNumber: r['order_number'],
      customerId: r['customer_id'],
      customerName: r['customer_name'],
      customerTaxId: r['customer_tax_id'],
      customerNit: o(r['customer_nit']),
      saleCondition: o(r['sale_condition']),
      paymentMethod: o(r['payment_method']),
      creditDays: o(r['credit_days']),
      orderDate: r['order_date'],
      deliveryDate: r['delivery_date'],
      status: r['status'],
      exchangeRateUsed: r['exchange_rate_used'],
      items: salesItems
        .filter((item) => item['order_id'] === r['id'])
        .map((item) => ({
          finishedGoodId: item['finished_good_id'],
          flavor: item['flavor'],
          presentation: item['presentation'],
          presentationLabel: item['presentation_label'],
          quantity: item['quantity'],
          unitPrice: item['unit_price'],
          subtotal: item['subtotal'],
          unitPriceBs: o(item['unit_price_bs']),
          subtotalBs: o(item['subtotal_bs']),
          priceTier: o(item['price_tier']),
          profitMarginPercent: o(item['profit_margin_percent']),
          baseCost: o(item['base_cost']),
          taxCategory: o(item['tax_category']),
          taxRatePercent: o(item['tax_rate_percent']),
          taxAmount: o(item['tax_amount']),
        })),
      subtotal: r['subtotal'],
      taxAmount: r['tax_amount'],
      total: r['total'],
      subtotalBs: o(r['subtotal_bs']),
      taxAmountBs: o(r['tax_amount_bs']),
      totalBs: o(r['total_bs']),
      hasDeliveryNote: r['has_delivery_note'] === 1,
      deliveryNoteNumber: o(r['delivery_note_number']),
      productionOrderId: o(r['production_order_id']),
      notes: o(r['notes']),
      createdBy: o(r['created_by']),
      collections,
      collection: lastCollection,
      };
    }
  );

  const supplierTypes = (
    db.prepare('SELECT * FROM supplier_types ORDER BY rowid').all() as Row[]
  ).map(
    (r): SupplierTypeConfig => ({
      id: r['id'],
      code: r['code'],
      label: r['label'],
      description: o(r['description']) ?? '',
      color: r['color'] || 'stone',
      active: r['active'] === 1,
      isSystem: r['is_system'] === 1,
      createdAt: r['created_at'],
      updatedAt: r['updated_at'],
    })
  );

  const materialCategories = (
    db.prepare('SELECT * FROM material_categories ORDER BY rowid').all() as Row[]
  ).map(
    (r): MaterialCategoryConfig => ({
      id: r['id'],
      code: r['code'],
      label: r['label'],
      description: o(r['description']) ?? '',
      color: r['color'] || 'stone',
      active: r['active'] === 1,
      isSystem: r['is_system'] === 1,
      createdAt: r['created_at'],
      updatedAt: r['updated_at'],
    })
  );

  const suppliers = (
    db.prepare('SELECT * FROM suppliers ORDER BY rowid').all() as Row[]
  ).map(
    (r): Supplier => ({
      id: r['id'],
      code: r['code'],
      businessName: r['business_name'],
      taxId: r['tax_id'],
      primaryContact: r['primary_contact'],
      primaryPhone: r['primary_phone'],
      secondaryPhone: o(r['secondary_phone']),
      email: o(r['email']),
      fiscalAddress: r['fiscal_address'],
      physicalAddress: o(r['physical_address']),
      supplierType: r['supplier_type'],
      paymentTerms: r['payment_terms'],
      status: r['status'],
      notes: o(r['notes']),
      createdAt: r['created_at'],
    })
  );

  const supplierPrices = (
    db.prepare('SELECT * FROM supplier_prices ORDER BY rowid').all() as Row[]
  ).map(
    (r): SupplierPrice => ({
      id: r['id'],
      supplierId: r['supplier_id'],
      supplierName: r['supplier_name'],
      materialId: o(r['material_id']),
      productName: r['product_name'],
      unit: r['unit'],
      priceUsd: r['price_usd'],
      validFrom: r['valid_from'],
      validTo: o(r['valid_to']),
      isCurrent: r['is_current'] === 1,
      notes: o(r['notes']),
      createdAt: r['created_at'],
      createdBy: o(r['created_by']),
    })
  );

  const deliveryItems = db
    .prepare('SELECT * FROM delivery_note_items ORDER BY id')
    .all() as Row[];
  const deliveryNotes = (
    db.prepare('SELECT * FROM delivery_notes ORDER BY rowid').all() as Row[]
  ).map(
    (r): DeliveryNote => ({
      id: r['id'],
      noteNumber: r['note_number'],
      salesOrderId: r['sales_order_id'],
      salesOrderNumber: r['sales_order_number'],
      customerName: r['customer_name'],
      customerTaxId: r['customer_tax_id'],
      customerAddress: r['customer_address'],
      customerPhone: r['customer_phone'],
      dispatchDate: r['dispatch_date'],
      exchangeRateUsed: r['exchange_rate_used'],
      items: deliveryItems
        .filter((item) => item['note_id'] === r['id'])
        .map((item) => ({
          description: item['description'],
          presentationLabel: item['presentation_label'],
          quantity: item['quantity'],
          lotNumber: o(item['lot_number']),
          unitPrice: item['unit_price'],
          subtotal: item['subtotal'],
          unitPriceBs: o(item['unit_price_bs']),
          subtotalBs: o(item['subtotal_bs']),
        })),
      subtotal: r['subtotal'],
      taxIncluded: r['tax_included'] === 1,
      taxAmount: r['tax_amount'],
      total: r['total'],
      subtotalBs: o(r['subtotal_bs']),
      taxAmountBs: o(r['tax_amount_bs']),
      totalBs: o(r['total_bs']),
      transporter: o(r['transporter']),
      receivedByName: o(r['received_by_name']),
      receivedById: o(r['received_by_id']),
      signatureDate: o(r['signature_date']),
      status: r['status'],
      observations: o(r['observations']),
    })
  );

  const employees = (
    db.prepare('SELECT * FROM employees ORDER BY rowid').all() as Row[]
  ).map(
    (r): Employee => ({
      id: r['id'],
      fullName: r['full_name'],
      nationalId: r['national_id'],
      roleTitle: r['role_title'],
      weeklyBaseSalary: r['weekly_base_salary'],
      hourlyRate: r['hourly_rate'],
      status: r['status'],
    })
  );

  const payrollPayments = db
    .prepare('SELECT * FROM payroll_payments ORDER BY id')
    .all() as Row[];
  const payrollWeeks = (
    db.prepare('SELECT * FROM payroll_weeks ORDER BY rowid').all() as Row[]
  ).map(
    (r): PayrollWeek => ({
      id: r['id'],
      weekNumber: r['week_number'],
      year: r['year'],
      startDate: r['start_date'],
      endDate: r['end_date'],
      isActiveProduction: r['is_active_production'] === 1,
      inactivityReason: o(r['inactivity_reason']),
      payments: payrollPayments
        .filter((item) => item['week_id'] === r['id'])
        .map((item) => ({
          employeeId: item['employee_id'],
          employeeName: item['employee_name'],
          roleTitle: item['role_title'],
          baseAmount: item['base_amount'],
          productionBonus: item['production_bonus'],
          deductions: item['deductions'],
          netPaid: item['net_paid'],
        })),
      totalPayrollPaid: r['total_payroll_paid'],
      fixedAbsorptionCost: r['fixed_absorption_cost'],
      bonusByRole: r['bonus_by_role_json'] ? JSON.parse(r['bonus_by_role_json']) : undefined,
      notes: o(r['notes']),
    })
  );

  const expenses = (
    db.prepare('SELECT * FROM expenses ORDER BY rowid').all() as Row[]
  ).map(
    (r): Expense => ({
      id: r['id'],
      expenseNumber: r['expense_number'],
      date: r['expense_date'],
      concept: r['concept'],
      category: r['category'],
      categoryLabel: r['category_label'],
      amountUsd: r['amount_usd'],
      exchangeRateUsed: r['exchange_rate_used'],
      amountBs: r['amount_bs'],
      supplierOrBeneficiary: r['supplier_or_beneficiary'],
      supplierId: o(r['supplier_id']),
      taxId: o(r['tax_id']),
      documentType: r['document_type'],
      documentNumber: o(r['document_number']),
      paymentMethod: r['payment_method'],
      paymentReference: o(r['payment_reference']),
      issuingBankCode: o(r['issuing_bank_code']),
      issuingBankName: o(r['issuing_bank_name']),
      notes: o(r['notes']),
      registeredBy: r['registered_by'],
      taxCategory: r['tax_category'],
      taxRatePercent: o(r['tax_rate_percent']),
      taxAmountUsd: o(r['tax_amount_usd']),
      taxAmountBs: o(r['tax_amount_bs']),
      accountingAccountCode: o(r['accounting_account_code']),
      accountingAccountName: o(r['accounting_account_name']),
      fiscalBookEligible: r['fiscal_book_eligible'] === 1,
      payableId: o(r['payable_id']),
    })
  );

  const payablePayments = (
    db.prepare('SELECT * FROM payable_payments ORDER BY rowid').all() as Row[]
  ).map(
    (r): PayablePayment => ({
      id: r['id'],
      payableId: r['payable_id'],
      bankCode: r['bank_code'],
      bankName: r['bank_name'],
      paymentMethod: r['payment_method'],
      reference: r['reference'],
      amountUsd: r['amount_usd'],
      amountBs: r['amount_bs'],
      exchangeRateUsed: r['exchange_rate_used'],
      paidAt: r['paid_at'],
      paidBy: r['paid_by'],
    })
  );

  const payables = (db.prepare('SELECT * FROM payables ORDER BY rowid').all() as Row[]).map(
    (r): Payable => ({
      id: r['id'],
      payableNumber: r['payable_number'],
      supplierId: o(r['supplier_id']),
      supplierName: r['supplier_name'],
      taxId: o(r['tax_id']),
      invoiceNumber: r['invoice_number'],
      controlNumber: o(r['control_number']),
      issueDate: r['issue_date'],
      dueDate: r['due_date'],
      amountUsd: r['amount_usd'],
      exchangeRateUsed: r['exchange_rate_used'],
      amountBs: r['amount_bs'],
      taxAmountUsd: o(r['tax_amount_usd']),
      category: r['category'],
      status: r['status'],
      notes: o(r['notes']),
      createdBy: o(r['created_by']),
      createdAt: o(r['created_at']),
      updatedAt: o(r['updated_at']),
      expenseId: o(r['expense_id']),
    })
  );

  const expenseCategories = (
    db.prepare('SELECT * FROM expense_categories ORDER BY rowid').all() as Row[]
  ).map(
    (r): ExpenseCategoryConfig => ({
      id: r['id'],
      name: r['name'],
      icon: r['icon'],
      color: r['color'],
      monthlyBudgetUsd: r['monthly_budget_usd'],
      accountingAccountCode: o(r['accounting_account_code']),
      accountingAccountName: o(r['accounting_account_name']),
      defaultTaxCategory: o(r['default_tax_category']),
      description: o(r['description']),
      isSystem: r['is_system'] === null ? undefined : r['is_system'] === 1,
    })
  );

  const fiscalRow = db
    .prepare('SELECT * FROM fiscal_settings WHERE id = 1')
    .get() as Row | undefined;
  const fiscalSettings: FiscalSettings = fiscalRow
    ? {
        enabled: fiscalRow['enabled'] === 1,
        companyName: fiscalRow['company_name'],
        companyTaxId: fiscalRow['company_tax_id'],
        fiscalAddress: fiscalRow['fiscal_address'],
        companyPhone: fiscalRow['company_phone'] ?? '',
        companyEmail: fiscalRow['company_email'] ?? '',
        economicActivity: fiscalRow['economic_activity'] ?? '',
        taxRegime: fiscalRow['tax_regime'] ?? 'ordinario',
        taxRatePercent: fiscalRow['tax_rate_percent'],
        invoicePrefix: fiscalRow['invoice_prefix'],
        invoiceSerie: fiscalRow['invoice_serie'] ?? 'A',
        nextInvoiceNumber: fiscalRow['next_invoice_number'],
        controlPrefix: fiscalRow['control_prefix'] ?? '',
        nextControlNumber: fiscalRow['next_control_number'] ?? 1,
        nextCreditNoteNumber: fiscalRow['next_credit_note_number'] ?? 1,
        nextDebitNoteNumber: fiscalRow['next_debit_note_number'] ?? 1,
        authorizationCode: fiscalRow['authorization_code'],
        authorizationValidUntil: fiscalRow['authorization_valid_until'] ?? '',
        branchName: fiscalRow['branch_name'] ?? '',
        branchAddress: fiscalRow['branch_address'] ?? '',
        vatWithholdingAgent: fiscalRow['vat_withholding_agent'] === 1,
        vatWithholdingPercent: fiscalRow['vat_withholding_percent'] ?? 75,
        islrWithholdingAgent: fiscalRow['islr_withholding_agent'] === 1,
        islrWithholdingPercent: fiscalRow['islr_withholding_percent'] ?? 0,
        specialTaxpayer: fiscalRow['special_taxpayer'] === 1,
        accountingEnabled: fiscalRow['accounting_enabled'] !== 0,
        vatWithholdingEnabled: fiscalRow['vat_withholding_enabled'] === 1,
        islrWithholdingEnabled: fiscalRow['islr_withholding_enabled'] === 1,
        booksFormat: fiscalRow['books_format'] ?? 'xlsx',
        historicalOrdersTreatment:
          fiscalRow['historical_orders_treatment'] ?? 'revisar',
        printNotes: fiscalRow['print_notes'],
        digitalInvoicingEnabled:
          fiscalRow['digital_invoicing_enabled'] === 1,
        digitalInvoicingProvider:
          fiscalRow['digital_invoicing_provider'] ?? '',
        digitalInvoicingProviderTaxId:
          fiscalRow['digital_invoicing_provider_tax_id'] ?? '',
        digitalInvoicingApiUrl:
          fiscalRow['digital_invoicing_api_url'] ?? '',
        digitalInvoicingEnvironment:
          fiscalRow['digital_invoicing_environment'] ?? 'pruebas',
        digitalInvoicingCertificateLabel:
          fiscalRow['digital_invoicing_certificate_label'] ?? '',
        digitalInvoicingCertificateExpiry:
          fiscalRow['digital_invoicing_certificate_expiry'] ?? '',
        digitalInvoicingStartDate:
          fiscalRow['digital_invoicing_start_date'] ?? '',
        digitalInvoicingNotes:
          fiscalRow['digital_invoicing_notes'] ?? '',
      }
    : ({} as FiscalSettings);

  const fiscalObligations = (
    db.prepare('SELECT * FROM fiscal_obligations ORDER BY rowid').all() as Row[]
  ).map(
    (r): FiscalObligationRecord => ({
      key: r['obligation_key'],
      title: r['title'],
      applicability: r['applicability'],
      normativeReference: r['normative_reference'],
      reviewedAt: r['reviewed_at'],
      notes: r['notes'],
      updatedAt: r['updated_at'],
      updatedBy: r['updated_by'],
      updatedByRole: r['updated_by_role'],
    })
  );
  const fiscalObligationHistory = (
    db
      .prepare('SELECT * FROM fiscal_obligation_history ORDER BY changed_at DESC, rowid DESC')
      .all() as Row[]
  ).map(
    (r): FiscalObligationHistoryEntry => ({
      id: r['id'],
      obligationKey: r['obligation_key'],
      obligationTitle: r['obligation_title'],
      previous: JSON.parse(r['previous_json']),
      current: JSON.parse(r['current_json']),
      changedAt: r['changed_at'],
      userId: r['user_id'],
      userName: r['user_name'],
      userRole: r['user_role'],
    })
  );

  const fiscalReferenceValues = (
    db
      .prepare('SELECT * FROM fiscal_reference_values ORDER BY effective_from DESC, rowid DESC')
      .all() as Row[]
  ).map(
    (r): FiscalReferenceValue => ({
      id: r['id'],
      kind: r['kind'],
      value: r['value'],
      valueUnit: r['value_unit'],
      effectiveFrom: r['effective_from'],
      effectiveTo: r['effective_to'] ?? '',
      instrumentType: r['instrument_type'] ?? '',
      instrumentNumber: r['instrument_number'] ?? '',
      officialGazette: r['official_gazette'] ?? '',
      publicationDate: r['publication_date'] ?? '',
      legalBasis: r['legal_basis'] ?? '',
      notes: r['notes'] ?? '',
      status: r['status'] ?? 'referencia',
      confirmedByAccountant: r['confirmed_by_accountant'] === 1,
      supportDocument: r['support_document'] ?? '',
      createdAt: r['created_at'],
      createdBy: r['created_by'],
      updatedAt: r['updated_at'],
      annulledAt: r['annulled_at'] ?? '',
      annulledReason: r['annulled_reason'] ?? '',
      annulledBy: r['annulled_by'] ?? '',
    })
  );

  const bookSettingsRow = db
    .prepare('SELECT * FROM accounting_book_settings WHERE id = 1')
    .get() as Row | undefined;
  const accountingBookSettings: AccountingBookSettings = bookSettingsRow
    ? {
        id: 1,
        approvedFormats: bookSettingsRow['approved_formats'] ?? 'xlsx,pdf',
        auxiliaryFormat: bookSettingsRow['auxiliary_format'] ?? 'csv',
        pagination: bookSettingsRow['pagination'] ?? '',
        signatureText: bookSettingsRow['signature_text'] ?? '',
        signatureRole: bookSettingsRow['signature_role'] ?? '',
        exchangeRatePolicy:
          bookSettingsRow['exchange_rate_policy'] ?? 'documento_con_fallback',
        notes: bookSettingsRow['notes'] ?? '',
        approvedAt: bookSettingsRow['approved_at'] ?? '',
        updatedAt: bookSettingsRow['updated_at'] ?? '',
        updatedBy: bookSettingsRow['updated_by'] ?? '',
      }
    : {
        id: 1,
        approvedFormats: 'xlsx,pdf',
        auxiliaryFormat: 'csv',
        pagination: '',
        signatureText: '',
        signatureRole: '',
        exchangeRatePolicy: 'documento_con_fallback',
        notes: '',
        approvedAt: '',
        updatedAt: '',
        updatedBy: '',
      };

  const fiscalInvoices = (
    db
      .prepare('SELECT * FROM fiscal_invoices ORDER BY issued_at DESC')
      .all() as Row[]
  ).map(
    (r): FiscalInvoice => ({
      id: r['id'],
      serie: r['serie'],
      invoiceNumber: r['invoice_number'],
      controlNumber: r['control_number'],
      saleCondition: r['sale_condition'] ?? 'contado',
      paymentMethod: r['payment_method'] ?? 'efectivo_bs',
      creditDays: r['credit_days'] ?? 0,
      salesOrderId: o(r['sales_order_id']),
      salesOrderNumber: o(r['sales_order_number']),
      emitterSnapshot: JSON.parse(r['emitter_snapshot']),
      customerSnapshot: JSON.parse(r['customer_snapshot']),
      items: JSON.parse(r['items_json']),
      subtotal: r['subtotal'],
      taxAmount: r['tax_amount'],
      total: r['total'],
      subtotalBs: o(r['subtotal_bs']),
      taxAmountBs: o(r['tax_amount_bs']),
      totalBs: o(r['total_bs']),
      exchangeRateUsed: r['exchange_rate_used'],
      status: r['status'],
      issuedAt: r['issued_at'],
      printCount: r['print_count'] ?? 0,
      annulledAt: o(r['annulled_at']),
      annulledBy: o(r['annulled_by']),
      annulmentReason: o(r['annulment_reason']),
      periodYear: r['period_year'],
      periodMonth: r['period_month'],
    })
  );

  const fiscalAdjustmentNotes = (
    db.prepare('SELECT * FROM fiscal_adjustment_notes ORDER BY issued_at DESC').all() as Row[]
  ).map(
    (r): FiscalAdjustmentNote => ({
      id: r['id'],
      type: r['note_type'],
      serie: r['serie'],
      noteNumber: r['note_number'],
      controlNumber: r['control_number'],
      fiscalInvoiceId: r['fiscal_invoice_id'],
      invoiceNumber: r['invoice_number'],
      invoiceControlNumber: r['invoice_control_number'],
      invoiceIssuedAt: r['invoice_issued_at'],
      emitterSnapshot: JSON.parse(r['emitter_snapshot']),
      customerSnapshot: JSON.parse(r['customer_snapshot']),
      reason: r['reason'],
      reasonDetails: o(r['reason_details']),
      items: JSON.parse(r['items_json']),
      subtotal: r['subtotal'],
      taxAmount: r['tax_amount'],
      total: r['total'],
      exchangeRateUsed: r['exchange_rate_used'],
      issuedAt: r['issued_at'],
      issuedBy: r['issued_by'],
      printCount: r['print_count'] ?? 0,
      periodYear: r['period_year'],
      periodMonth: r['period_month'],
    })
  );

  const fiscalPeriodClosures = (
    db.prepare('SELECT * FROM fiscal_period_closures ORDER BY year DESC, month DESC').all() as Row[]
  ).map(
    (r): FiscalPeriodClosure => ({
      year: r['year'],
      month: r['month'],
      closedAt: r['closed_at'],
      closedBy: r['closed_by'],
      snapshotHash: r['snapshot_hash'],
      salesTotal: r['sales_total'],
      purchaseTotal: r['purchase_total'],
    })
  );

  const ratesRow = db
    .prepare('SELECT * FROM exchange_rates WHERE id = 1')
    .get() as Row | undefined;
  const history = (
    db.prepare('SELECT * FROM exchange_rate_history ORDER BY rowid').all() as Row[]
  ).map((r) => ({
    id: r['id'],
    date: r['rate_date'],
    time: r['rate_time'],
    usdRate: r['usd_rate'],
    usdtRate: r['usdt_rate'],
    source: r['source'],
    window: r['rate_window'],
    variationUsdPercent: o(r['variation_usd_percent']),
    variationUsdtPercent: o(r['variation_usdt_percent']),
    notes: o(r['notes']),
  }));
  const exchangeRates: DailyExchangeRates = ratesRow
    ? {
        currentUsd: ratesRow['current_usd'],
        currentUsdt: ratesRow['current_usdt'],
        lastUpdated: ratesRow['last_updated'],
        isInActiveWindow: ratesRow['is_in_active_window'] === 1,
        activeWindowName: ratesRow['active_window_name'],
        nextScheduledCheck: ratesRow['next_scheduled_check'],
        history,
      }
    : ({ history } as DailyExchangeRates);

  const auditLogs = (
    db.prepare('SELECT * FROM audit_logs ORDER BY rowid').all() as Row[]
  ).map(
    (r): AuditLogEntry => ({
      id: r['id'],
      timestamp: r['logged_at'],
      module: r['audit_module'],
      actionType: r['action_type'],
      title: r['title'],
      description: r['description'],
      userId: r['user_id'],
      userName: r['user_name'],
      userRole: r['user_role'],
      severity: r['severity'],
      details: r['details_json'] ? JSON.parse(r['details_json']) : undefined,
    })
  );

  const accounts = (
    db.prepare('SELECT * FROM accounts ORDER BY level, code').all() as Row[]
  ).map(
    (r): Account => ({
      id: r['id'],
      code: r['code'],
      name: r['name'],
      type: r['type'],
      nature: r['nature'],
      parentCode: o(r['parent_code']),
      level: r['level'],
      active: r['active'] === 1,
      isSystem: r['is_system'] === 1,
      description: o(r['description']),
      createdAt: r['created_at'],
      updatedAt: r['updated_at'],
    })
  );

  const accountingPeriods = (
    db.prepare('SELECT * FROM accounting_periods ORDER BY key').all() as Row[]
  ).map(
    (r): AccountingPeriod => ({
      id: r['id'],
      key: r['key'],
      startDate: r['start_date'],
      endDate: r['end_date'],
      status: r['status'],
      closedAt: o(r['closed_at']),
      closedBy: o(r['closed_by']),
    })
  );

  const accountingEntries = (
    db.prepare('SELECT * FROM accounting_entries ORDER BY entry_date, entry_number').all() as Row[]
  ).map(
    (r): AccountingEntry => {
      const lines = (
        db
          .prepare('SELECT * FROM accounting_entry_lines WHERE entry_id = ? ORDER BY line_order')
          .all(r['id']) as Row[]
      ).map(
        (l): AccountingEntryLine => ({
          id: l['id'],
          accountId: l['account_id'],
          accountCode: l['account_code'],
          accountName: l['account_name'],
          debit: l['debit'],
          credit: l['credit'],
          memo: o(l['memo']),
        })
      );
      return {
        id: r['id'],
        entryNumber: r['entry_number'],
        date: r['entry_date'],
        description: r['description'],
        sourceType: r['source_type'],
        sourceId: o(r['source_id']),
        status: r['status'],
        lines,
        totalDebit: r['total_debit'],
        totalCredit: r['total_credit'],
        currency: r['currency'],
        exchangeRateUsed: r['exchange_rate_used'],
        periodKey: r['period_key'],
        createdBy: r['created_by'],
        createdAt: r['created_at'],
        updatedAt: r['updated_at'],
        confirmedAt: o(r['confirmed_at']),
        annulledAt: o(r['annulled_at']),
        annulmentReason: o(r['annulment_reason']),
      };
    }
  );

  return {
    rawMaterials,
    inventoryMovements,
    finishedGoods,
    recipes,
    productionOrders,
    customers,
    salesOrders,
    supplierTypes,
    materialCategories,
    suppliers,
    supplierPrices,
    deliveryNotes,
    employees,
    payrollWeeks,
    expenses,
    expenseCategories,
    payables,
    payablePayments,
    accounts,
    accountingEntries,
    accountingPeriods,
    fiscalSettings,
    fiscalObligations,
    fiscalObligationHistory,
    fiscalReferenceValues,
    accountingBookSettings,
    fiscalInvoices,
    fiscalAdjustmentNotes,
    fiscalPeriodClosures,
    exchangeRates,
    auditLogs,
  };
}

/** Replace the whole normalized schema with the given state in one transaction. */
export function saveRelationalState(state: DatabaseState): void {
  const db = getDb();

  const replace = db.transaction((snapshot: DatabaseState) => {
    // Delete children first to keep referential integrity.
    db.exec(`
      DELETE FROM recipe_items;
      DELETE FROM production_order_materials;
      DELETE FROM sales_order_items;
      DELETE FROM delivery_note_items;
      DELETE FROM payroll_payments;
      DELETE FROM audit_logs;
      DELETE FROM exchange_rate_history;
      DELETE FROM exchange_rates;
      DELETE FROM fiscal_adjustment_notes;
      DELETE FROM fiscal_period_closures;
      DELETE FROM fiscal_obligation_history;
      DELETE FROM fiscal_obligations;
      DELETE FROM fiscal_reference_values;
      DELETE FROM accounting_book_settings;
      DELETE FROM fiscal_invoices;
      DELETE FROM fiscal_settings;
      DELETE FROM expense_categories;
      DELETE FROM accounting_entry_lines;
      DELETE FROM accounting_entries;
      DELETE FROM accounting_periods;
      DELETE FROM accounts;
      DELETE FROM payable_payments;
      DELETE FROM payables;
      DELETE FROM expenses;
      DELETE FROM payroll_weeks;
      DELETE FROM employees;
      DELETE FROM delivery_notes;
      DELETE FROM sales_orders;
      DELETE FROM customers;
      DELETE FROM supplier_prices;
      DELETE FROM suppliers;
      DELETE FROM material_categories;
      DELETE FROM supplier_types;
      DELETE FROM production_orders;
      DELETE FROM recipes;
      DELETE FROM finished_goods;
      DELETE FROM inventory_movements;
      DELETE FROM raw_materials;
    `);

    const insertRawMaterial = db.prepare(`
      INSERT INTO raw_materials (
        id, code, name, category, current_stock, min_stock, unit,
        cost_per_unit, supplier, last_restock_date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of snapshot.rawMaterials) {
      insertRawMaterial.run(
        m.id,
        m.code,
        m.name,
        m.category,
        m.currentStock,
        m.minStock,
        m.unit,
        m.costPerUnit,
        v(m.supplier),
        m.lastRestockDate,
        v(m.notes)
      );
    }

    const insertMovement = db.prepare(`
      INSERT INTO inventory_movements (
        id, material_id, material_name, type, quantity, cost_per_unit,
        total_cost, exchange_rate_used, cost_per_unit_bs, total_cost_bs,
        reference_doc, supplier_id, supplier_name_snapshot, supplier_tax_id_snapshot,
        notes, movement_date, performed_by, payment_condition, payment_method,
        bank_code, bank_name, payment_reference, credit_days, due_date,
        payable_id, payable_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const m of snapshot.inventoryMovements) {
      insertMovement.run(
        m.id,
        m.materialId,
        m.materialName,
        m.type,
        m.quantity,
        m.costPerUnit,
        m.totalCost,
        m.exchangeRateUsed,
        v(m.costPerUnitBs),
        v(m.totalCostBs),
        v(m.referenceDoc),
        v(m.supplierId),
        v(m.supplierNameSnapshot),
        v(m.supplierTaxIdSnapshot),
        v(m.notes),
        m.date,
        m.performedBy,
        v(m.paymentCondition),
        v(m.paymentMethod),
        v(m.bankCode),
        v(m.bankName),
        v(m.paymentReference),
        v(m.creditDays),
        v(m.dueDate),
        v(m.payableId),
        v(m.payableNumber)
      );
    }

    const insertFinishedGood = db.prepare(`
      INSERT INTO finished_goods (
        id, code, flavor, presentation, presentation_label, weight_grams,
        stock_units, reserved_units, available_units, base_cost,
        suggested_wholesale_price, suggested_retail_price,
        suggested_special_price, min_stock
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const f of snapshot.finishedGoods) {
      insertFinishedGood.run(
        f.id,
        f.code,
        f.flavor,
        f.presentation,
        f.presentationLabel,
        f.weightGrams,
        f.stockUnits,
        f.reservedUnits,
        f.availableUnits,
        f.baseCost,
        f.suggestedWholesalePrice,
        f.suggestedRetailPrice,
        f.suggestedSpecialPrice,
        f.minStock
      );
    }

    const insertRecipe = db.prepare(`
      INSERT INTO recipes (
        id, code, name, flavor, presentation, batch_size_units,
        direct_labor_minutes, estimated_utility_cost, instructions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRecipeItem = db.prepare(`
      INSERT INTO recipe_items (
        recipe_id, material_id, material_name, quantity, unit, estimated_cost
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const recipe of snapshot.recipes) {
      insertRecipe.run(
        recipe.id,
        recipe.code,
        recipe.name,
        recipe.flavor,
        recipe.presentation,
        recipe.batchSizeUnits,
        recipe.directLaborMinutes,
        recipe.estimatedUtilityCost,
        v(recipe.instructions)
      );
      for (const item of recipe.items) {
        insertRecipeItem.run(
          recipe.id,
          item.materialId,
          item.materialName,
          item.quantity,
          item.unit,
          item.estimatedCost
        );
      }
    }

    const insertProductionOrder = db.prepare(`
      INSERT INTO production_orders (
        id, order_number, recipe_id, recipe_name, flavor, presentation,
        target_units, batch_count, lot_number, status, sales_order_id,
        customer_name, start_date, completion_date, created_at, production_date,
        exchange_rate_used, direct_material_cost, direct_labor_cost,
        indirect_cost, total_production_cost, total_cost, unit_cost,
        total_production_cost_bs, unit_cost_bs, operator_notes,
        mode, formulas_json, manual_sheet_json, commitment_reference,
        created_by, updated_by, processed_by, processed_at, annulled_by, annulled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertProductionMaterial = db.prepare(`
      INSERT INTO production_order_materials (
        order_id, material_id, material_name, quantity_consumed,
        unit, unit_cost, total_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const order of snapshot.productionOrders) {
      insertProductionOrder.run(
        order.id,
        order.orderNumber,
        order.recipeId,
        order.recipeName,
        order.flavor,
        order.presentation,
        order.targetUnits,
        order.batchCount,
        order.lotNumber,
        order.status,
        v(order.salesOrderId),
        v(order.customerName),
        order.startDate,
        v(order.completionDate),
        v(order.createdAt),
        v(order.productionDate),
        v(order.exchangeRateUsed),
        order.directMaterialCost,
        order.directLaborCost,
        order.indirectCost,
        order.totalProductionCost,
        v(order.totalCost),
        order.unitCost,
        v(order.totalProductionCostBs),
        v(order.unitCostBs),
        v(order.operatorNotes),
        order.mode || 'automatico',
        v(order.formulas ? JSON.stringify(order.formulas) : undefined),
        v(
          order.manualSheet ? JSON.stringify(order.manualSheet) : undefined
        ),
        v(order.commitmentReference),
        v(order.createdBy),
        v(order.updatedBy),
        v(order.processedBy),
        v(order.processedAt),
        v(order.annulledBy),
        v(order.annulledAt)
      );
      for (const item of order.consumedMaterials) {
        insertProductionMaterial.run(
          order.id,
          item.materialId,
          item.materialName,
          item.quantityConsumed,
          item.unit,
          item.unitCost,
          item.totalCost
        );
      }
    }

    const insertCustomer = db.prepare(`
      INSERT INTO customers (
        id, business_name, tax_id, nit, contact_person, phone, email,
        address, client_type, credit_limit, payment_terms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of snapshot.customers) {
      insertCustomer.run(
        c.id,
        c.businessName,
        c.taxId,
        v(c.nit),
        c.contactPerson,
        c.phone,
        c.email,
        c.address,
        c.clientType,
        c.creditLimit,
        c.paymentTerms
      );
    }

    const insertSalesOrder = db.prepare(`
      INSERT INTO sales_orders (
        id, order_number, customer_id, customer_name, customer_tax_id,
        customer_nit, sale_condition, payment_method, credit_days, order_date, delivery_date,
        status, exchange_rate_used, subtotal,
        tax_amount, total, subtotal_bs, tax_amount_bs, total_bs,
        has_delivery_note, delivery_note_number, production_order_id, notes,
        created_by, collection_json, collections_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSalesItem = db.prepare(`
      INSERT INTO sales_order_items (
        order_id, finished_good_id, flavor, presentation,
        presentation_label, quantity, unit_price, subtotal, unit_price_bs,
        subtotal_bs, price_tier, profit_margin_percent, base_cost,
        tax_category, tax_rate_percent, tax_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const order of snapshot.salesOrders) {
      insertSalesOrder.run(
        order.id,
        order.orderNumber,
        order.customerId,
        order.customerName,
        order.customerTaxId,
        v(order.customerNit),
        v(order.saleCondition),
        v(order.paymentMethod),
        v(order.creditDays),
        order.orderDate,
        order.deliveryDate,
        order.status,
        order.exchangeRateUsed,
        order.subtotal,
        order.taxAmount,
        order.total,
        v(order.subtotalBs),
        v(order.taxAmountBs),
        v(order.totalBs),
        b(order.hasDeliveryNote),
        v(order.deliveryNoteNumber),
        v(order.productionOrderId),
        v(order.notes),
        v(order.createdBy),
        v(order.collection ? JSON.stringify(order.collection) : undefined),
        v(order.collections?.length ? JSON.stringify(order.collections) : undefined)
      );
      for (const item of order.items) {
        insertSalesItem.run(
          order.id,
          item.finishedGoodId,
          item.flavor,
          item.presentation,
          item.presentationLabel,
          item.quantity,
          item.unitPrice,
          item.subtotal,
          v(item.unitPriceBs),
          v(item.subtotalBs),
          v(item.priceTier),
          v(item.profitMarginPercent),
          v(item.baseCost),
          v(item.taxCategory),
          v(item.taxRatePercent),
          v(item.taxAmount)
        );
      }
    }

    const insertDeliveryNote = db.prepare(`
      INSERT INTO delivery_notes (
        id, note_number, sales_order_id, sales_order_number, customer_name,
        customer_tax_id, customer_address, customer_phone, dispatch_date,
        exchange_rate_used, subtotal, tax_included, tax_amount, total,
        subtotal_bs, tax_amount_bs, total_bs, transporter, received_by_name,
        received_by_id, signature_date, status, observations
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertDeliveryItem = db.prepare(`
      INSERT INTO delivery_note_items (
        note_id, description, presentation_label, quantity, lot_number,
        unit_price, subtotal, unit_price_bs, subtotal_bs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const note of snapshot.deliveryNotes) {
      insertDeliveryNote.run(
        note.id,
        note.noteNumber,
        note.salesOrderId,
        note.salesOrderNumber,
        note.customerName,
        note.customerTaxId,
        note.customerAddress,
        note.customerPhone,
        note.dispatchDate,
        note.exchangeRateUsed,
        note.subtotal,
        b(note.taxIncluded),
        note.taxAmount,
        note.total,
        v(note.subtotalBs),
        v(note.taxAmountBs),
        v(note.totalBs),
        v(note.transporter),
        v(note.receivedByName),
        v(note.receivedById),
        v(note.signatureDate),
        note.status,
        v(note.observations)
      );
      for (const item of note.items) {
        insertDeliveryItem.run(
          note.id,
          item.description,
          item.presentationLabel,
          item.quantity,
          v(item.lotNumber),
          item.unitPrice,
          item.subtotal,
          v(item.unitPriceBs),
          v(item.subtotalBs)
        );
      }
    }

    const insertEmployee = db.prepare(`
      INSERT INTO employees (
        id, full_name, national_id, role_title, weekly_base_salary,
        hourly_rate, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of snapshot.employees) {
      insertEmployee.run(
        e.id,
        e.fullName,
        e.nationalId,
        e.roleTitle,
        e.weeklyBaseSalary,
        e.hourlyRate,
        e.status
      );
    }

    const insertPayrollWeek = db.prepare(`
      INSERT INTO payroll_weeks (
        id, week_number, year, start_date, end_date, is_active_production,
        inactivity_reason, total_payroll_paid, fixed_absorption_cost, notes,
        bonus_by_role_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPayrollPayment = db.prepare(`
      INSERT INTO payroll_payments (
        week_id, employee_id, employee_name, role_title, base_amount,
        production_bonus, deductions, net_paid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const week of snapshot.payrollWeeks) {
      insertPayrollWeek.run(
        week.id,
        week.weekNumber,
        week.year,
        week.startDate,
        week.endDate,
        b(week.isActiveProduction),
        v(week.inactivityReason),
        week.totalPayrollPaid,
        week.fixedAbsorptionCost,
        v(week.notes),
        v(week.bonusByRole ? JSON.stringify(week.bonusByRole) : undefined)
      );
      for (const payment of week.payments) {
        insertPayrollPayment.run(
          week.id,
          payment.employeeId,
          payment.employeeName,
          payment.roleTitle,
          payment.baseAmount,
          payment.productionBonus,
          payment.deductions,
          payment.netPaid
        );
      }
    }

    const insertExpense = db.prepare(`
      INSERT INTO expenses (
        id, expense_number, expense_date, concept, category, category_label,
        amount_usd, exchange_rate_used, amount_bs, supplier_or_beneficiary,
        supplier_id, tax_id, document_type, document_number, payment_method,
        payment_reference, issuing_bank_code, issuing_bank_name,
        notes, registered_by, tax_category,
        tax_rate_percent, tax_amount_usd, tax_amount_bs,
        accounting_account_code, accounting_account_name, fiscal_book_eligible, payable_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of snapshot.expenses) {
      insertExpense.run(
        e.id,
        e.expenseNumber,
        e.date,
        e.concept,
        e.category,
        e.categoryLabel,
        e.amountUsd,
        e.exchangeRateUsed,
        e.amountBs,
        e.supplierOrBeneficiary,
        v(e.supplierId),
        v(e.taxId),
        e.documentType,
        v(e.documentNumber),
        e.paymentMethod,
        v(e.paymentReference),
        v(e.issuingBankCode),
        v(e.issuingBankName),
        v(e.notes),
        e.registeredBy,
        e.taxCategory,
        v(e.taxRatePercent),
        v(e.taxAmountUsd),
        v(e.taxAmountBs),
        v(e.accountingAccountCode),
        v(e.accountingAccountName),
        b(e.fiscalBookEligible),
        v(e.payableId)
      );
    }

    const insertPayable = db.prepare(`
      INSERT INTO payables (
        id, payable_number, supplier_id, supplier_name, tax_id, invoice_number,
        control_number, issue_date, due_date, amount_usd, exchange_rate_used,
        amount_bs, tax_amount_usd, category, status, notes, created_by,
        created_at, updated_at, expense_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of snapshot.payables ?? []) {
      insertPayable.run(
        p.id,
        p.payableNumber,
        v(p.supplierId),
        p.supplierName,
        v(p.taxId),
        p.invoiceNumber,
        v(p.controlNumber),
        p.issueDate,
        p.dueDate,
        p.amountUsd,
        p.exchangeRateUsed,
        p.amountBs,
        v(p.taxAmountUsd),
        p.category,
        p.status,
        v(p.notes),
        v(p.createdBy),
        p.createdAt ?? new Date().toISOString(),
        p.updatedAt ?? new Date().toISOString(),
        v(p.expenseId)
      );
    }

    const insertPayablePayment = db.prepare(`
      INSERT INTO payable_payments (
        id, payable_id, bank_code, bank_name, payment_method, reference,
        amount_usd, amount_bs, exchange_rate_used, paid_at, paid_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const payment of snapshot.payablePayments ?? []) {
      insertPayablePayment.run(
        payment.id,
        payment.payableId,
        payment.bankCode,
        payment.bankName,
        payment.paymentMethod,
        payment.reference,
        payment.amountUsd,
        payment.amountBs,
        payment.exchangeRateUsed,
        payment.paidAt,
        payment.paidBy
      );
    }

    const insertAccount = db.prepare(`
      INSERT INTO accounts (
        id, code, name, type, nature, parent_code, level, active, is_system,
        description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const account of snapshot.accounts ?? []) {
      insertAccount.run(
        account.id,
        account.code,
        account.name,
        account.type,
        account.nature,
        v(account.parentCode),
        account.level,
        b(account.active),
        b(account.isSystem),
        v(account.description),
        account.createdAt,
        account.updatedAt
      );
    }

    const insertAccountingPeriod = db.prepare(`
      INSERT INTO accounting_periods (
        id, key, start_date, end_date, status, closed_at, closed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const period of snapshot.accountingPeriods ?? []) {
      insertAccountingPeriod.run(
        period.id,
        period.key,
        period.startDate,
        period.endDate,
        period.status,
        v(period.closedAt),
        v(period.closedBy)
      );
    }

    const insertAccountingEntry = db.prepare(`
      INSERT INTO accounting_entries (
        id, entry_number, entry_date, description, source_type, source_id,
        status, total_debit, total_credit, currency, exchange_rate_used,
        period_key, created_by, created_at, updated_at, confirmed_at,
        annulled_at, annulment_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAccountingLine = db.prepare(`
      INSERT INTO accounting_entry_lines (
        id, entry_id, account_id, account_code, account_name, debit, credit,
        memo, line_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const entry of snapshot.accountingEntries ?? []) {
      insertAccountingEntry.run(
        entry.id,
        entry.entryNumber,
        entry.date,
        entry.description,
        entry.sourceType,
        v(entry.sourceId),
        entry.status,
        entry.totalDebit,
        entry.totalCredit,
        entry.currency,
        entry.exchangeRateUsed,
        entry.periodKey,
        entry.createdBy,
        entry.createdAt,
        entry.updatedAt,
        v(entry.confirmedAt),
        v(entry.annulledAt),
        v(entry.annulmentReason)
      );
      entry.lines.forEach((line, index) => {
        insertAccountingLine.run(
          line.id,
          entry.id,
          line.accountId,
          line.accountCode,
          line.accountName,
          line.debit,
          line.credit,
          v(line.memo),
          index
        );
      });
    }

    const insertExpenseCategory = db.prepare(`
      INSERT INTO expense_categories (
        id, name, icon, color, monthly_budget_usd, accounting_account_code,
        accounting_account_name, default_tax_category, description, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of snapshot.expenseCategories) {
      insertExpenseCategory.run(
        c.id,
        c.name,
        c.icon,
        c.color,
        c.monthlyBudgetUsd,
        v(c.accountingAccountCode),
        v(c.accountingAccountName),
        v(c.defaultTaxCategory),
        v(c.description),
        c.isSystem === undefined ? null : b(c.isSystem)
      );
    }

    db.prepare(`
      INSERT INTO fiscal_settings (
        id, enabled, company_name, company_tax_id, fiscal_address,
        company_phone, company_email, economic_activity, tax_regime,
        tax_rate_percent, invoice_prefix, invoice_serie, next_invoice_number,
        control_prefix, next_control_number, authorization_code,
        next_credit_note_number, next_debit_note_number,
        authorization_valid_until, branch_name, branch_address,
        vat_withholding_agent, vat_withholding_percent,
        islr_withholding_agent, islr_withholding_percent, special_taxpayer,
        accounting_enabled, vat_withholding_enabled, islr_withholding_enabled,
        books_format, historical_orders_treatment, print_notes,
        digital_invoicing_enabled, digital_invoicing_provider,
        digital_invoicing_provider_tax_id, digital_invoicing_api_url,
        digital_invoicing_environment, digital_invoicing_certificate_label,
        digital_invoicing_certificate_expiry, digital_invoicing_start_date,
        digital_invoicing_notes
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b(snapshot.fiscalSettings.enabled),
      snapshot.fiscalSettings.companyName,
      snapshot.fiscalSettings.companyTaxId,
      snapshot.fiscalSettings.fiscalAddress,
      snapshot.fiscalSettings.companyPhone,
      snapshot.fiscalSettings.companyEmail,
      snapshot.fiscalSettings.economicActivity,
      snapshot.fiscalSettings.taxRegime,
      snapshot.fiscalSettings.taxRatePercent,
      snapshot.fiscalSettings.invoicePrefix,
      snapshot.fiscalSettings.invoiceSerie,
      snapshot.fiscalSettings.nextInvoiceNumber,
      snapshot.fiscalSettings.controlPrefix,
      snapshot.fiscalSettings.nextControlNumber,
      snapshot.fiscalSettings.authorizationCode,
      snapshot.fiscalSettings.nextCreditNoteNumber ?? 1,
      snapshot.fiscalSettings.nextDebitNoteNumber ?? 1,
      snapshot.fiscalSettings.authorizationValidUntil,
      snapshot.fiscalSettings.branchName,
      snapshot.fiscalSettings.branchAddress,
      b(snapshot.fiscalSettings.vatWithholdingAgent),
      snapshot.fiscalSettings.vatWithholdingPercent,
      b(snapshot.fiscalSettings.islrWithholdingAgent),
      snapshot.fiscalSettings.islrWithholdingPercent,
      b(snapshot.fiscalSettings.specialTaxpayer),
      b(snapshot.fiscalSettings.accountingEnabled ?? true),
      b(snapshot.fiscalSettings.vatWithholdingEnabled ?? false),
      b(snapshot.fiscalSettings.islrWithholdingEnabled ?? false),
      snapshot.fiscalSettings.booksFormat,
      snapshot.fiscalSettings.historicalOrdersTreatment,
      snapshot.fiscalSettings.printNotes,
      b(snapshot.fiscalSettings.digitalInvoicingEnabled ?? false),
      snapshot.fiscalSettings.digitalInvoicingProvider ?? '',
      snapshot.fiscalSettings.digitalInvoicingProviderTaxId ?? '',
      snapshot.fiscalSettings.digitalInvoicingApiUrl ?? '',
      snapshot.fiscalSettings.digitalInvoicingEnvironment ?? 'pruebas',
      snapshot.fiscalSettings.digitalInvoicingCertificateLabel ?? '',
      snapshot.fiscalSettings.digitalInvoicingCertificateExpiry ?? '',
      snapshot.fiscalSettings.digitalInvoicingStartDate ?? '',
      snapshot.fiscalSettings.digitalInvoicingNotes ?? ''
    );

    const insertFiscalObligation = db.prepare(`
      INSERT INTO fiscal_obligations (
        obligation_key, title, applicability, normative_reference, reviewed_at,
        notes, updated_at, updated_by, updated_by_role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const obligation of snapshot.fiscalObligations || []) {
      insertFiscalObligation.run(
        obligation.key,
        obligation.title,
        obligation.applicability,
        obligation.normativeReference,
        obligation.reviewedAt,
        obligation.notes,
        obligation.updatedAt,
        obligation.updatedBy,
        obligation.updatedByRole
      );
    }

    const insertFiscalObligationHistory = db.prepare(`
      INSERT INTO fiscal_obligation_history (
        id, obligation_key, obligation_title, previous_json, current_json,
        changed_at, user_id, user_name, user_role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const entry of snapshot.fiscalObligationHistory || []) {
      insertFiscalObligationHistory.run(
        entry.id,
        entry.obligationKey,
        entry.obligationTitle,
        JSON.stringify(entry.previous),
        JSON.stringify(entry.current),
        entry.changedAt,
        entry.userId,
        entry.userName,
        entry.userRole
      );
    }

    const insertFiscalReferenceValue = db.prepare(`
      INSERT INTO fiscal_reference_values (
        id, kind, value, value_unit, effective_from, effective_to,
        instrument_type, instrument_number, official_gazette, publication_date,
        legal_basis, notes, status, confirmed_by_accountant, support_document,
        created_at, created_by, updated_at, annulled_at, annulled_reason, annulled_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of snapshot.fiscalReferenceValues || []) {
      insertFiscalReferenceValue.run(
        item.id,
        item.kind,
        item.value,
        item.valueUnit,
        item.effectiveFrom,
        item.effectiveTo ?? '',
        item.instrumentType ?? '',
        item.instrumentNumber ?? '',
        item.officialGazette ?? '',
        item.publicationDate ?? '',
        item.legalBasis ?? '',
        item.notes ?? '',
        item.status ?? 'referencia',
        b(item.confirmedByAccountant),
        item.supportDocument ?? '',
        item.createdAt,
        item.createdBy,
        item.updatedAt,
        item.annulledAt ?? '',
        item.annulledReason ?? '',
        item.annulledBy ?? ''
      );
    }

    const bookSettings = snapshot.accountingBookSettings ?? {
      id: 1,
      approvedFormats: 'xlsx,pdf',
      auxiliaryFormat: 'csv',
      pagination: '',
      signatureText: '',
      signatureRole: '',
      exchangeRatePolicy: 'documento_con_fallback',
      notes: '',
      approvedAt: '',
      updatedAt: new Date().toISOString(),
      updatedBy: 'sistema',
    };
    db.prepare(`
      INSERT INTO accounting_book_settings (
        id, approved_formats, auxiliary_format, pagination, signature_text,
        signature_role, exchange_rate_policy, notes, approved_at, updated_at, updated_by
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      bookSettings.approvedFormats ?? 'xlsx,pdf',
      bookSettings.auxiliaryFormat ?? 'csv',
      bookSettings.pagination ?? '',
      bookSettings.signatureText ?? '',
      bookSettings.signatureRole ?? '',
      bookSettings.exchangeRatePolicy ?? 'documento_con_fallback',
      bookSettings.notes ?? '',
      bookSettings.approvedAt ?? '',
      bookSettings.updatedAt ?? new Date().toISOString(),
      bookSettings.updatedBy ?? 'sistema'
    );

    const insertFiscalInvoice = db.prepare(`
      INSERT INTO fiscal_invoices (
        id, serie, invoice_number, control_number, sales_order_id,
        sale_condition, payment_method, credit_days,
        sales_order_number, emitter_snapshot, customer_snapshot, items_json,
        subtotal, tax_amount, total, subtotal_bs, tax_amount_bs, total_bs,
        exchange_rate_used, status, issued_at, annulled_at, annulled_by,
        annulment_reason, print_count, period_year, period_month
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const invoice of snapshot.fiscalInvoices || []) {
      insertFiscalInvoice.run(
        invoice.id,
        invoice.serie,
        invoice.invoiceNumber,
        invoice.controlNumber,
        v(invoice.salesOrderId),
        invoice.saleCondition,
        invoice.paymentMethod,
        invoice.creditDays ?? 0,
        v(invoice.salesOrderNumber),
        JSON.stringify(invoice.emitterSnapshot),
        JSON.stringify(invoice.customerSnapshot),
        JSON.stringify(invoice.items),
        invoice.subtotal,
        invoice.taxAmount,
        invoice.total,
        v(invoice.subtotalBs),
        v(invoice.taxAmountBs),
        v(invoice.totalBs),
        invoice.exchangeRateUsed,
        invoice.status,
        invoice.issuedAt,
        v(invoice.annulledAt),
        v(invoice.annulledBy),
        v(invoice.annulmentReason),
        invoice.printCount ?? 0,
        invoice.periodYear,
        invoice.periodMonth
      );
    }

    const insertFiscalNote = db.prepare(`
      INSERT INTO fiscal_adjustment_notes (
        id, note_type, serie, note_number, control_number, fiscal_invoice_id,
        invoice_number, invoice_control_number, invoice_issued_at, emitter_snapshot,
        customer_snapshot,
        reason, reason_details, items_json, subtotal, tax_amount, total,
        exchange_rate_used, issued_at, issued_by, print_count, period_year, period_month
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const note of snapshot.fiscalAdjustmentNotes || []) {
      insertFiscalNote.run(
        note.id,
        note.type,
        note.serie,
        note.noteNumber,
        note.controlNumber,
        note.fiscalInvoiceId,
        note.invoiceNumber,
        note.invoiceControlNumber,
        note.invoiceIssuedAt,
        JSON.stringify(note.emitterSnapshot),
        JSON.stringify(note.customerSnapshot),
        note.reason,
        v(note.reasonDetails),
        JSON.stringify(note.items),
        note.subtotal,
        note.taxAmount,
        note.total,
        note.exchangeRateUsed,
        note.issuedAt,
        note.issuedBy,
        note.printCount,
        note.periodYear,
        note.periodMonth
      );
    }

    const insertFiscalClosure = db.prepare(`
      INSERT INTO fiscal_period_closures (
        year, month, closed_at, closed_by, snapshot_hash, sales_total, purchase_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const closure of snapshot.fiscalPeriodClosures || []) {
      insertFiscalClosure.run(
        closure.year,
        closure.month,
        closure.closedAt,
        closure.closedBy,
        closure.snapshotHash,
        closure.salesTotal,
        closure.purchaseTotal
      );
    }

    db.prepare(`
      INSERT INTO exchange_rates (
        id, current_usd, current_usdt, last_updated, is_in_active_window,
        active_window_name, next_scheduled_check
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.exchangeRates.currentUsd,
      snapshot.exchangeRates.currentUsdt,
      snapshot.exchangeRates.lastUpdated,
      b(snapshot.exchangeRates.isInActiveWindow),
      snapshot.exchangeRates.activeWindowName,
      snapshot.exchangeRates.nextScheduledCheck
    );

    const insertRate = db.prepare(`
      INSERT INTO exchange_rate_history (
        id, rate_date, rate_time, usd_rate, usdt_rate, source, rate_window,
        variation_usd_percent, variation_usdt_percent, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const rate of snapshot.exchangeRates.history) {
      insertRate.run(
        rate.id,
        rate.date,
        rate.time,
        rate.usdRate,
        rate.usdtRate,
        rate.source,
        rate.window,
        v(rate.variationUsdPercent),
        v(rate.variationUsdtPercent),
        v(rate.notes)
      );
    }

    const insertAuditLog = db.prepare(`
      INSERT INTO audit_logs (
        id, logged_at, audit_module, action_type, title, description,
        user_id, user_name, user_role, severity, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const log of snapshot.auditLogs) {
      insertAuditLog.run(
        log.id,
        log.timestamp,
        log.module,
        log.actionType,
        log.title,
        log.description,
        log.userId,
        log.userName,
        log.userRole,
        log.severity,
        log.details ? JSON.stringify(log.details) : null
      );
    }

    const insertSupplier = db.prepare(`
      INSERT INTO suppliers (
        id, code, business_name, tax_id, primary_contact, primary_phone,
        secondary_phone, email, fiscal_address, physical_address,
        supplier_type, payment_terms, status, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const supplier of snapshot.suppliers || []) {
      insertSupplier.run(
        supplier.id,
        supplier.code,
        supplier.businessName,
        supplier.taxId,
        supplier.primaryContact,
        supplier.primaryPhone,
        v(supplier.secondaryPhone),
        v(supplier.email),
        supplier.fiscalAddress,
        v(supplier.physicalAddress),
        supplier.supplierType,
        supplier.paymentTerms,
        supplier.status,
        v(supplier.notes),
        supplier.createdAt
      );
    }

    const insertSupplierType = db.prepare(`
      INSERT INTO supplier_types (
        id, code, label, description, color, active, is_system, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const type of snapshot.supplierTypes || []) {
      insertSupplierType.run(
        type.id,
        type.code,
        type.label,
        v(type.description),
        type.color || 'stone',
        b(type.active),
        b(type.isSystem),
        type.createdAt,
        type.updatedAt
      );
    }

    const insertMaterialCategory = db.prepare(`
      INSERT INTO material_categories (
        id, code, label, description, color, active, is_system, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const category of snapshot.materialCategories || []) {
      insertMaterialCategory.run(
        category.id,
        category.code,
        category.label,
        v(category.description),
        category.color || 'stone',
        b(category.active),
        b(category.isSystem),
        category.createdAt,
        category.updatedAt
      );
    }

    const insertSupplierPrice = db.prepare(`
      INSERT INTO supplier_prices (
        id, supplier_id, supplier_name, material_id, product_name, unit,
        price_usd, valid_from, valid_to, is_current, notes, created_at,
        created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const price of snapshot.supplierPrices || []) {
      insertSupplierPrice.run(
        price.id,
        price.supplierId,
        price.supplierName,
        v(price.materialId),
        price.productName,
        price.unit,
        price.priceUsd,
        price.validFrom,
        v(price.validTo),
        b(price.isCurrent),
        v(price.notes),
        price.createdAt,
        v(price.createdBy)
      );
    }
  });

  replace(state);
}
