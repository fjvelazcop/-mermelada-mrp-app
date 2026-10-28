#!/usr/bin/env node
/**
 * Create a consistent SQLite backup and prune old copies.
 *
 * Environment variables:
 *  - DB_PATH                 Database to back up (default: <cwd>/data/mermelada.db)
 *  - BACKUP_DIR              Destination directory (default: <cwd>/backups)
 *  - BACKUP_RETENTION_DAYS   Delete matching backups older than N days (default: 14, 0 disables)
 *  - BACKUP_REMOTE           Optional off-site copy: none (default), s3 or gdrive.
 *                            See scripts/backup-remote.mjs for its variables.
 */
import Database from 'better-sqlite3';
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  pruneRemoteBackups,
  readRemoteConfig,
  uploadBackup,
} from './backup-remote.mjs';

const dbPath = resolve(
  process.env.DB_PATH || join(process.cwd(), 'data', 'mermelada.db')
);
const backupDir = resolve(
  process.env.BACKUP_DIR || join(process.cwd(), 'backups')
);
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 14);

if (!Number.isFinite(retentionDays) || retentionDays < 0) {
  console.error(
    `[backup] Invalid BACKUP_RETENTION_DAYS: ${process.env.BACKUP_RETENTION_DAYS}`
  );
  process.exit(1);
}

mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(backupDir, `mermelada-${stamp}.db`);

let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    throw new Error(`integrity_check returned "${integrity}"`);
  }

  await db.backup(target);
  db.close();
  db = undefined;
  // Backups contain auth hashes and business data.
  chmodSync(target, 0o600);

  console.log(`[backup] Created ${target} from ${basename(dbPath)}`);
} catch (error) {
  db?.close();
  try {
    unlinkSync(target);
  } catch {
    // The partial file may not exist; ignore.
  }
  console.error(
    `[backup] Failed to back up ${dbPath}: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(1);
}

// Off-site copy is optional. A failure here must not delete or invalidate the
// local backup; the process exits non-zero so cron/monitoring can alert.
try {
  const remote = readRemoteConfig();
  if (remote.mode !== 'none') {
    const uploaded = await uploadBackup(target, remote);
    console.log(
      `[backup] Uploaded ${basename(target)} to ${uploaded.location}`
    );

    const pruned = await pruneRemoteBackups(remote);
    if (pruned > 0) {
      console.log(
        `[backup] Pruned ${pruned} remote backup(s) older than ${remote.retentionDays} day(s).`
      );
    }
  }
} catch (error) {
  console.error(
    `[backup] Remote upload failed: ${
      error instanceof Error ? error.message : String(error)
    }. Local backup kept at ${target}`
  );
  process.exitCode = 1;
}

if (retentionDays > 0) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const removed = [];

  for (const entry of readdirSync(backupDir)) {
    if (!/^mermelada-.*\.db$/.test(entry)) continue;
    const file = join(backupDir, entry);
    const stats = statSync(file);
    if (stats.isFile() && stats.mtimeMs < cutoff) {
      unlinkSync(file);
      removed.push(entry);
    }
  }

  if (removed.length > 0) {
    console.log(
      `[backup] Pruned ${removed.length} backup(s) older than ${retentionDays} day(s).`
    );
  }
}
