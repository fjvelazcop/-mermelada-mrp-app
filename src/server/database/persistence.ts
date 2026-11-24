import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import type { DatabaseState } from '../erp-database.js';
import {
  DEFAULT_MATERIAL_CATEGORIES,
  DEFAULT_PRESENTATION_TYPES,
  DEFAULT_SUPPLIER_TYPES,
} from '../../app/core/models/erp.models.js';

// `better-sqlite3` is a native CommonJS addon that resolves its binding with
// `__dirname`. The Angular dev server (Vite) bundles SSR dependencies as ESM,
// where `__dirname` is undefined, so requiring it through `createRequire`
// keeps the real CommonJS module working in development as well.
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;
type SqliteDatabase = BetterSqlite3.Database;

/**
 * Persistence layer for the ERP.
 *
 * The database uses a normalized relational schema (one table per entity plus
 * child tables for BOM items, order lines, payroll payments, etc.). The legacy
 * `app_state` JSON table is kept for backwards compatibility and one-time
 * migration of databases created before the relational schema existed.
 *
 * It provides:
 *  - a real on-disk database (SQLite),
 *  - simple schema migrations,
 *  - safe load/save helpers,
 *  - a stable place to grow the data model.
 *
 * Environment variables:
 *  - `DB_PATH` (optional): absolute or relative path to the SQLite file.
 *    Defaults to `<cwd>/data/mermelada.db`.
 */

const DEFAULT_DB_PATH = join(process.cwd(), 'data', 'mermelada.db');
let dbPath = process.env['DB_PATH'] || DEFAULT_DB_PATH;

let connection: SqliteDatabase | null = null;

/** Get (and lazily initialise) the SQLite connection. */
export function getDb(): SqliteDatabase {
  if (!connection) {
    mkdirSync(dirname(dbPath), { recursive: true });
    connection = new Database(dbPath);
    connection.pragma('journal_mode = WAL');
    connection.pragma('foreign_keys = ON');
    migrate(connection);
  }
  return connection;
}

/**
 * Point the persistence layer at another database file.
 * Intended for tests and tooling; closes any open connection first.
 */
export function setDbPath(path: string): void {
  closeDb();
  dbPath = path;
}

/** Add a column only when the table does not already have it. */
function ensureColumn(
  db: SqliteDatabase,
  table: string,
  column: string,
  definition: string
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Run schema migrations. */
function migrate(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- ==========================================================
    -- Normalized relational schema (migration v2)
    -- ==========================================================

    CREATE TABLE IF NOT EXISTS raw_materials (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      current_stock REAL NOT NULL,
      min_stock REAL NOT NULL,
      unit TEXT NOT NULL,
      cost_per_unit REAL NOT NULL,
      supplier TEXT,
      supplier_id TEXT,
      supplier_tax_id TEXT,
      payment_condition TEXT,
      credit_days INTEGER,
      payment_due_date TEXT,
      last_restock_date TEXT NOT NULL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      material_id TEXT NOT NULL,
      material_name TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      cost_per_unit REAL NOT NULL,
      total_cost REAL NOT NULL,
      exchange_rate_used REAL NOT NULL,
      cost_per_unit_bs REAL,
      total_cost_bs REAL,
      reference_doc TEXT,
      supplier_id TEXT,
      supplier_name_snapshot TEXT,
      supplier_tax_id_snapshot TEXT,
      movement_date TEXT NOT NULL,
      performed_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS finished_goods (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      flavor TEXT NOT NULL,
      presentation TEXT NOT NULL,
      presentation_label TEXT NOT NULL,
      weight_grams INTEGER NOT NULL,
      stock_units INTEGER NOT NULL,
      reserved_units INTEGER NOT NULL,
      available_units INTEGER NOT NULL,
      base_cost REAL NOT NULL,
      suggested_wholesale_price REAL NOT NULL,
      suggested_retail_price REAL NOT NULL,
      suggested_special_price REAL NOT NULL,
      min_stock INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      flavor TEXT NOT NULL,
      presentation TEXT NOT NULL,
      batch_size_units INTEGER NOT NULL,
      direct_labor_minutes INTEGER NOT NULL,
      estimated_utility_cost REAL NOT NULL,
      instructions TEXT,
      presentation_label TEXT,
      weight_grams REAL
    );

    CREATE TABLE IF NOT EXISTS recipe_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      material_id TEXT NOT NULL,
      material_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      estimated_cost REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL,
      recipe_id TEXT NOT NULL,
      recipe_name TEXT NOT NULL,
      flavor TEXT NOT NULL,
      presentation TEXT NOT NULL,
      target_units INTEGER NOT NULL,
      batch_count INTEGER NOT NULL,
      lot_number TEXT NOT NULL,
      status TEXT NOT NULL,
      sales_order_id TEXT,
      customer_name TEXT,
      start_date TEXT NOT NULL,
      completion_date TEXT,
      created_at TEXT,
      production_date TEXT,
      exchange_rate_used REAL,
      direct_material_cost REAL NOT NULL,
      direct_labor_cost REAL NOT NULL,
      indirect_cost REAL NOT NULL,
      total_production_cost REAL NOT NULL,
      total_cost REAL,
      unit_cost REAL NOT NULL,
      total_production_cost_bs REAL,
      unit_cost_bs REAL,
      operator_notes TEXT,
      mode TEXT NOT NULL DEFAULT 'automatico',
      formulas_json TEXT,
      manual_sheet_json TEXT,
      commitment_reference TEXT,
      created_by TEXT,
      updated_by TEXT,
      processed_by TEXT,
      processed_at TEXT,
      annulled_by TEXT,
      annulled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS production_order_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
      material_id TEXT NOT NULL,
      material_name TEXT NOT NULL,
      quantity_consumed REAL NOT NULL,
      unit TEXT NOT NULL,
      unit_cost REAL NOT NULL,
      total_cost REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      business_name TEXT NOT NULL,
      tax_id TEXT NOT NULL,
      nit TEXT,
      contact_person TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      address TEXT NOT NULL,
      client_type TEXT NOT NULL,
      credit_limit REAL NOT NULL,
      payment_terms TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_tax_id TEXT NOT NULL,
      customer_nit TEXT,
      sale_condition TEXT,
      payment_method TEXT,
      credit_days INTEGER,
      order_date TEXT NOT NULL,
      delivery_date TEXT NOT NULL,
      status TEXT NOT NULL,
      exchange_rate_used REAL NOT NULL,
      subtotal REAL NOT NULL,
      tax_amount REAL NOT NULL,
      total REAL NOT NULL,
      subtotal_bs REAL,
      tax_amount_bs REAL,
      total_bs REAL,
      has_delivery_note INTEGER NOT NULL,
      delivery_note_number TEXT,
      production_order_id TEXT,
      notes TEXT,
      created_by TEXT,
      collection_json TEXT
    );

    CREATE TABLE IF NOT EXISTS sales_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
      finished_good_id TEXT NOT NULL,
      flavor TEXT NOT NULL,
      presentation TEXT NOT NULL,
      presentation_label TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      unit_price_bs REAL,
      subtotal_bs REAL,
      price_tier TEXT,
      profit_margin_percent REAL,
      base_cost REAL,
      tax_category TEXT,
      tax_rate_percent REAL,
      tax_amount REAL
    );

    CREATE TABLE IF NOT EXISTS delivery_notes (
      id TEXT PRIMARY KEY,
      note_number TEXT NOT NULL,
      sales_order_id TEXT NOT NULL,
      sales_order_number TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_tax_id TEXT NOT NULL,
      customer_address TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      dispatch_date TEXT NOT NULL,
      exchange_rate_used REAL NOT NULL,
      subtotal REAL NOT NULL,
      tax_included INTEGER NOT NULL,
      tax_amount REAL NOT NULL,
      total REAL NOT NULL,
      subtotal_bs REAL,
      tax_amount_bs REAL,
      total_bs REAL,
      transporter TEXT,
      received_by_name TEXT,
      received_by_id TEXT,
      signature_date TEXT,
      status TEXT NOT NULL,
      observations TEXT
    );

    CREATE TABLE IF NOT EXISTS delivery_note_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id TEXT NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      presentation_label TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      lot_number TEXT,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      unit_price_bs REAL,
      subtotal_bs REAL
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      national_id TEXT NOT NULL,
      role_title TEXT NOT NULL,
      weekly_base_salary REAL NOT NULL,
      hourly_rate REAL NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payroll_weeks (
      id TEXT PRIMARY KEY,
      week_number INTEGER NOT NULL,
      year INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      is_active_production INTEGER NOT NULL,
      inactivity_reason TEXT,
      total_payroll_paid REAL NOT NULL,
      fixed_absorption_cost REAL NOT NULL,
      notes TEXT,
      bonus_by_role_json TEXT
    );

    CREATE TABLE IF NOT EXISTS payroll_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id TEXT NOT NULL REFERENCES payroll_weeks(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      role_title TEXT NOT NULL,
      base_amount REAL NOT NULL,
      production_bonus REAL NOT NULL,
      deductions REAL NOT NULL,
      net_paid REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      expense_number TEXT NOT NULL,
      expense_date TEXT NOT NULL,
      concept TEXT NOT NULL,
      category TEXT NOT NULL,
      category_label TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      exchange_rate_used REAL NOT NULL,
      amount_bs REAL NOT NULL,
      supplier_or_beneficiary TEXT NOT NULL,
      supplier_id TEXT,
      tax_id TEXT,
      document_type TEXT NOT NULL,
      document_number TEXT,
      payment_method TEXT NOT NULL,
      payment_reference TEXT,
      issuing_bank_code TEXT,
      issuing_bank_name TEXT,
      notes TEXT,
      registered_by TEXT NOT NULL,
      tax_category TEXT NOT NULL,
      tax_rate_percent REAL,
      tax_amount_usd REAL,
      tax_amount_bs REAL,
      accounting_account_code TEXT,
      accounting_account_name TEXT,
      fiscal_book_eligible INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expense_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      monthly_budget_usd REAL NOT NULL,
      accounting_account_code TEXT,
      accounting_account_name TEXT,
      default_tax_category TEXT,
      description TEXT,
      is_system INTEGER
    );

    CREATE TABLE IF NOT EXISTS fiscal_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL,
      company_name TEXT NOT NULL,
      company_tax_id TEXT NOT NULL,
      fiscal_address TEXT NOT NULL,
      company_phone TEXT NOT NULL DEFAULT '',
      company_email TEXT NOT NULL DEFAULT '',
      economic_activity TEXT NOT NULL DEFAULT '',
      tax_regime TEXT NOT NULL DEFAULT 'ordinario',
      tax_rate_percent REAL NOT NULL,
      invoice_prefix TEXT NOT NULL,
      invoice_serie TEXT NOT NULL DEFAULT 'A',
      next_invoice_number INTEGER NOT NULL,
      control_prefix TEXT NOT NULL DEFAULT '',
      next_control_number INTEGER NOT NULL DEFAULT 1,
      next_credit_note_number INTEGER NOT NULL DEFAULT 1,
      next_debit_note_number INTEGER NOT NULL DEFAULT 1,
      authorization_code TEXT NOT NULL,
      authorization_valid_until TEXT NOT NULL DEFAULT '',
      branch_name TEXT NOT NULL DEFAULT '',
      branch_address TEXT NOT NULL DEFAULT '',
      vat_withholding_agent INTEGER NOT NULL DEFAULT 0,
      vat_withholding_percent REAL NOT NULL DEFAULT 75,
      islr_withholding_agent INTEGER NOT NULL DEFAULT 0,
      islr_withholding_percent REAL NOT NULL DEFAULT 0,
      special_taxpayer INTEGER NOT NULL DEFAULT 0,
      books_format TEXT NOT NULL DEFAULT 'xlsx',
      historical_orders_treatment TEXT NOT NULL DEFAULT 'revisar',
      print_notes TEXT NOT NULL,
      digital_invoicing_enabled INTEGER NOT NULL DEFAULT 0,
      digital_invoicing_provider TEXT NOT NULL DEFAULT '',
      digital_invoicing_provider_tax_id TEXT NOT NULL DEFAULT '',
      digital_invoicing_api_url TEXT NOT NULL DEFAULT '',
      digital_invoicing_environment TEXT NOT NULL DEFAULT 'pruebas',
      digital_invoicing_certificate_label TEXT NOT NULL DEFAULT '',
      digital_invoicing_certificate_expiry TEXT NOT NULL DEFAULT '',
      digital_invoicing_start_date TEXT NOT NULL DEFAULT '',
      digital_invoicing_notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS fiscal_obligations (
      obligation_key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      applicability TEXT NOT NULL,
      normative_reference TEXT NOT NULL DEFAULT '',
      reviewed_at TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_by_role TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS fiscal_obligation_history (
      id TEXT PRIMARY KEY,
      obligation_key TEXT NOT NULL,
      obligation_title TEXT NOT NULL,
      previous_json TEXT NOT NULL,
      current_json TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      user_role TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fiscal_invoices (
      id TEXT PRIMARY KEY,
      serie TEXT NOT NULL DEFAULT 'A',
      invoice_number INTEGER NOT NULL,
      control_number INTEGER NOT NULL DEFAULT 1,
      sale_condition TEXT NOT NULL DEFAULT 'contado',
      payment_method TEXT NOT NULL DEFAULT 'efectivo_bs',
      sales_order_id TEXT,
      sales_order_number TEXT,
      emitter_snapshot TEXT NOT NULL,
      customer_snapshot TEXT NOT NULL,
      items_json TEXT NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      subtotal_bs REAL,
      tax_amount_bs REAL,
      total_bs REAL,
      exchange_rate_used REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'emitida',
      issued_at TEXT NOT NULL,
      annulled_at TEXT,
      annulled_by TEXT,
      annulment_reason TEXT,
      print_count INTEGER NOT NULL DEFAULT 0,
      period_year INTEGER NOT NULL,
      period_month INTEGER NOT NULL,
      UNIQUE (serie, invoice_number),
      UNIQUE (serie, control_number)
    );

    CREATE TABLE IF NOT EXISTS fiscal_adjustment_notes (
      id TEXT PRIMARY KEY,
      note_type TEXT NOT NULL,
      serie TEXT NOT NULL,
      note_number INTEGER NOT NULL,
      control_number INTEGER NOT NULL,
      fiscal_invoice_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      invoice_control_number INTEGER NOT NULL,
      invoice_issued_at TEXT NOT NULL,
      emitter_snapshot TEXT NOT NULL,
      customer_snapshot TEXT NOT NULL,
      reason TEXT NOT NULL,
      reason_details TEXT,
      items_json TEXT NOT NULL,
      subtotal REAL NOT NULL,
      tax_amount REAL NOT NULL,
      total REAL NOT NULL,
      exchange_rate_used REAL NOT NULL,
      issued_at TEXT NOT NULL,
      issued_by TEXT NOT NULL,
      print_count INTEGER NOT NULL DEFAULT 0,
      period_year INTEGER NOT NULL,
      period_month INTEGER NOT NULL,
      UNIQUE (note_type, serie, note_number),
      UNIQUE (control_number)
    );

    CREATE TABLE IF NOT EXISTS fiscal_period_closures (
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      closed_at TEXT NOT NULL,
      closed_by TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL,
      sales_total REAL NOT NULL,
      purchase_total REAL NOT NULL,
      PRIMARY KEY (year, month)
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_usd REAL NOT NULL,
      current_usdt REAL NOT NULL,
      last_updated TEXT NOT NULL,
      is_in_active_window INTEGER NOT NULL,
      active_window_name TEXT NOT NULL,
      next_scheduled_check TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exchange_rate_history (
      id TEXT PRIMARY KEY,
      rate_date TEXT NOT NULL,
      rate_time TEXT NOT NULL,
      usd_rate REAL NOT NULL,
      usdt_rate REAL NOT NULL,
      source TEXT NOT NULL,
      rate_window TEXT NOT NULL,
      variation_usd_percent REAL,
      variation_usdt_percent REAL,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      logged_at TEXT NOT NULL,
      audit_module TEXT NOT NULL,
      action_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      user_role TEXT NOT NULL,
      severity TEXT NOT NULL,
      details_json TEXT
    );

    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      national_id TEXT,
      password_hash TEXT NOT NULL,
      role_id TEXT NOT NULL,
      department TEXT,
      status TEXT NOT NULL DEFAULT 'activo',
      created_at TEXT NOT NULL,
      password_changed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'stone',
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_role_permissions (
      role_id TEXT NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
      module_id TEXT NOT NULL,
      can_view INTEGER NOT NULL DEFAULT 0,
      can_create INTEGER NOT NULL DEFAULT 0,
      can_edit INTEGER NOT NULL DEFAULT 0,
      can_delete INTEGER NOT NULL DEFAULT 0,
      can_export INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (role_id, module_id)
    );

    -- Editable catalogs (migration v9)
    CREATE TABLE IF NOT EXISTS supplier_types (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'stone',
      active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS material_categories (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'stone',
      active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS presentation_types (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      weight_grams REAL NOT NULL,
      packaging_material_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      business_name TEXT NOT NULL,
      tax_id TEXT NOT NULL,
      primary_contact TEXT NOT NULL,
      primary_phone TEXT NOT NULL,
      secondary_phone TEXT,
      email TEXT,
      fiscal_address TEXT NOT NULL,
      physical_address TEXT,
      supplier_type TEXT NOT NULL,
      payment_terms TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supplier_prices (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      supplier_name TEXT NOT NULL,
      material_id TEXT,
      product_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      price_usd REAL NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      is_current INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT
    );

    -- ==========================================================
    -- Tunnel sessions and email notifications (migration v5)
    -- ==========================================================

    CREATE TABLE IF NOT EXISTS tunnel_sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      mode TEXT NOT NULL,
      public_url TEXT NOT NULL,
      api_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'activo',
      pid INTEGER,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS notification_recipients (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      recipients TEXT NOT NULL,
      bcc TEXT,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );

    -- ==========================================================
    -- Activation & payment control (master-only, migration v7)
    -- ==========================================================

    CREATE TABLE IF NOT EXISTS activation_records (
      id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      client_document TEXT,
      concept TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      payment_method TEXT NOT NULL,
      reference TEXT,
      payment_date TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      status TEXT NOT NULL DEFAULT 'activo',
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- ==========================================================
    -- Global system license (migration v8)
    -- ==========================================================

    CREATE TABLE IF NOT EXISTS system_license (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      license_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'prueba',
      holder TEXT,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      grace_days INTEGER NOT NULL DEFAULT 7,
      token_id TEXT,
      last_seen_at TEXT,
      max_seen_at TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS license_events (
      id TEXT PRIMARY KEY,
      license_id TEXT,
      action TEXT NOT NULL,
      status TEXT,
      expires_at TEXT,
      grace_days INTEGER,
      actor TEXT,
      source TEXT NOT NULL,
      token_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS license_alerts (
      id TEXT PRIMARY KEY,
      license_id TEXT NOT NULL,
      alert_date TEXT NOT NULL,
      days_remaining INTEGER NOT NULL,
      recipients TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      UNIQUE(license_id, alert_date)
    );

    CREATE INDEX IF NOT EXISTS idx_tunnel_sessions_started ON tunnel_sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notification_recipients_active ON notification_recipients(active);
    CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activation_records_payment_date ON activation_records(payment_date DESC);
    CREATE INDEX IF NOT EXISTS idx_license_events_created ON license_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_license_alerts_created ON license_alerts(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON recipe_items(recipe_id);
    CREATE INDEX IF NOT EXISTS idx_production_materials_order ON production_order_materials(order_id);
    CREATE INDEX IF NOT EXISTS idx_sales_items_order ON sales_order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_items_note ON delivery_note_items(note_id);
    CREATE INDEX IF NOT EXISTS idx_payroll_payments_week ON payroll_payments(week_id);
    CREATE INDEX IF NOT EXISTS idx_auth_users_username ON auth_users(username);
    CREATE INDEX IF NOT EXISTS idx_supplier_prices_supplier ON supplier_prices(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);

    -- ==========================================================
    -- Cuentas por pagar (migration v12)
    -- ==========================================================

    CREATE TABLE IF NOT EXISTS payables (
      id TEXT PRIMARY KEY,
      payable_number TEXT NOT NULL UNIQUE,
      supplier_id TEXT,
      supplier_name TEXT NOT NULL,
      tax_id TEXT,
      invoice_number TEXT NOT NULL,
      control_number TEXT,
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      exchange_rate_used REAL NOT NULL,
      amount_bs REAL NOT NULL,
      tax_amount_usd REAL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendiente',
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expense_id TEXT
    );

    CREATE TABLE IF NOT EXISTS payable_payments (
      id TEXT PRIMARY KEY,
      payable_id TEXT NOT NULL,
      bank_code TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      reference TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      amount_bs REAL NOT NULL,
      exchange_rate_used REAL NOT NULL,
      paid_at TEXT NOT NULL,
      paid_by TEXT NOT NULL,
      UNIQUE(payable_id, reference)
    );

    CREATE INDEX IF NOT EXISTS idx_payable_payments_payable ON payable_payments(payable_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payable_payment_reference
      ON payable_payments(payable_id, lower(reference));
    CREATE INDEX IF NOT EXISTS idx_payables_due_date ON payables(due_date);
    CREATE INDEX IF NOT EXISTS idx_payables_status ON payables(status);

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      nature TEXT NOT NULL,
      parent_code TEXT,
      level INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounting_entries (
      id TEXT PRIMARY KEY,
      entry_number TEXT NOT NULL UNIQUE,
      entry_date TEXT NOT NULL,
      description TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT,
      status TEXT NOT NULL,
      total_debit REAL NOT NULL,
      total_credit REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      exchange_rate_used REAL NOT NULL,
      period_key TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT,
      annulled_at TEXT,
      annulment_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS accounting_entry_lines (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0,
      memo TEXT,
      line_order INTEGER NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES accounting_entries(id)
    );

    CREATE TABLE IF NOT EXISTS accounting_periods (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL,
      closed_at TEXT,
      closed_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_code);
    CREATE INDEX IF NOT EXISTS idx_accounting_entries_period ON accounting_entries(period_key);
    CREATE INDEX IF NOT EXISTS idx_accounting_entries_source
      ON accounting_entries(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_accounting_entry_lines_entry
      ON accounting_entry_lines(entry_id);
    CREATE INDEX IF NOT EXISTS idx_accounting_entry_lines_account
      ON accounting_entry_lines(account_id);

    -- IVA/UT históricos y parámetros pendientes de la Fase 0 (#13).
    CREATE TABLE IF NOT EXISTS fiscal_reference_values (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      value REAL NOT NULL,
      value_unit TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT NOT NULL DEFAULT '',
      instrument_type TEXT NOT NULL DEFAULT '',
      instrument_number TEXT NOT NULL DEFAULT '',
      official_gazette TEXT NOT NULL DEFAULT '',
      publication_date TEXT NOT NULL DEFAULT '',
      legal_basis TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'referencia',
      confirmed_by_accountant INTEGER NOT NULL DEFAULT 0,
      support_document TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      annulled_at TEXT NOT NULL DEFAULT '',
      annulled_reason TEXT NOT NULL DEFAULT '',
      annulled_by TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_fiscal_reference_kind_dates
      ON fiscal_reference_values(kind, effective_from, effective_to);

    CREATE TABLE IF NOT EXISTS accounting_book_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      approved_formats TEXT NOT NULL DEFAULT 'xlsx,pdf',
      auxiliary_format TEXT NOT NULL DEFAULT 'csv',
      pagination TEXT NOT NULL DEFAULT '',
      signature_text TEXT NOT NULL DEFAULT '',
      signature_role TEXT NOT NULL DEFAULT '',
      exchange_rate_policy TEXT NOT NULL DEFAULT 'documento_con_fallback',
      notes TEXT NOT NULL DEFAULT '',
      approved_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT ''
    );

    -- Borrador editable de apertura #13. Se guarda como snapshot JSON para no
    -- alterar la versión v16 del esquema relacional ni crear una v17.
    CREATE TABLE IF NOT EXISTS accounting_opening (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT ''
    );
  `);

  // Apply additive column migrations for databases created before the
  // newer modules existed. SQLite does not support ADD COLUMN IF NOT EXISTS.
  ensureColumn(db, 'auth_users', 'password_changed_at', 'TEXT');
  ensureColumn(db, 'auth_users', 'avatar_bg', 'TEXT');
  ensureColumn(db, 'raw_materials', 'supplier_id', 'TEXT');
  ensureColumn(db, 'raw_materials', 'supplier_tax_id', 'TEXT');
  ensureColumn(db, 'raw_materials', 'payment_condition', "TEXT NOT NULL DEFAULT 'contado'");
  ensureColumn(db, 'raw_materials', 'credit_days', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'raw_materials', 'payment_due_date', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'production_orders', 'mode', "TEXT NOT NULL DEFAULT 'automatico'");
  ensureColumn(db, 'production_orders', 'formulas_json', 'TEXT');
  ensureColumn(db, 'production_orders', 'manual_sheet_json', 'TEXT');
  ensureColumn(db, 'production_orders', 'production_date', 'TEXT');
  ensureColumn(db, 'production_orders', 'commitment_reference', 'TEXT');
  ensureColumn(db, 'production_orders', 'created_by', 'TEXT');
  ensureColumn(db, 'production_orders', 'updated_by', 'TEXT');
  ensureColumn(db, 'production_orders', 'processed_by', 'TEXT');
  ensureColumn(db, 'production_orders', 'processed_at', 'TEXT');
  ensureColumn(db, 'production_orders', 'annulled_by', 'TEXT');
  ensureColumn(db, 'production_orders', 'annulled_at', 'TEXT');
  ensureColumn(db, 'payroll_weeks', 'bonus_by_role_json', 'TEXT');
  ensureColumn(db, 'expenses', 'issuing_bank_code', 'TEXT');
  ensureColumn(db, 'expenses', 'issuing_bank_name', 'TEXT');
  ensureColumn(db, 'sales_orders', 'collection_json', 'TEXT');
  ensureColumn(db, 'sales_orders', 'collections_json', 'TEXT');
  ensureColumn(db, 'sales_orders', 'created_by', 'TEXT');
  ensureColumn(db, 'customers', 'nit', 'TEXT');
  ensureColumn(db, 'sales_orders', 'customer_nit', 'TEXT');
  ensureColumn(db, 'sales_orders', 'sale_condition', 'TEXT');
  ensureColumn(db, 'sales_orders', 'payment_method', 'TEXT');
  ensureColumn(db, 'sales_orders', 'credit_days', 'INTEGER');
  ensureColumn(db, 'sales_order_items', 'tax_category', 'TEXT');
  ensureColumn(db, 'sales_order_items', 'tax_rate_percent', 'REAL');
  ensureColumn(db, 'sales_order_items', 'tax_amount', 'REAL');
  ensureColumn(db, 'fiscal_settings', 'company_phone', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'company_email', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'economic_activity', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'tax_regime', "TEXT NOT NULL DEFAULT 'ordinario'");
  ensureColumn(db, 'fiscal_settings', 'invoice_serie', "TEXT NOT NULL DEFAULT 'A'");
  ensureColumn(db, 'fiscal_settings', 'control_prefix', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'next_control_number', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'fiscal_settings', 'next_credit_note_number', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'fiscal_settings', 'next_debit_note_number', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'fiscal_settings', 'authorization_valid_until', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'branch_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'branch_address', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'vat_withholding_agent', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'fiscal_settings', 'vat_withholding_percent', 'REAL NOT NULL DEFAULT 75');
  ensureColumn(db, 'fiscal_settings', 'islr_withholding_agent', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'fiscal_settings', 'islr_withholding_percent', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'fiscal_settings', 'special_taxpayer', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'fiscal_settings', 'accounting_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'fiscal_settings', 'vat_withholding_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'fiscal_settings', 'islr_withholding_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'fiscal_settings', 'books_format', "TEXT NOT NULL DEFAULT 'xlsx'");
  ensureColumn(db, 'fiscal_settings', 'historical_orders_treatment', "TEXT NOT NULL DEFAULT 'revisar'");
  ensureColumn(db, 'fiscal_settings', 'digital_invoicing_enabled', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'fiscal_settings', 'digital_invoicing_provider', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'digital_invoicing_provider_tax_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'digital_invoicing_api_url', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'digital_invoicing_environment', "TEXT NOT NULL DEFAULT 'pruebas'");
  ensureColumn(db, 'fiscal_settings', 'digital_invoicing_certificate_label', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'digital_invoicing_certificate_expiry', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'digital_invoicing_start_date', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'digital_invoicing_notes', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_invoices', 'print_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'fiscal_invoices', 'sale_condition', "TEXT NOT NULL DEFAULT 'contado'");
  ensureColumn(db, 'fiscal_invoices', 'payment_method', "TEXT NOT NULL DEFAULT 'efectivo_bs'");
  ensureColumn(db, 'fiscal_invoices', 'credit_days', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'expenses', 'payable_id', 'TEXT');
  ensureColumn(db, 'expenses', 'supplier_id', 'TEXT');
  ensureColumn(db, 'inventory_movements', 'supplier_id', 'TEXT');
  ensureColumn(db, 'inventory_movements', 'supplier_name_snapshot', 'TEXT');
  ensureColumn(db, 'inventory_movements', 'supplier_tax_id_snapshot', 'TEXT');
  // Trazabilidad de compras: condición de pago, cuenta por pagar vinculada y
  // datos del pago de contado. Columnas aditivas, sin cambio de versión de DB.
  ensureColumn(db, 'inventory_movements', 'payment_condition', 'TEXT');
  ensureColumn(db, 'inventory_movements', 'payment_method', 'TEXT');
  ensureColumn(db, 'inventory_movements', 'bank_code', 'TEXT');
  ensureColumn(db, 'inventory_movements', 'bank_name', 'TEXT');
  ensureColumn(db, 'inventory_movements', 'payment_reference', 'TEXT');
  ensureColumn(db, 'inventory_movements', 'credit_days', 'INTEGER');
  ensureColumn(db, 'inventory_movements', 'due_date', 'TEXT');
  ensureColumn(db, 'inventory_movements', 'payable_id', 'TEXT');
  ensureColumn(db, 'inventory_movements', 'payable_number', 'TEXT');
  ensureColumn(db, 'inventory_movements', 'notes', 'TEXT');
  // Cuenta contable elegida por transacción para los asientos automáticos.
  // Columnas aditivas, sin cambio de versión de DB.
  ensureColumn(db, 'inventory_movements', 'payment_account_code', 'TEXT');
  ensureColumn(db, 'expenses', 'payment_account_code', 'TEXT');
  ensureColumn(db, 'payable_payments', 'account_code', 'TEXT');
  // Cuentas contables: clasificación, datos bancarios y saldo provisional #13.
  ensureColumn(db, 'accounts', 'kind', "TEXT NOT NULL DEFAULT 'otra'");
  ensureColumn(db, 'accounts', 'bank_code', 'TEXT');
  ensureColumn(db, 'accounts', 'bank_name', 'TEXT');
  ensureColumn(db, 'accounts', 'account_number', 'TEXT');
  ensureColumn(db, 'accounts', 'currency', 'TEXT');
  ensureColumn(db, 'accounts', 'reference_balance_usd', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'accounts', 'reference_balance_updated_at', 'TEXT');
  ensureColumn(db, 'accounts', 'reference_balance_note', 'TEXT');
  // Catálogo de presentaciones y maestro de productos terminados (#13).
  // Columnas aditivas para no alterar el esquema histórico de la DB v16.
  ensureColumn(db, 'finished_goods', 'status', "TEXT NOT NULL DEFAULT 'activo'");
  ensureColumn(db, 'finished_goods', 'notes', 'TEXT');
  ensureColumn(db, 'finished_goods', 'created_at', 'TEXT');
  ensureColumn(db, 'recipes', 'presentation_label', 'TEXT');
  ensureColumn(db, 'recipes', 'weight_grams', 'REAL');
  // Cadena hash autorizada de asientos (#13). Columnas aditivas: no se cambia la versión de DB.
  ensureColumn(db, 'accounting_entries', 'previous_hash', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'accounting_entries', 'entry_hash', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'accounting_entries', 'hash_sequence', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_payable
      ON expenses(payable_id) WHERE payable_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_expenses_supplier ON expenses(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_supplier
      ON inventory_movements(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_payable
      ON inventory_movements(payable_id);
  `);

  const row = db
    .prepare('SELECT MAX(version) AS version FROM schema_migrations')
    .get() as { version: number | null } | undefined;
  const currentVersion = row?.version ?? 0;

  const insert = db.prepare(
    'INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
  );

  if (currentVersion < 1) {
    insert.run(1, new Date().toISOString());
  }
  if (currentVersion < 2) {
    insert.run(2, new Date().toISOString());
  }
  if (currentVersion < 3) {
    insert.run(3, new Date().toISOString());
  }
  if (currentVersion < 4) {
    insert.run(4, new Date().toISOString());
  }
  if (currentVersion < 5) {
    insert.run(5, new Date().toISOString());
  }
  if (currentVersion < 6) {
    // Restrict the built-in plant supervisor role to view + register only on
    // production, sales and suppliers. Existing databases already have the old
    // permissions persisted, so INSERT OR IGNORE in ensureSeedRoles() would not
    // update them. Fresh databases are seeded with the new matrix afterwards,
    // which makes this UPDATE a no-op for them.
    const supervisorMatrix: Record<
      string,
      { view: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean }
    > = {
      dashboard: { view: true, create: false, edit: false, delete: false, export: true },
      inventory: { view: false, create: false, edit: false, delete: false, export: false },
      production: { view: true, create: true, edit: false, delete: false, export: false },
      costing: { view: false, create: false, edit: false, delete: false, export: false },
      sales: { view: true, create: true, edit: false, delete: false, export: false },
      payroll: { view: false, create: false, edit: false, delete: false, export: false },
      expenses: { view: false, create: false, edit: false, delete: false, export: false },
      suppliers: { view: true, create: true, edit: false, delete: false, export: false },
      settings: { view: false, create: false, edit: false, delete: false, export: false },
      architecture: { view: false, create: false, edit: false, delete: false, export: false },
    };
    const updateSupervisorPermission = db.prepare(`
      UPDATE auth_role_permissions
         SET can_view = ?, can_create = ?, can_edit = ?, can_delete = ?, can_export = ?
       WHERE role_id = 'supervisor_planta' AND module_id = ?
    `);
    for (const [moduleId, permission] of Object.entries(supervisorMatrix)) {
      updateSupervisorPermission.run(
        permission.view ? 1 : 0,
        permission.create ? 1 : 0,
        permission.edit ? 1 : 0,
        permission.delete ? 1 : 0,
        permission.export ? 1 : 0,
        moduleId
      );
    }
    insert.run(6, new Date().toISOString());
  }
  if (currentVersion < 7) {
    // Activation & payment control table and the hidden master role are
    // created by the schema / role seed. This version only records the
    // migration for existing databases.
    insert.run(7, new Date().toISOString());
  }
  if (currentVersion < 8) {
    // Global system license, its event log and the daily alert deduplication
    // table. The singleton row is seeded lazily by ensureSystemLicense() so the
    // initial period can be configured through LICENSE_INITIAL_DAYS.
    insert.run(8, new Date().toISOString());
  }
  if (currentVersion < 9) {
    // Editable catalogs for supplier types and raw-material categories.
    // Catalog rows are seeded only once so later user edits are never undone.
    const now = new Date().toISOString();
    const insertCatalogValue = db.prepare(`
      INSERT OR IGNORE INTO supplier_types
        (id, code, label, description, color, active, is_system, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCategoryValue = db.prepare(`
      INSERT OR IGNORE INTO material_categories
        (id, code, label, description, color, active, is_system, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const seedCatalog = (
      table: 'supplier_types' | 'material_categories',
      values: typeof DEFAULT_SUPPLIER_TYPES
    ) => {
      const statement = table === 'supplier_types' ? insertCatalogValue : insertCategoryValue;
      for (const value of values) {
        const id = `${value.id || `seed-${table}-${value.code}`}`;
        statement.run(
          id,
          value.code,
          value.label,
          value.description,
          value.color,
          value.active ? 1 : 0,
          value.isSystem ? 1 : 0,
          now,
          now
        );
      }
    };
    seedCatalog('supplier_types', DEFAULT_SUPPLIER_TYPES);
    seedCatalog('material_categories', DEFAULT_MATERIAL_CATEGORIES);

    // Keep any legacy free-text value already stored by suppliers/materials.
    const legacyCodes = (statement: string): string[] =>
      (db.prepare(statement).all() as { code: string }[])
        .map((row) => row.code)
        .filter((code) => typeof code === 'string' && code.trim().length > 0);
    const ensureLegacy = (
      table: 'supplier_types' | 'material_categories',
      codes: string[],
      defaults: typeof DEFAULT_SUPPLIER_TYPES
    ) => {
      const statement = table === 'supplier_types' ? insertCatalogValue : insertCategoryValue;
      for (const code of codes) {
        if (defaults.some((value) => value.code === code)) continue;
        statement.run(
          `legacy-${table}-${code}`,
          code,
          code,
          'Valor heredado de datos anteriores',
          'stone',
          1,
          0,
          now,
          now
        );
      }
    };
    ensureLegacy(
      'supplier_types',
      legacyCodes("SELECT DISTINCT supplier_type AS code FROM suppliers WHERE supplier_type IS NOT NULL"),
      DEFAULT_SUPPLIER_TYPES
    );
    ensureLegacy(
      'material_categories',
      legacyCodes("SELECT DISTINCT category AS code FROM raw_materials WHERE category IS NOT NULL"),
      DEFAULT_MATERIAL_CATEGORIES
    );

    // Existing databases need explicit rows for the two new RBAC modules:
    // ensureSeedRoles() uses INSERT OR IGNORE and only covers fresh databases.
    const insertModulePermission = db.prepare(`
      INSERT OR IGNORE INTO auth_role_permissions
        (role_id, module_id, can_view, can_create, can_edit, can_delete, can_export)
      SELECT id, ?,
             CASE WHEN id IN ('admin', 'master') THEN 1 ELSE 0 END,
             CASE WHEN id IN ('admin', 'master') THEN 1 ELSE 0 END,
             CASE WHEN id IN ('admin', 'master') THEN 1 ELSE 0 END,
             CASE WHEN id IN ('admin', 'master') THEN 1 ELSE 0 END,
             CASE WHEN id IN ('admin', 'master') THEN 1 ELSE 0 END
        FROM auth_roles
    `);
    insertModulePermission.run('supplier_types');
    insertModulePermission.run('material_categories');

    insert.run(9, now);
  }
  if (currentVersion < 10) {
    // Fase 2 de CxC: el historial de abonos pasa a ser la fuente de verdad.
    // Los pedidos ya cobrados conservan su `collection_json` y se migran a un
    // array de un elemento para no perder trazabilidad.
    const legacyRows = db
      .prepare(
        `SELECT id, collection_json FROM sales_orders
          WHERE collection_json IS NOT NULL AND TRIM(collection_json) <> ''
            AND (collections_json IS NULL OR TRIM(collections_json) = '')`
      )
      .all() as {id: string; collection_json: string}[];
    const backfill = db.prepare('UPDATE sales_orders SET collections_json = ? WHERE id = ?');
    for (const row of legacyRows) {
      try {
        const lastCollection = JSON.parse(row.collection_json);
        if (lastCollection && typeof lastCollection === 'object' && !Array.isArray(lastCollection)) {
          backfill.run(JSON.stringify([lastCollection]), row.id);
        }
      } catch {
        // Una fila corrupta no debe impedir la migración del resto.
      }
    }
    insert.run(10, new Date().toISOString());
  }
  if (currentVersion < 11) {
    // Las facturas a crédito emitidas antes de v11 no guardaban el plazo; se
    // reconstruye desde el pedido vinculado cuando está disponible.
    db.exec(`
      UPDATE fiscal_invoices
      SET credit_days = COALESCE(
        (SELECT credit_days FROM sales_orders WHERE sales_orders.id = fiscal_invoices.sales_order_id),
        0
      )
      WHERE sale_condition = 'credito' AND credit_days = 0
    `);
    insert.run(11, new Date().toISOString());
  }
  if (currentVersion < 12) {
    // CxP: las tablas se crean arriba para bases nuevas y antiguas; este bloque
    // solo registra la migración y deja el camino abierto a futuros backfills.
    insert.run(12, new Date().toISOString());
  }
  if (currentVersion < 13) {
    // Los egresos y movimientos de inventario pueden vincularse al maestro de
    // proveedores. Las columnas se añaden arriba; los registros históricos
    // permanecen válidos con supplier_id = NULL.
    insert.run(13, new Date().toISOString());
  }
  if (currentVersion < 14) {
    // Núcleo contable Fase 1: plan de cuentas, asientos de doble entrada y
    // períodos mensuales. El plan base es provisional hasta la validación #13.
    insert.run(14, new Date().toISOString());
  }
  if (currentVersion < 15) {
    // Facturación digital en modo preparación: solo se persiste la
    // configuración futura. No emite documentos ni contacta al SENIAT.
    insert.run(15, new Date().toISOString());
  }
  if (currentVersion < 16) {
    // Histórico de IVA/UT y parámetros de libros pendientes de la Fase 0.
    // Tablas creadas arriba; solo se registra la versión y se deja el
    // camino abierto a futuros backfills.
    insert.run(16, new Date().toISOString());
  }
  if (currentVersion < 17) {
    // Catálogo editable de presentaciones. Se siembra una sola vez para no
    // sobrescribir códigos creados por el usuario en bases existentes.
    const now = new Date().toISOString();
    const seedPresentation = db.prepare(`
      INSERT OR IGNORE INTO presentation_types
        (id, code, label, weight_grams, packaging_material_id, active, is_system, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `);
    for (const value of DEFAULT_PRESENTATION_TYPES) {
      seedPresentation.run(
        value.id,
        value.code,
        value.label,
        value.weightGrams,
        value.active ? 1 : 0,
        value.isSystem ? 1 : 0,
        now,
        now
      );
    }
    insert.run(17, now);
  }
}

/** Load the persisted state, or `null` if the database has no state yet. */
export function loadState(): DatabaseState | null {
  const db = getDb();
  const row = db
    .prepare('SELECT state_json FROM app_state WHERE id = 1')
    .get() as { state_json: string } | undefined;

  if (!row) return null;

  try {
    return JSON.parse(row.state_json) as DatabaseState;
  } catch (error) {
    console.error('[Persistence] Could not parse persisted state:', error);
    return null;
  }
}

/** Persist the entire state under `app_state.id = 1`. */
export function saveState(state: DatabaseState): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO app_state (id, state_json, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       state_json = excluded.state_json,
       updated_at = excluded.updated_at`
  ).run(JSON.stringify(state), new Date().toISOString());
}

/** Close the SQLite connection (useful for tests / shutdown). */
export function closeDb(): void {
  if (connection) {
    connection.close();
    connection = null;
  }
}

/** Return the current database file path. */
export function getDbPath(): string {
  return dbPath;
}