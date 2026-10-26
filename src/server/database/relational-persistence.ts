import type { Database } from 'better-sqlite3';
import type { DatabaseState } from '../erp-database.js';
import {
  AuditLogEntry,
  Customer,
  DailyExchangeRates,
  DeliveryNote,
  Employee,
  Expense,
  ExpenseCategoryConfig,
  FiscalSettings,
  FinishedGood,
  InventoryMovement,
  PayrollWeek,
  ProductionOrder,
  RawMaterial,
  RecipeBOM,
  SalesOrder,
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
      date: r['movement_date'],
      performedBy: r['performed_by'],
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
    })
  );

  const customers = (
    db.prepare('SELECT * FROM customers ORDER BY rowid').all() as Row[]
  ).map(
    (r): Customer => ({
      id: r['id'],
      businessName: r['business_name'],
      taxId: r['tax_id'],
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
    (r): SalesOrder => ({
      id: r['id'],
      orderNumber: r['order_number'],
      customerId: r['customer_id'],
      customerName: r['customer_name'],
      customerTaxId: r['customer_tax_id'],
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
      taxId: o(r['tax_id']),
      documentType: r['document_type'],
      documentNumber: o(r['document_number']),
      paymentMethod: r['payment_method'],
      paymentReference: o(r['payment_reference']),
      notes: o(r['notes']),
      registeredBy: r['registered_by'],
      taxCategory: r['tax_category'],
      taxRatePercent: o(r['tax_rate_percent']),
      taxAmountUsd: o(r['tax_amount_usd']),
      taxAmountBs: o(r['tax_amount_bs']),
      accountingAccountCode: o(r['accounting_account_code']),
      accountingAccountName: o(r['accounting_account_name']),
      fiscalBookEligible: r['fiscal_book_eligible'] === 1,
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
        taxRatePercent: fiscalRow['tax_rate_percent'],
        invoicePrefix: fiscalRow['invoice_prefix'],
        nextInvoiceNumber: fiscalRow['next_invoice_number'],
        authorizationCode: fiscalRow['authorization_code'],
        printNotes: fiscalRow['print_notes'],
      }
    : ({} as FiscalSettings);

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

  return {
    rawMaterials,
    inventoryMovements,
    finishedGoods,
    recipes,
    productionOrders,
    customers,
    salesOrders,
    deliveryNotes,
    employees,
    payrollWeeks,
    expenses,
    expenseCategories,
    fiscalSettings,
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
      DELETE FROM fiscal_settings;
      DELETE FROM expense_categories;
      DELETE FROM expenses;
      DELETE FROM payroll_weeks;
      DELETE FROM employees;
      DELETE FROM delivery_notes;
      DELETE FROM sales_orders;
      DELETE FROM customers;
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
        reference_doc, movement_date, performed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        m.date,
        m.performedBy
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
        customer_name, start_date, completion_date, created_at,
        exchange_rate_used, direct_material_cost, direct_labor_cost,
        indirect_cost, total_production_cost, total_cost, unit_cost,
        total_production_cost_bs, unit_cost_bs, operator_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        v(order.exchangeRateUsed),
        order.directMaterialCost,
        order.directLaborCost,
        order.indirectCost,
        order.totalProductionCost,
        v(order.totalCost),
        order.unitCost,
        v(order.totalProductionCostBs),
        v(order.unitCostBs),
        v(order.operatorNotes)
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
        id, business_name, tax_id, contact_person, phone, email,
        address, client_type, credit_limit, payment_terms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of snapshot.customers) {
      insertCustomer.run(
        c.id,
        c.businessName,
        c.taxId,
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
        order_date, delivery_date, status, exchange_rate_used, subtotal,
        tax_amount, total, subtotal_bs, tax_amount_bs, total_bs,
        has_delivery_note, delivery_note_number, production_order_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSalesItem = db.prepare(`
      INSERT INTO sales_order_items (
        order_id, finished_good_id, flavor, presentation,
        presentation_label, quantity, unit_price, subtotal, unit_price_bs,
        subtotal_bs, price_tier, profit_margin_percent, base_cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const order of snapshot.salesOrders) {
      insertSalesOrder.run(
        order.id,
        order.orderNumber,
        order.customerId,
        order.customerName,
        order.customerTaxId,
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
        v(order.notes)
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
          v(item.baseCost)
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
        inactivity_reason, total_payroll_paid, fixed_absorption_cost, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        v(week.notes)
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
        tax_id, document_type, document_number, payment_method,
        payment_reference, notes, registered_by, tax_category,
        tax_rate_percent, tax_amount_usd, tax_amount_bs,
        accounting_account_code, accounting_account_name, fiscal_book_eligible
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        v(e.taxId),
        e.documentType,
        v(e.documentNumber),
        e.paymentMethod,
        v(e.paymentReference),
        v(e.notes),
        e.registeredBy,
        e.taxCategory,
        v(e.taxRatePercent),
        v(e.taxAmountUsd),
        v(e.taxAmountBs),
        v(e.accountingAccountCode),
        v(e.accountingAccountName),
        b(e.fiscalBookEligible)
      );
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
        tax_rate_percent, invoice_prefix, next_invoice_number,
        authorization_code, print_notes
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b(snapshot.fiscalSettings.enabled),
      snapshot.fiscalSettings.companyName,
      snapshot.fiscalSettings.companyTaxId,
      snapshot.fiscalSettings.fiscalAddress,
      snapshot.fiscalSettings.taxRatePercent,
      snapshot.fiscalSettings.invoicePrefix,
      snapshot.fiscalSettings.nextInvoiceNumber,
      snapshot.fiscalSettings.authorizationCode,
      snapshot.fiscalSettings.printNotes
    );

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
  });

  replace(state);
}
