export interface S3RemoteConfig {
  bucket: string;
  region: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  endpoint: string;
  forcePathStyle: boolean;
}

export interface GdriveRemoteConfig {
  folderId: string;
  clientEmail: string;
  privateKey: string;
}

export interface RemoteConfig {
  mode: 'none' | 's3' | 'gdrive';
  retentionDays: number;
  s3: S3RemoteConfig | null;
  gdrive: GdriveRemoteConfig | null;
}

export interface RemoteUploadResult {
  location: string;
  name: string;
  key?: string;
  id?: string;
}

export interface RemoteDeps {
  s3?: unknown;
  fetch?: typeof fetch;
  now?: number;
}

export function readRemoteConfig(
  env?: Record<string, string | undefined>
): RemoteConfig;
export function parseBackupDate(name: string): Date | null;
export function selectExpired<T extends { name: string }>(
  files: T[],
  retentionDays: number,
  now?: number
): T[];
export function buildS3Key(name: string, prefix: string): string;
export function uploadBackup(
  filePath: string,
  config: RemoteConfig,
  deps?: RemoteDeps
): Promise<RemoteUploadResult | null>;
export function pruneRemoteBackups(
  config: RemoteConfig,
  deps?: RemoteDeps
): Promise<number>;
