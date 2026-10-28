import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  buildS3Key,
  parseBackupDate,
  pruneRemoteBackups,
  readRemoteConfig,
  selectExpired,
  uploadBackup,
} from '../../scripts/backup-remote.mjs';

/**
 * Tests for the optional off-site backup destinations (S3 and Google Drive).
 * No network or credentials are used: the S3 SDK is replaced by a fake module
 * and Google Drive calls go through an injected fetch.
 */

const workDir = mkdtempSync(join(tmpdir(), 'mermelada-remote-'));
const backupName = 'mermelada-2026-10-28T18-00-00-000Z.db';
const backupPath = join(workDir, backupName);
writeFileSync(backupPath, 'sqlite-backup-content');

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const privateKeyPem = String(privateKey);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function s3Config(env: Record<string, string | undefined> = {}) {
  return readRemoteConfig({
    BACKUP_REMOTE: 's3',
    BACKUP_S3_BUCKET: 'test-bucket',
    BACKUP_S3_REGION: 'eu-west-1',
    BACKUP_S3_PREFIX: 'mermelada/backups',
    BACKUP_S3_ACCESS_KEY_ID: 'AKIATEST',
    BACKUP_S3_SECRET_ACCESS_KEY: 'test-secret',
    BACKUP_S3_ENDPOINT: 'https://minio.example.com',
    BACKUP_S3_FORCE_PATH_STYLE: 'true',
    BACKUP_REMOTE_RETENTION_DAYS: '15',
    ...env,
  });
}

function gdriveConfig(env: Record<string, string | undefined> = {}) {
  return readRemoteConfig({
    BACKUP_REMOTE: 'gdrive',
    BACKUP_GDRIVE_FOLDER_ID: 'folder-123',
    BACKUP_GDRIVE_CLIENT_EMAIL: 'backup@project.iam.gserviceaccount.com',
    BACKUP_GDRIVE_PRIVATE_KEY: privateKeyPem.replace(/\n/g, '\\n'),
    BACKUP_REMOTE_RETENTION_DAYS: '15',
    ...env,
  });
}

interface FakeS3Page {
  Contents?: { Key: string }[];
  IsTruncated?: boolean;
  NextContinuationToken?: string;
}

function fakeS3Module(pages: FakeS3Page[] = []) {
  const sent: { kind: string; input: Record<string, unknown> }[] = [];
  const clients: { options: Record<string, unknown> }[] = [];
  let pageIndex = 0;

  class FakeS3Client {
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      clients.push(this);
    }

    async send(command: { kind: string; input: Record<string, unknown> }) {
      sent.push(command);
      if (command.kind === 'list') {
        return pages[pageIndex++] ?? { Contents: [] };
      }
      return {};
    }
  }

  class PutObjectCommand {
    readonly kind = 'put';
    constructor(public input: Record<string, unknown>) {}
  }

  class ListObjectsV2Command {
    readonly kind = 'list';
    constructor(public input: Record<string, unknown>) {}
  }

  class DeleteObjectCommand {
    readonly kind = 'delete';
    constructor(public input: Record<string, unknown>) {}
  }

  return {
    module: {
      S3Client: FakeS3Client,
      PutObjectCommand,
      ListObjectsV2Command,
      DeleteObjectCommand,
    },
    sent,
    clients,
  };
}

describe('readRemoteConfig', () => {
  it('disables remote uploads by default', () => {
    expect(readRemoteConfig({})).toEqual({
      mode: 'none',
      retentionDays: 0,
      s3: null,
      gdrive: null,
    });
  });

  it('rejects an unknown destination', () => {
    expect(() => readRemoteConfig({ BACKUP_REMOTE: 'dropbox' })).toThrow(
      /BACKUP_REMOTE inválido/
    );
  });

  it('validates the S3 settings and normalizes the prefix', () => {
    const config = s3Config({ BACKUP_S3_PREFIX: '/mermelada/backups/' });

    expect(config).toMatchObject({
      mode: 's3',
      retentionDays: 15,
      gdrive: null,
      s3: {
        bucket: 'test-bucket',
        region: 'eu-west-1',
        prefix: 'mermelada/backups',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'test-secret',
        endpoint: 'https://minio.example.com',
        forcePathStyle: true,
      },
    });
  });

  it('requires a bucket and a complete credential pair', () => {
    expect(() =>
      readRemoteConfig({ BACKUP_REMOTE: 's3', BACKUP_S3_BUCKET: '' })
    ).toThrow(/BACKUP_S3_BUCKET/);
    expect(() =>
      s3Config({ BACKUP_S3_SECRET_ACCESS_KEY: '' })
    ).toThrow(/BACKUP_S3_SECRET_ACCESS_KEY/);
    expect(() =>
      s3Config({ BACKUP_S3_ACCESS_KEY_ID: '' })
    ).toThrow(/BACKUP_S3_ACCESS_KEY_ID/);
  });

  it('falls back to BACKUP_RETENTION_DAYS and rejects invalid retention', () => {
    expect(
      s3Config({
        BACKUP_REMOTE_RETENTION_DAYS: undefined,
        BACKUP_RETENTION_DAYS: '30',
      }).retentionDays
    ).toBe(30);
    expect(() =>
      s3Config({ BACKUP_REMOTE_RETENTION_DAYS: '-1' })
    ).toThrow(/BACKUP_REMOTE_RETENTION_DAYS/);
  });

  it('reads a Google service account JSON file', () => {
    const file = join(workDir, 'service-account.json');
    writeFileSync(
      file,
      JSON.stringify({
        client_email: 'file@project.iam.gserviceaccount.com',
        private_key: privateKeyPem,
      })
    );

    const config = readRemoteConfig({
      BACKUP_REMOTE: 'gdrive',
      BACKUP_GDRIVE_FOLDER_ID: 'folder-123',
      BACKUP_GDRIVE_SERVICE_ACCOUNT_FILE: file,
    });

    expect(config.gdrive).toMatchObject({
      folderId: 'folder-123',
      clientEmail: 'file@project.iam.gserviceaccount.com',
      privateKey: privateKeyPem.trim(),
    });
  });

  it('rejects incomplete Google credentials and unsafe folder ids', () => {
    expect(() =>
      readRemoteConfig({
        BACKUP_REMOTE: 'gdrive',
        BACKUP_GDRIVE_FOLDER_ID: 'folder-123',
      })
    ).toThrow(/BACKUP_GDRIVE_SERVICE_ACCOUNT_FILE/);
    expect(() =>
      gdriveConfig({ BACKUP_GDRIVE_FOLDER_ID: "folder' or name contains 'x" })
    ).toThrow(/BACKUP_GDRIVE_FOLDER_ID/);
  });
});

describe('backup names', () => {
  it('builds S3 keys with or without a prefix', () => {
    expect(buildS3Key(backupName, 'mermelada/backups')).toBe(
      `mermelada/backups/${backupName}`
    );
    expect(buildS3Key(backupName, '/')).toBe(backupName);
  });

  it('parses generated timestamps and ignores foreign files', () => {
    expect(parseBackupDate(backupName)?.toISOString()).toBe(
      '2026-10-28T18:00:00.000Z'
    );
    expect(parseBackupDate('mermelada-latest.db')).toBeNull();
    expect(parseBackupDate('other-2026-10-28.db')).toBeNull();
  });

  it('selects only expired files within the retention window', () => {
    const now = Date.UTC(2026, 9, 28, 12, 0, 0);
    const files = [
      { name: 'mermelada-2026-01-01T00-00-00-000Z.db' },
      { name: 'mermelada-2026-10-27T00-00-00-000Z.db' },
      { name: 'not-a-backup.db' },
    ];

    expect(selectExpired(files, 15, now)).toEqual([files[0]]);
    expect(selectExpired(files, 0, now)).toEqual([]);
  });
});

describe('S3 destination', () => {
  it('uploads the local backup with the configured client options', async () => {
    const { module, sent, clients } = fakeS3Module();
    const config = s3Config();

    const result = await uploadBackup(backupPath, config, { s3: module });

    expect(result).toEqual({
      location: `s3://test-bucket/mermelada/backups/${backupName}`,
      key: `mermelada/backups/${backupName}`,
      name: backupName,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].input).toMatchObject({
      Bucket: 'test-bucket',
      Key: `mermelada/backups/${backupName}`,
      ContentType: 'application/octet-stream',
    });
    expect(Buffer.from(sent[0].input['Body'] as Buffer).toString()).toBe(
      'sqlite-backup-content'
    );
    expect(clients[0].options).toEqual({
      region: 'eu-west-1',
      endpoint: 'https://minio.example.com',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'test-secret',
      },
    });
  });

  it('paginates the bucket and deletes only expired backups', async () => {
    const { module, sent } = fakeS3Module([
      {
        Contents: [
          { Key: 'mermelada/backups/mermelada-2026-01-01T00-00-00-000Z.db' },
          { Key: 'mermelada/backups/not-a-backup.txt' },
        ],
        IsTruncated: true,
        NextContinuationToken: 'page-2',
      },
      {
        Contents: [
          { Key: 'mermelada/backups/mermelada-2026-10-27T00-00-00-000Z.db' },
        ],
        IsTruncated: false,
      },
    ]);
    const config = s3Config();
    const now = Date.UTC(2026, 9, 28, 12, 0, 0);

    const pruned = await pruneRemoteBackups(config, { s3: module, now });

    expect(pruned).toBe(1);
    const deletions = sent.filter((command) => command.kind === 'delete');
    expect(deletions).toHaveLength(1);
    expect(deletions[0].input).toEqual({
      Bucket: 'test-bucket',
      Key: 'mermelada/backups/mermelada-2026-01-01T00-00-00-000Z.db',
    });
    const list = sent.filter((command) => command.kind === 'list');
    expect(list[1].input).toMatchObject({ ContinuationToken: 'page-2' });
  });

  it('rejects files that were not created by the backup script', async () => {
    const { module } = fakeS3Module();
    const foreign = join(workDir, 'manual.db');
    writeFileSync(foreign, 'x');

    await expect(
      uploadBackup(foreign, s3Config(), { s3: module })
    ).rejects.toThrow(/Nombre de backup no reconocido/);
  });
});

describe('Google Drive destination', () => {
  it('authenticates with the service account and uploads the backup', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'token-abc' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
        return new Response(
          JSON.stringify({ id: 'file-1', name: backupName }),
          { status: 200 }
        );
      }
      throw new Error(`URL inesperada: ${url}`);
    }) as unknown as typeof fetch;

    const result = await uploadBackup(backupPath, gdriveConfig(), {
      fetch: fetchImpl,
      now: Date.UTC(2026, 9, 28, 12, 0, 0),
    });

    expect(result).toEqual({
      location: 'gdrive://folder-123/file-1',
      id: 'file-1',
      name: backupName,
    });
    expect(calls).toHaveLength(2);
    expect(String(calls[0].init?.body)).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'
    );
    expect(calls[1].init?.headers).toMatchObject({
      authorization: 'Bearer token-abc',
    });
    const body = calls[1].init?.body as Buffer;
    expect(body.toString()).toContain(`"name":"${backupName}"`);
    expect(body.toString()).toContain('sqlite-backup-content');
  });

  it('lists the folder and deletes only expired backups', async () => {
    const deleted: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'token-abc' }), {
          status: 200,
        });
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
        expect(
          (init?.headers as Record<string, string> | undefined)?.['authorization']
        ).toBe('Bearer token-abc');
        return new Response(
          JSON.stringify({
            files: [
              {
                id: 'old-file',
                name: 'mermelada-2026-01-01T00-00-00-000Z.db',
              },
              {
                id: 'recent-file',
                name: 'mermelada-2026-10-27T00-00-00-000Z.db',
              },
              { id: 'foreign', name: 'nota.txt' },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.startsWith('https://www.googleapis.com/drive/v3/files/')) {
        deleted.push(url);
        return new Response(null, { status: 204 });
      }
      throw new Error(`URL inesperada: ${url}`);
    }) as unknown as typeof fetch;

    const pruned = await pruneRemoteBackups(gdriveConfig(), {
      fetch: fetchImpl,
      now: Date.UTC(2026, 9, 28, 12, 0, 0),
    });

    expect(pruned).toBe(1);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain('/old-file?supportsAllDrives=true');
  });

  it('surfaces Google API errors with their status', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('cuota excedida', { status: 429 })
    ) as unknown as typeof fetch;

    await expect(
      uploadBackup(backupPath, gdriveConfig(), { fetch: fetchImpl })
    ).rejects.toThrow(/Google OAuth falló \(HTTP 429\): cuota excedida/);
  });
});
