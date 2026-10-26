import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseState } from '../erp-database.js';

/**
 * Persistence layer for the ERP.
 *
 * This first iteration persists the entire `DatabaseState` as a JSON document
 * inside a SQLite database. It provides:
 *  - a real on-disk database (SQLite),
 *  - simple schema migrations,
 *  - safe load/save helpers,
 *  - a stable place to grow into a normalized relational schema.
 *
 * Environment variables:
 *  - `DB_PATH` (optional): absolute or relative path to the SQLite file.
 *    Defaults to `<cwd>/data/mermelada.db`.
 */

const DEFAULT_DB_PATH = join(process.cwd(), 'data', 'mermelada.db');
const dbPath = process.env['DB_PATH'] || DEFAULT_DB_PATH;

let connection: Database.Database | null = null;

/** Get (and lazily initialise) the SQLite connection. */
export function getDb(): Database.Database {
  if (!connection) {
    mkdirSync(dirname(dbPath), { recursive: true });
    connection = new Database(dbPath);
    connection.pragma('journal_mode = WAL');
    migrate(connection);
  }
  return connection;
}

/** Run schema migrations. Currently version 1 creates the state table. */
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
  `);

  const row = db
    .prepare('SELECT MAX(version) AS version FROM schema_migrations')
    .get() as { version: number | null } | undefined;
  const currentVersion = row?.version ?? 0;

  if (currentVersion < 1) {
    const insert = db.prepare(
      'INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)'
    );
    insert.run(1, new Date().toISOString());
  }

  // Future migrations:
  // if (currentVersion < 2) { ... }
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