import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, setDbPath } from './database/persistence.js';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), 'mermelada-ops-'));

async function runScript(script: string, env: Record<string, string>) {
  return execFileAsync(process.execPath, [join(repoRoot, 'scripts', script)], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
  });
}

afterAll(() => {
  closeDb();
  rmSync(workDir, { recursive: true, force: true });
});

describe('database backup script', () => {
  it('creates a valid SQLite snapshot and prunes only expired backups', async () => {
    const dbPath = join(workDir, 'backup-source.db');
    const backupDir = join(workDir, 'backups');
    mkdirSync(backupDir, { recursive: true });

    setDbPath(dbPath);
    getDb();
    closeDb();

    const oldBackup = join(backupDir, 'mermelada-old.db');
    const unrelated = join(backupDir, 'notes.txt');
    writeFileSync(oldBackup, 'old backup');
    writeFileSync(unrelated, 'keep me');
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(oldBackup, oldDate, oldDate);
    utimesSync(unrelated, oldDate, oldDate);

    const { stdout } = await runScript('backup-db.mjs', {
      DB_PATH: dbPath,
      BACKUP_DIR: backupDir,
      BACKUP_RETENTION_DAYS: '14',
    });

    const backups = readdirSync(backupDir).filter(
      (entry) => entry.startsWith('mermelada-') && entry.endsWith('.db')
    );
    expect(backups).toHaveLength(1);
    expect(stdout).toContain('[backup] Created');
    expect(stdout).toContain('Pruned 1 backup(s)');
    expect(readdirSync(backupDir)).toContain('notes.txt');

    const backupPath = join(backupDir, backups[0]);
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);

    const snapshot = new Database(backupPath, { readonly: true });
    expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(
      snapshot
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
        )
        .get()
    ).toBeTruthy();
    snapshot.close();
  });

  it('fails with a clear message when the database does not exist', async () => {
    await expect(
      runScript('backup-db.mjs', {
        DB_PATH: join(workDir, 'missing.db'),
        BACKUP_DIR: join(workDir, 'empty-backups'),
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('[backup] Failed to back up'),
    });
  });
});

describe('healthcheck and smoke-test scripts', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            version: 'test',
            uptimeSeconds: 1,
            database: { connected: true },
          })
        );
        return;
      }
      if (req.url === '/api/openapi.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ openapi: '3.0.3', paths: {} }));
        return;
      }
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body><app-root></app-root></body></html>');
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not found"}');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  it('healthcheck exits successfully for a healthy instance', async () => {
    const { stdout } = await runScript('healthcheck.mjs', {
      HEALTHCHECK_URL: `${baseUrl}/api/health`,
    });
    expect(stdout).toContain('[healthcheck] OK');
    expect(stdout).toContain('version=test');
  });

  it('healthcheck exits with code 1 for an unreachable instance', async () => {
    await expect(
      runScript('healthcheck.mjs', {
        HEALTHCHECK_URL: 'http://127.0.0.1:1/api/health',
        HEALTHCHECK_TIMEOUT_MS: '1000',
      })
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('[healthcheck] FAIL'),
    });
  });

  it('smoke test verifies health, OpenAPI and the Angular shell', async () => {
    const { stdout } = await runScript('smoke-test.mjs', {
      SMOKE_BASE_URL: baseUrl,
    });
    expect(stdout).toContain('[smoke] PASS health');
    expect(stdout).toContain('[smoke] PASS openapi');
    expect(stdout).toContain('[smoke] PASS frontend');
    expect(stdout).toContain('All 3 checks passed');
  });
});

describe('PM2 process supervisor configuration', () => {
  it('enables automatic restarts and memory limits', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const config = require(join(repoRoot, 'ecosystem.config.cjs')) as {
      apps: Record<string, unknown>[];
    };
    const app = config.apps[0];

    expect(config.apps).toHaveLength(1);
    expect(app['name']).toBe('mermelada-erp');
    expect(app['script']).toBe('dist/app/server/server.mjs');
    expect(app['autorestart']).toBe(true);
    expect(app['max_memory_restart']).toBeTruthy();
    expect(app['kill_timeout']).toBeGreaterThan(0);
    expect(app['env']).toMatchObject({ NODE_ENV: 'production' });
  });
});

describe('deployment artifacts', () => {
  it('configures auto-restart in Docker and systemd', () => {
    const compose = readFileSync(join(repoRoot, 'docker-compose.yml'), 'utf8');
    const systemd = readFileSync(
      join(repoRoot, 'deploy/systemd/mermelada.service'),
      'utf8'
    );

    expect(compose).toContain('restart: unless-stopped');
    expect(compose).toContain('scripts/healthcheck.mjs');
    expect(systemd).toContain('Restart=always');
    expect(systemd).toContain('EnvironmentFile=/etc/mermelada/mermelada.env');
  });

  it('keeps secrets out of the repository and documents required vars', () => {
    const envExample = readFileSync(
      join(repoRoot, '.env.production.example'),
      'utf8'
    );

    expect(envExample).toContain('AUTH_SECRET=replace-with');
    expect(envExample).toContain('AUTH_SEED_PASSWORD=replace-with');
    expect(envExample).toContain('NG_ALLOWED_HOSTS=');
    expect(envExample).not.toMatch(/AUTH_SECRET=[0-9a-f]{32,}/);
  });
});
