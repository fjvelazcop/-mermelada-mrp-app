import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseState } from '../erp-database.js';

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

let connection: Database.Database | null = null;

/** Get (and lazily initialise) the SQLite connection. */
export function getDb(): Database.Database {
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
  db: Database.Database,
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
function migrate(db: Database.Database): void {
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
      instructions TEXT
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
      base_cost REAL
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
      print_notes TEXT NOT NULL
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

    CREATE INDEX IF NOT EXISTS idx_tunnel_sessions_started ON tunnel_sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notification_recipients_active ON notification_recipients(active);
    CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON recipe_items(recipe_id);
    CREATE INDEX IF NOT EXISTS idx_production_materials_order ON production_order_materials(order_id);
    CREATE INDEX IF NOT EXISTS idx_sales_items_order ON sales_order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_items_note ON delivery_note_items(note_id);
    CREATE INDEX IF NOT EXISTS idx_payroll_payments_week ON payroll_payments(week_id);
    CREATE INDEX IF NOT EXISTS idx_auth_users_username ON auth_users(username);
    CREATE INDEX IF NOT EXISTS idx_supplier_prices_supplier ON supplier_prices(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
  `);

  // Apply additive column migrations for databases created before the
  // newer modules existed. SQLite does not support ADD COLUMN IF NOT EXISTS.
  ensureColumn(db, 'auth_users', 'password_changed_at', 'TEXT');
  ensureColumn(db, 'auth_users', 'avatar_bg', 'TEXT');
  ensureColumn(db, 'production_orders', 'mode', "TEXT NOT NULL DEFAULT 'automatico'");
  ensureColumn(db, 'production_orders', 'formulas_json', 'TEXT');
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
  ensureColumn(db, 'sales_orders', 'created_by', 'TEXT');
  ensureColumn(db, 'fiscal_settings', 'company_phone', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'company_email', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'economic_activity', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'tax_regime', "TEXT NOT NULL DEFAULT 'ordinario'");
  ensureColumn(db, 'fiscal_settings', 'invoice_serie', "TEXT NOT NULL DEFAULT 'A'");
  ensureColumn(db, 'fiscal_settings', 'control_prefix', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'next_control_number', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'fiscal_settings', 'authorization_valid_until', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'branch_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'branch_address', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'fiscal_settings', 'vat_withholding_agent', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'fiscal_settings', 'vat_withholding_percent', 'REAL NOT NULL DEFAULT 75');
  ensureColumn(db, 'fiscal_settings', 'islr_withholding_agent', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'fiscal_settings', 'islr_withholding_percent', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'fiscal_settings', 'special_taxpayer', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'fiscal_settings', 'books_format', "TEXT NOT NULL DEFAULT 'xlsx'");
  ensureColumn(db, 'fiscal_settings', 'historical_orders_treatment', "TEXT NOT NULL DEFAULT 'revisar'");

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