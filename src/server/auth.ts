import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getDb } from './database/persistence.js';

/**
 * Basic authentication and role-based authorization.
 *
 * Enabled with `AUTH_ENABLED=true`. When disabled (default for local/demo use)
 * the API keeps working without credentials, but the login endpoints are still
 * available so clients can obtain a token.
 */

export type BuiltInRoleId =
  | 'admin'
  | 'supervisor_planta'
  | 'operator'
  | 'analista_costos'
  | 'almacenista';

/** Role identifiers are stored as text so custom roles can be created. */
export type RoleId = string;

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'export';

export type ModuleId =
  | 'dashboard'
  | 'inventory'
  | 'production'
  | 'costing'
  | 'sales'
  | 'payroll'
  | 'expenses'
  | 'suppliers'
  | 'settings'
  | 'architecture';

export type ModulePermissions = Record<PermissionAction, boolean>;

/** Canonical module order used by the role/permission matrix. */
export const MODULE_IDS: ModuleId[] = [
  'dashboard',
  'inventory',
  'production',
  'costing',
  'sales',
  'payroll',
  'expenses',
  'suppliers',
  'settings',
  'architecture',
];

const full: ModulePermissions = {
  view: true,
  create: true,
  edit: true,
  delete: true,
  export: true,
};
const read: ModulePermissions = {
  view: true,
  create: false,
  edit: false,
  delete: false,
  export: false,
};
const readExport: ModulePermissions = {
  view: true,
  create: false,
  edit: false,
  delete: false,
  export: true,
};
const write: ModulePermissions = {
  view: true,
  create: true,
  edit: true,
  delete: false,
  export: true,
};
const none: ModulePermissions = {
  view: false,
  create: false,
  edit: false,
  delete: false,
  export: false,
};

export const ROLE_PERMISSIONS: Record<BuiltInRoleId, Record<ModuleId, ModulePermissions>> = {
  admin: {
    dashboard: full,
    inventory: full,
    production: full,
    costing: full,
    sales: full,
    payroll: full,
    expenses: full,
    suppliers: full,
    settings: full,
    architecture: full,
  },
  supervisor_planta: {
    dashboard: readExport,
    inventory: write,
    production: write,
    costing: read,
    sales: read,
    payroll: read,
    expenses: none,
    suppliers: readExport,
    settings: none,
    architecture: read,
  },
  operator: {
    dashboard: read,
    inventory: none,
    production: { view: true, create: true, edit: true, delete: false, export: false },
    costing: none,
    sales: none,
    payroll: none,
    expenses: none,
    suppliers: none,
    settings: none,
    architecture: none,
  },
  analista_costos: {
    dashboard: readExport,
    inventory: { view: true, create: false, edit: true, delete: false, export: true },
    production: read,
    costing: write,
    sales: readExport,
    payroll: read,
    expenses: write,
    suppliers: write,
    settings: none,
    architecture: read,
  },
  almacenista: {
    dashboard: read,
    inventory: write,
    production: read,
    costing: none,
    sales: { view: true, create: true, edit: false, delete: false, export: true },
    payroll: none,
    expenses: none,
    suppliers: write,
    settings: none,
    architecture: read,
  },
};

/** Display metadata for the built-in roles. Kept in sync with the frontend. */
export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  color: string;
  isSystem: boolean;
}

/** Frontend-friendly permission shape returned by the roles API. */
export interface RolePermissionFlags {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
}

export interface RoleDto extends RoleDefinition {
  permissions: Record<string, RolePermissionFlags>;
}

export const BUILT_IN_ROLES: RoleDefinition[] = [
  {
    id: 'admin',
    name: 'Administrador General',
    description:
      'Acceso total y sin restricciones a todos los módulos y operaciones del sistema',
    color: 'stone',
    isSystem: true,
  },
  {
    id: 'supervisor_planta',
    name: 'Supervisor de Planta & BOM',
    description:
      'Supervisa formulaciones, órdenes de cocción en marmitas y control de stock',
    color: 'amber',
    isSystem: true,
  },
  {
    id: 'operator',
    name: 'Operador de Producción',
    description:
      'Operario de planta para cocción de tandas en marmitas y generación de órdenes OP (sin acceso a precios ni datos financieros)',
    color: 'blue',
    isSystem: true,
  },
  {
    id: 'analista_costos',
    name: 'Analista de Costos & Precios',
    description:
      'Gestiona la hoja de costos, cálculo de insumos, márgenes comerciales y cotizaciones',
    color: 'emerald',
    isSystem: true,
  },
  {
    id: 'almacenista',
    name: 'Almacén & Despachos',
    description:
      'Control de inventario físico, entradas de materia prima y emisión de notas de entrega',
    color: 'purple',
    isSystem: true,
  },
];

const DEFAULT_AVATAR_COLORS: Record<string, string> = {
  admin: 'bg-stone-900',
  supervisor_planta: 'bg-amber-600',
  operator: 'bg-blue-600',
  analista_costos: 'bg-emerald-600',
  almacenista: 'bg-purple-600',
};

export interface AuthUserRecord {
  id: string;
  username: string;
  email: string;
  full_name: string;
  national_id: string | null;
  password_hash: string;
  role_id: RoleId;
  department: string | null;
  status: string;
  created_at: string;
  password_changed_at: string | null;
  avatar_bg: string | null;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  nationalId?: string;
  roleId: RoleId;
  roleName?: string;
  department?: string;
  status: string;
  createdAt: string;
  avatarBg?: string;
}

export interface TokenPayload {
  sub: string;
  username: string;
  role: RoleId;
  iat: number;
  /** Millisecond-issued timestamp, used to invalidate tokens precisely. */
  iatMs?: number;
  exp: number;
}

export interface AuthenticatedUser {
  token: TokenPayload;
  user: AuthUser;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthenticatedUser;
  }
}

const DEFAULT_SEED_PASSWORD = 'mermelada123';
/**
 * Initial password for users created without one. It is intentionally public
 * and must be changed by the user after the first login.
 */
export const DEFAULT_NEW_USER_PASSWORD = 'inicio123';
const DEFAULT_TOKEN_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_SECRET = 'mermelada-dev-secret-change-me';

interface SeedUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  nationalId: string;
  roleId: RoleId;
  department: string;
}

const SEED_USERS: SeedUser[] = [
  {
    id: 'usr-admin',
    username: 'admin',
    email: 'admin@pulpacraft.local',
    fullName: 'Felipe Velazco',
    nationalId: 'V-18.490.231',
    roleId: 'admin',
    department: 'Dirección General',
  },
  {
    id: 'usr-supervisor',
    username: 'supervisor',
    email: 'supervisor@pulpacraft.local',
    fullName: 'Hermes Rodríguez',
    nationalId: 'V-14.882.102',
    roleId: 'supervisor_planta',
    department: 'Producción & Cocción',
  },
  {
    id: 'usr-operador',
    username: 'operador',
    email: 'operador@pulpacraft.local',
    fullName: 'Denis Briceño',
    nationalId: 'V-20.119.456',
    roleId: 'operator',
    department: 'Planta de Elaboración & Cocción',
  },
  {
    id: 'usr-costos',
    username: 'costos',
    email: 'costos@pulpacraft.local',
    fullName: 'Daniela Silva',
    nationalId: 'V-22.340.890',
    roleId: 'analista_costos',
    department: 'Finanzas & Costos',
  },
  {
    id: 'usr-almacen',
    username: 'almacen',
    email: 'almacen@pulpacraft.local',
    fullName: 'Luis Morales',
    nationalId: 'V-17.552.310',
    roleId: 'almacenista',
    department: 'Almacén & Despachos',
  },
];

/** Hash a password with a random salt using Node's scrypt implementation. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

/** Verify a password against a stored `salt:hash` value. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;

  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;

  return timingSafeEqual(candidate, expected);
}

export function isAuthEnabled(): boolean {
  return process.env['AUTH_ENABLED'] === 'true';
}

function getSecret(): string {
  return process.env['AUTH_SECRET'] || DEFAULT_SECRET;
}

function getTokenTtlSeconds(): number {
  const raw = Number(process.env['AUTH_TOKEN_TTL_SECONDS']);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TOKEN_TTL_SECONDS;
}

function getResetTtlSeconds(): number {
  const raw = Number(process.env['AUTH_RESET_TTL_SECONDS']);
  return Number.isFinite(raw) && raw > 0 ? raw : 30 * 60;
}

interface RoleRow {
  id: string;
  name: string;
  description: string;
  color: string;
  is_system: number;
  created_at: string;
}

interface RolePermissionRow {
  role_id: string;
  module_id: string;
  can_view: number;
  can_create: number;
  can_edit: number;
  can_delete: number;
  can_export: number;
}

function roleNameFor(roleId: string): string | undefined {
  const row = getDb()
    .prepare('SELECT name FROM auth_roles WHERE id = ?')
    .get(roleId) as { name: string } | undefined;
  return row?.name;
}

function toPublicUser(row: AuthUserRecord): AuthUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    nationalId: row.national_id ?? undefined,
    roleId: row.role_id,
    roleName: roleNameFor(row.role_id),
    department: row.department ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    avatarBg: row.avatar_bg ?? DEFAULT_AVATAR_COLORS[row.role_id],
  };
}

const ALL_DENIED: RolePermissionFlags = {
  canView: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  canExport: false,
};

function flagsFromRow(row?: RolePermissionRow): RolePermissionFlags {
  if (!row) return { ...ALL_DENIED };
  return {
    canView: row.can_view === 1,
    canCreate: row.can_create === 1,
    canEdit: row.can_edit === 1,
    canDelete: row.can_delete === 1,
    canExport: row.can_export === 1,
  };
}

function toModulePermissions(flags: Partial<RolePermissionFlags>): ModulePermissions {
  return {
    view: flags.canView === true,
    create: flags.canCreate === true,
    edit: flags.canEdit === true,
    delete: flags.canDelete === true,
    export: flags.canExport === true,
  };
}

function getRoleRow(roleId: string): RoleRow | undefined {
  return getDb()
    .prepare('SELECT * FROM auth_roles WHERE id = ?')
    .get(roleId) as RoleRow | undefined;
}

function toRoleDto(row: RoleRow): RoleDto {
  const rows = getDb()
    .prepare('SELECT * FROM auth_role_permissions WHERE role_id = ?')
    .all(row.id) as RolePermissionRow[];
  const byModule = new Map(rows.map((permission) => [permission.module_id, permission]));
  const permissions: Record<string, RolePermissionFlags> = {};
  for (const module of MODULE_IDS) {
    permissions[module] = flagsFromRow(byModule.get(module));
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    isSystem: row.is_system === 1,
    permissions,
  };
}

/**
 * Persist the built-in role metadata and permission matrices.
 *
 * `INSERT OR IGNORE` keeps any customisation made after the first startup, so
 * restarting the server never overwrites administrator changes.
 */
export function ensureSeedRoles(): void {
  const db = getDb();
  const insertRole = db.prepare(`
    INSERT OR IGNORE INTO auth_roles
      (id, name, description, color, is_system, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertPermission = db.prepare(`
    INSERT OR IGNORE INTO auth_role_permissions
      (role_id, module_id, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    const now = new Date().toISOString();
    for (const role of BUILT_IN_ROLES) {
      insertRole.run(
        role.id,
        role.name,
        role.description,
        role.color,
        role.isSystem ? 1 : 0,
        now
      );
      const matrix = ROLE_PERMISSIONS[role.id as BuiltInRoleId];
      for (const module of MODULE_IDS) {
        const permission = matrix[module] ?? none;
        insertPermission.run(
          role.id,
          module,
          permission.view ? 1 : 0,
          permission.create ? 1 : 0,
          permission.edit ? 1 : 0,
          permission.delete ? 1 : 0,
          permission.export ? 1 : 0
        );
      }
    }
  });
  seed();
}

/** Read a role's permission matrix from the database. */
export function getRolePermissions(
  roleId: string
): Record<string, ModulePermissions> | null {
  if (!getRoleRow(roleId)) return null;

  const rows = getDb()
    .prepare('SELECT * FROM auth_role_permissions WHERE role_id = ?')
    .all(roleId) as RolePermissionRow[];
  const byModule = new Map(rows.map((permission) => [permission.module_id, permission]));

  const matrix: Record<string, ModulePermissions> = {};
  for (const module of MODULE_IDS) {
    matrix[module] = toModulePermissions(flagsFromRow(byModule.get(module)));
  }
  for (const permission of rows) {
    matrix[permission.module_id] = toModulePermissions(flagsFromRow(permission));
  }
  return matrix;
}

/** List every role (built-in first) with its persisted permissions. */
export function listRoles(): RoleDto[] {
  const rows = getDb().prepare('SELECT * FROM auth_roles').all() as RoleRow[];
  const builtInOrder = new Map(BUILT_IN_ROLES.map((role, index) => [role.id, index]));

  rows.sort((left, right) => {
    const leftIndex = builtInOrder.get(left.id);
    const rightIndex = builtInOrder.get(right.id);
    if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
    if (leftIndex !== undefined) return -1;
    if (rightIndex !== undefined) return 1;
    return left.created_at.localeCompare(right.created_at);
  });

  return rows.map(toRoleDto);
}

export function getRole(roleId: string): RoleDto | null {
  const row = getRoleRow(roleId);
  return row ? toRoleDto(row) : null;
}

function slugifyRoleName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `role-${base || 'custom'}-${randomBytes(3).toString('hex')}`;
}

export interface RoleInput {
  name: string;
  description: string;
  color: string;
  permissions?: Record<string, Partial<RolePermissionFlags>>;
}

/** Create a custom role. New roles default to dashboard/architecture read-only. */
export function createRole(input: RoleInput): RoleDto {
  const db = getDb();
  const id = slugifyRoleName(input.name);
  const createdAt = new Date().toISOString();
  const provided = input.permissions ?? {
    dashboard: { canView: true },
    architecture: { canView: true },
  };

  const insert = db.prepare(`
    INSERT INTO auth_roles (id, name, description, color, is_system, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `);
  const insertPermission = db.prepare(`
    INSERT INTO auth_role_permissions
      (role_id, module_id, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const create = db.transaction(() => {
    insert.run(id, input.name, input.description, input.color, createdAt);
    for (const module of MODULE_IDS) {
      const flags = { ...ALL_DENIED, ...(provided[module] ?? {}) };
      insertPermission.run(
        id,
        module,
        flags.canView ? 1 : 0,
        flags.canCreate ? 1 : 0,
        flags.canEdit ? 1 : 0,
        flags.canDelete ? 1 : 0,
        flags.canExport ? 1 : 0
      );
    }
  });
  create();

  return toRoleDto(getRoleRow(id)!);
}

/** Update role metadata (name, description, colour). */
export function updateRole(
  roleId: string,
  patch: Partial<Pick<RoleInput, 'name' | 'description' | 'color'>>
): RoleDto | null {
  const current = getRoleRow(roleId);
  if (!current) return null;

  getDb()
    .prepare('UPDATE auth_roles SET name = ?, description = ?, color = ? WHERE id = ?')
    .run(
      patch.name ?? current.name,
      patch.description ?? current.description,
      patch.color ?? current.color,
      roleId
    );
  return toRoleDto(getRoleRow(roleId)!);
}

/** Update one module's permissions for a role. */
export function updateRolePermissions(
  roleId: string,
  moduleId: string,
  patch: Partial<RolePermissionFlags>
): RoleDto | null {
  const role = getRoleRow(roleId);
  if (!role) return null;
  if (role.id === 'admin') {
    throw new Error('El rol Administrador General tiene permisos absolutos y no puede restringirse');
  }
  if (!MODULE_IDS.includes(moduleId as ModuleId)) {
    throw new Error(`El módulo "${moduleId}" no existe`);
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM auth_role_permissions WHERE role_id = ? AND module_id = ?')
    .get(roleId, moduleId) as RolePermissionRow | undefined;
  const merged = { ...flagsFromRow(existing), ...patch };

  db.prepare(`
    INSERT INTO auth_role_permissions
      (role_id, module_id, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(role_id, module_id) DO UPDATE SET
      can_view = excluded.can_view,
      can_create = excluded.can_create,
      can_edit = excluded.can_edit,
      can_delete = excluded.can_delete,
      can_export = excluded.can_export
  `).run(
    roleId,
    moduleId,
    merged.canView ? 1 : 0,
    merged.canCreate ? 1 : 0,
    merged.canEdit ? 1 : 0,
    merged.canDelete ? 1 : 0,
    merged.canExport ? 1 : 0
  );

  return getRole(roleId);
}

/** Delete a custom role that is not assigned to any user. */
export function deleteRole(roleId: string): boolean {
  const role = getRoleRow(roleId);
  if (!role) return false;
  if (role.is_system === 1) {
    throw new Error('No se pueden eliminar los roles base del sistema');
  }
  const assigned = getDb()
    .prepare('SELECT COUNT(*) AS count FROM auth_users WHERE role_id = ?')
    .get(roleId) as { count: number };
  if (assigned.count > 0) {
    throw new Error('No se puede eliminar un rol asignado a usuarios');
  }
  getDb().prepare('DELETE FROM auth_roles WHERE id = ?').run(roleId);
  return true;
}

/** Insert the demo roles and users if the tables are empty. Idempotent. */
export function ensureSeedUsers(): void {
  ensureSeedRoles();

  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS count FROM auth_users').get() as {
    count: number;
  };
  if (row.count > 0) return;

  const password = process.env['AUTH_SEED_PASSWORD'] || DEFAULT_SEED_PASSWORD;
  const createdAt = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO auth_users (
      id, username, email, full_name, national_id, password_hash,
      role_id, department, status, created_at, avatar_bg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?, ?)
  `);

  const seed = db.transaction(() => {
    for (const user of SEED_USERS) {
      insert.run(
        user.id,
        user.username,
        user.email,
        user.fullName,
        user.nationalId,
        hashPassword(password),
        user.roleId,
        user.department,
        createdAt,
        DEFAULT_AVATAR_COLORS[user.roleId] ?? 'bg-stone-900'
      );
    }
  });
  seed();
}

export function findUserByUsername(username: string): AuthUserRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM auth_users WHERE username = ?')
    .get(username) as AuthUserRecord | undefined;
}

export function findUserById(id: string): AuthUserRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM auth_users WHERE id = ?')
    .get(id) as AuthUserRecord | undefined;
}

export function findUserByIdentifier(identifier: string): AuthUserRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM auth_users WHERE username = ? OR lower(email) = lower(?)')
    .get(identifier, identifier) as AuthUserRecord | undefined;
}

export interface UserInput {
  fullName: string;
  username: string;
  email: string;
  nationalId?: string;
  roleId: string;
  department?: string;
  status?: 'activo' | 'inactivo';
  avatarBg?: string;
  password?: string;
}

export interface UserUpdateInput extends Partial<UserInput> {
  /** Optional new password; leaves the current hash untouched when omitted. */
  password?: string;
}

function requireRoleExists(roleId: string): void {
  if (!getRoleRow(roleId)) {
    throw new Error(`El rol "${roleId}" no existe`);
  }
}

/** List all users with their assigned role name. */
export function listUsers(): AuthUser[] {
  const rows = getDb()
    .prepare('SELECT * FROM auth_users ORDER BY created_at, username')
    .all() as AuthUserRecord[];
  return rows.map(toPublicUser);
}

export function createUser(input: UserInput): AuthUser {
  const db = getDb();
  requireRoleExists(input.roleId);

  const username = input.username.trim().toLowerCase();
  if (!username) throw new Error('El nombre de usuario es obligatorio');
  if (findUserByUsername(username)) {
    throw new Error('El nombre de usuario ya está registrado');
  }

  const id = `usr-${randomBytes(6).toString('hex')}`;
  const createdAt = new Date().toISOString();
  const password = input.password?.trim() || DEFAULT_NEW_USER_PASSWORD;

  db.prepare(`
    INSERT INTO auth_users (
      id, username, email, full_name, national_id, password_hash,
      role_id, department, status, created_at, avatar_bg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    username,
    input.email.trim(),
    input.fullName.trim(),
    input.nationalId?.trim() || null,
    hashPassword(password),
    input.roleId,
    input.department?.trim() || null,
    input.status === 'inactivo' ? 'inactivo' : 'activo',
    createdAt,
    input.avatarBg || DEFAULT_AVATAR_COLORS[input.roleId] || 'bg-stone-900'
  );

  return toPublicUser(findUserById(id)!);
}

export function updateUser(
  userId: string,
  patch: UserUpdateInput
): AuthUser | null {
  const current = findUserById(userId);
  if (!current) return null;

  if (patch.roleId) requireRoleExists(patch.roleId);

  const username = patch.username
    ? patch.username.trim().toLowerCase()
    : current.username;
  if (!username) throw new Error('El nombre de usuario es obligatorio');
  if (username !== current.username && findUserByUsername(username)) {
    throw new Error('El nombre de usuario ya está registrado');
  }

  const db = getDb();
  const passwordHash = patch.password
    ? hashPassword(patch.password)
    : current.password_hash;
  const passwordChangedAt = patch.password
    ? new Date().toISOString()
    : current.password_changed_at;

  db.prepare(`
    UPDATE auth_users SET
      username = ?, email = ?, full_name = ?, national_id = ?,
      role_id = ?, department = ?, status = ?, avatar_bg = ?,
      password_hash = ?, password_changed_at = ?
    WHERE id = ?
  `).run(
    username,
    patch.email?.trim() ?? current.email,
    patch.fullName?.trim() ?? current.full_name,
    patch.nationalId === undefined
      ? current.national_id
      : patch.nationalId.trim() || null,
    patch.roleId ?? current.role_id,
    patch.department === undefined
      ? current.department
      : patch.department.trim() || null,
    patch.status ?? current.status,
    patch.avatarBg ?? current.avatar_bg,
    passwordHash,
    passwordChangedAt,
    userId
  );

  if (patch.password) {
    // A password change invalidates outstanding recovery links.
    db.prepare(
      'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL'
    ).run(new Date().toISOString(), userId);
  }

  return toPublicUser(findUserById(userId)!);
}

/**
 * Modules where a user already produced records. Such users must be
 * deactivated instead of deleted so the audit trail and historical documents
 * keep pointing at a real person.
 */
export function getUserActivity(userId: string): string[] {
  const user = findUserById(userId);
  if (!user) return [];

  const db = getDb();
  const fullName = user.full_name.trim();
  if (!fullName) return [];

  const exact = fullName.toLowerCase();
  const withRole = `${fullName} (%)`.toLowerCase();
  const nameMatch = (column: string) =>
    `lower(trim(${column})) = ? OR lower(trim(${column})) LIKE ?`;

  const hasTable = (table: string): boolean =>
    Boolean(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table)
    );

  const hasRows = (sql: string, params: (string | number)[]): boolean => {
    const row = db.prepare(sql).get(...params) as { count: number };
    return row.count > 0;
  };

  const modules: string[] = [];

  if (
    hasTable('audit_logs') &&
    hasRows(
      `SELECT COUNT(*) AS count FROM audit_logs
       WHERE user_id = ? OR ${nameMatch('user_name')}`,
      [userId, exact, withRole]
    )
  ) {
    modules.push('auditoría');
  }

  if (
    hasTable('inventory_movements') &&
    hasRows(
      `SELECT COUNT(*) AS count FROM inventory_movements
       WHERE ${nameMatch('performed_by')}`,
      [exact, withRole]
    )
  ) {
    modules.push('inventario');
  }

  if (hasTable('production_orders')) {
    const clauses = ['created_by', 'updated_by', 'processed_by', 'annulled_by']
      .map((column) => nameMatch(column))
      .join(' OR ');
    if (
      hasRows(
        `SELECT COUNT(*) AS count FROM production_orders WHERE ${clauses}`,
        [exact, withRole, exact, withRole, exact, withRole, exact, withRole]
      )
    ) {
      modules.push('producción');
    }
  }

  if (
    hasTable('expenses') &&
    hasRows(
      `SELECT COUNT(*) AS count FROM expenses WHERE ${nameMatch('registered_by')}`,
      [exact, withRole]
    )
  ) {
    modules.push('gastos');
  }

  if (
    hasTable('supplier_prices') &&
    hasRows(
      `SELECT COUNT(*) AS count FROM supplier_prices WHERE ${nameMatch('created_by')}`,
      [exact, withRole]
    )
  ) {
    modules.push('proveedores');
  }

  if (hasTable('sales_orders')) {
    const salesClauses = [
      nameMatch('created_by'),
      'collection_json LIKE ?',
    ].join(' OR ');
    if (
      hasRows(
        `SELECT COUNT(*) AS count FROM sales_orders WHERE ${salesClauses}`,
        [exact, withRole, `%${fullName}%`]
      )
    ) {
      modules.push('ventas');
    }
  }

  return modules;
}

export function deleteUser(userId: string): boolean {
  const current = findUserById(userId);
  if (!current) return false;

  if (current.role_id === 'admin') {
    const admins = getDb()
      .prepare(
        "SELECT COUNT(*) AS count FROM auth_users WHERE role_id = 'admin' AND status = 'activo'"
      )
      .get() as { count: number };
    if (admins.count <= 1) {
      throw new Error('No se puede eliminar el último administrador activo');
    }
  }

  const activity = getUserActivity(userId);
  if (activity.length > 0) {
    throw new Error(
      `No se puede eliminar al usuario "${current.full_name}" porque tiene actividad registrada en ${activity.join(
        ', '
      )}. Desactívelo para conservar la trazabilidad y la auditoría.`
    );
  }

  getDb().prepare('DELETE FROM auth_users WHERE id = ?').run(userId);
  return true;
}

export type ChangePasswordResult =
  | 'ok'
  | 'not_found'
  | 'inactive'
  | 'invalid_password';

/** Change a user's password after verifying the current one. */
export function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): ChangePasswordResult {
  const user = findUserById(userId);
  if (!user) return 'not_found';
  if (user.status !== 'activo') return 'inactive';
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return 'invalid_password';
  }

  const db = getDb();
  const now = new Date().toISOString();
  const apply = db.transaction(() => {
    db.prepare(
      'UPDATE auth_users SET password_hash = ?, password_changed_at = ? WHERE id = ?'
    ).run(hashPassword(newPassword), now, userId);
    db.prepare(
      'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL'
    ).run(now, userId);
  });
  apply();
  return 'ok';
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create a single-use password reset token. Returns the raw token so the API
 * can deliver it (SMTP in production, devToken in non-production).
 */
export function requestPasswordReset(
  identifier: string
): { token: string; user: AuthUserRecord } | null {
  const user = findUserByIdentifier(identifier.trim());
  if (!user || user.status !== 'activo') return null;

  const db = getDb();
  const now = new Date();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(now.getTime() + getResetTtlSeconds() * 1000);

  const create = db.transaction(() => {
    // Invalidate any previous unused token.
    db.prepare(
      'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL'
    ).run(now.toISOString(), user.id);
    db.prepare(
      `INSERT INTO password_reset_tokens
        (id, user_id, token_hash, expires_at, used_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).run(
      'prt-' + randomBytes(8).toString('hex'),
      user.id,
      hashResetToken(token),
      expiresAt.toISOString(),
      now.toISOString()
    );
  });
  create();

  return { token, user };
}

/** Consume a reset token and set a new password. */
export function confirmPasswordReset(
  token: string,
  newPassword: string
): AuthUserRecord | null {
  const db = getDb();
  const now = new Date();
  const row = db
    .prepare(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`
    )
    .get(hashResetToken(token), now.toISOString()) as
    | { id: string; user_id: string }
    | undefined;
  if (!row) return null;

  const user = findUserById(row.user_id);
  if (!user || user.status !== 'activo') return null;

  const apply = db.transaction(() => {
    db.prepare(
      'UPDATE auth_users SET password_hash = ?, password_changed_at = ? WHERE id = ?'
    ).run(hashPassword(newPassword), now.toISOString(), user.id);
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(
      now.toISOString(),
      row.id
    );
    // Any other outstanding reset token is no longer valid.
    db.prepare(
      'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL'
    ).run(now.toISOString(), user.id);
  });
  apply();

  return user;
}

/** Create a signed token: `base64url(payload).base64url(hmac)`. */
export function signToken(user: AuthUserRecord, ttlSeconds = getTokenTtlSeconds()): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: user.id,
    username: user.username,
    role: user.role_id,
    iat: now,
    iatMs: Date.now(),
    exp: now + ttlSeconds,
  };

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', getSecret())
    .update(encoded)
    .digest('base64url');

  return `${encoded}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = createHmac('sha256', getSecret())
    .update(encoded)
    .digest('base64url');
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    provided.length !== expectedBuffer.length ||
    !timingSafeEqual(provided, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    ) as TokenPayload;
    if (!payload.sub || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function unauthorized(res: Response, message: string): void {
  res.status(401).json({ error: message, code: 'UNAUTHORIZED' });
}

const PUBLIC_PATHS = [
  /^\/api\/health$/,
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/reset-password$/,
  /^\/api\/auth\/reset-password\/confirm$/,
  /^\/api\/openapi\.json$/,
  /^\/api\/docs(?:\/.*)?$/,
];

/**
 * Full request path (mount-independent). `req.path` is relative when the
 * middleware is mounted below `/api`, so use `originalUrl` instead.
 */
export function apiPath(req: Request): string {
  return (req.originalUrl || req.url || '').split('?')[0];
}

function isPublicPath(req: Request): boolean {
  const path = apiPath(req);
  return PUBLIC_PATHS.some((pattern) => pattern.test(path));
}

/** Express middleware: validates the bearer token when auth is enabled. */
export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isAuthEnabled()) {
    next();
    return;
  }

  // Health, login and API documentation stay public.
  if (!apiPath(req).startsWith('/api/') || isPublicPath(req)) {
    next();
    return;
  }

  const header = req.header('authorization') ?? '';
  if (!header.startsWith('Bearer ')) {
    unauthorized(res, 'Token de autenticación requerido');
    return;
  }

  const payload = verifyToken(header.slice('Bearer '.length));
  if (!payload) {
    unauthorized(res, 'Token inválido o expirado');
    return;
  }

  const record = findUserById(payload.sub);
  if (!record || record.status !== 'activo') {
    unauthorized(res, 'Usuario no encontrado o inactivo');
    return;
  }

  // Tokens issued before the last password change are no longer valid.
  if (record.password_changed_at) {
    const changedAtMs = Date.parse(record.password_changed_at);
    const issuedAtMs = payload.iatMs ?? payload.iat * 1000;
    if (Number.isFinite(changedAtMs) && issuedAtMs < changedAtMs) {
      unauthorized(res, 'Token inválido o expirado');
      return;
    }
  }

  req.auth = { token: payload, user: toPublicUser(record) };
  next();
}

/**
 * Restrict a route to the given roles. In demo mode (AUTH_ENABLED=false)
 * there is no server-side session, so the active role simulated by the
 * frontend is read from `X-Demo-Role` to keep administrator-only rules
 * enforceable during functional testing.
 */
export function requireRole(...roles: RoleId[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isAuthEnabled()) {
      const role = req.auth?.user.roleId;
      if (!role || !roles.includes(role)) {
        res.status(403).json({
          error: `Esta operación requiere uno de los roles: ${roles.join(', ')}`,
          code: 'FORBIDDEN',
          details: { requiredRoles: roles },
        });
        return;
      }
      next();
      return;
    }

    const demoRole = (req.header('x-demo-role') || 'admin') as RoleId;
    if (!roles.includes(demoRole)) {
      res.status(403).json({
        error: `Esta operación requiere uno de los roles: ${roles.join(', ')}`,
        code: 'FORBIDDEN',
        details: { requiredRoles: roles, demoRole },
      });
      return;
    }
    next();
  };
}

/** Shorthand for administrator-only endpoints. */
export const requireAdmin = requireRole('admin');

function resolveModule(path: string): ModuleId | null {
  if (path.startsWith('/api/inventory')) return 'inventory';
  if (path.startsWith('/api/recipes')) return 'production';
  if (path.startsWith('/api/production-orders')) return 'production';
  if (path.startsWith('/api/sales')) return 'sales';
  if (path.startsWith('/api/suppliers')) return 'suppliers';
  if (path.startsWith('/api/banks')) return 'expenses';
  if (path.startsWith('/api/payroll')) return 'payroll';
  if (path.startsWith('/api/costing')) return 'costing';
  if (path.startsWith('/api/expenses')) return 'expenses';
  if (path.startsWith('/api/fiscal-settings')) return 'settings';
  if (path.startsWith('/api/exchange-rates')) return 'settings';
  if (path.startsWith('/api/notifications')) return 'settings';
  if (path.startsWith('/api/system/tunnel')) return 'settings';
  if (path.startsWith('/api/reports')) return 'dashboard';
  if (path.startsWith('/api/audit-logs')) return 'dashboard';
  return null;
}

function resolveAction(req: Request): PermissionAction {
  if (req.method === 'GET' || req.method === 'HEAD') return 'view';
  if (req.method === 'DELETE') return 'delete';
  if (req.method === 'PUT' || req.method === 'PATCH') return 'edit';
  if (req.method === 'POST') {
    if (/\/(process|refresh|update|status|collect|annul)$/.test(apiPath(req))) return 'edit';
    return 'create';
  }
  return 'view';
}

/** Express middleware: checks module permissions for the current role. */
export function authorizeRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isAuthEnabled()) {
    next();
    return;
  }

  if (!apiPath(req).startsWith('/api/')) {
    next();
    return;
  }

  if (isPublicPath(req)) {
    next();
    return;
  }

  if (apiPath(req) === '/api/auth/me') {
    next();
    return;
  }

  const auth = req.auth;
  if (!auth) {
    unauthorized(res, 'Autenticación requerida');
    return;
  }

  // Fiscal settings are needed to print operational documents by any role.
  // Reading is allowed for authenticated users; writing stays admin-only.
  if (
    apiPath(req) === '/api/fiscal-settings' &&
    (req.method === 'GET' || req.method === 'HEAD')
  ) {
    next();
    return;
  }

  // Demo reset is reserved for administrators.
  if (apiPath(req) === '/api/system/reset' && auth.user.roleId !== 'admin') {
    res.status(403).json({
      error: 'Solo un administrador puede reiniciar los datos',
      code: 'FORBIDDEN',
    });
    return;
  }

  const module = resolveModule(apiPath(req));
  if (!module) {
    next();
    return;
  }

  const action = resolveAction(req);
  const permissions =
    getRolePermissions(auth.user.roleId)?.[module] ??
    ROLE_PERMISSIONS[auth.user.roleId as BuiltInRoleId]?.[module];
  if (!permissions || !permissions[action]) {
    res.status(403).json({
      error: `El rol ${auth.user.roleId} no tiene permiso '${action}' sobre '${module}'`,
      code: 'FORBIDDEN',
      details: { module, action },
    });
    return;
  }

  next();
}

/** POST /api/auth/login handler. */
export function loginHandler(req: Request, res: Response): void {
  const username =
    typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const record = username ? findUserByUsername(username) : undefined;
  if (!record || record.status !== 'activo' || !verifyPassword(password, record.password_hash)) {
    unauthorized(res, 'Usuario o contraseña incorrectos');
    return;
  }

  const token = signToken(record);
  res.json({
    token,
    tokenType: 'Bearer',
    expiresIn: getTokenTtlSeconds(),
    user: toPublicUser(record),
  });
}

/** GET /api/auth/me handler. */
export function meHandler(req: Request, res: Response): void {
  if (!req.auth) {
    unauthorized(res, 'Autenticación requerida');
    return;
  }
  res.json(req.auth.user);
}

/** POST /api/auth/logout handler. Tokens are stateless, so the client discards it. */
export function logoutHandler(req: Request, res: Response): void {
  res.json({
    success: true,
    message: 'Sesión cerrada correctamente',
    user: req.auth?.user?.username ?? null,
  });
}

/** POST /api/auth/reset-password handler. */
export function resetPasswordHandler(req: Request, res: Response): void {
  const identifier =
    typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';

  // Always answer with the same message to avoid account enumeration.
  const result = identifier ? requestPasswordReset(identifier) : null;

  const body: Record<string, unknown> = {
    success: true,
    message:
      'Si el usuario o correo existe, recibirás instrucciones para restablecer la contraseña.',
  };

  // In non-production environments the token is returned to enable the
  // recovery flow before SMTP is configured.
  const exposeToken =
    (process.env['AUTH_RESET_EXPOSE_TOKEN'] === 'true' ||
      process.env['NODE_ENV'] !== 'production') &&
    result;
  if (exposeToken) {
    body['devToken'] = result.token;
    body['expiresInSeconds'] = getResetTtlSeconds();
  }

  res.json(body);
}

/** POST /api/auth/reset-password/confirm handler. */
export function confirmResetPasswordHandler(req: Request, res: Response): void {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const newPassword =
    typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  const user = token && newPassword ? confirmPasswordReset(token, newPassword) : null;
  if (!user) {
    res.status(400).json({
      error: 'El enlace de recuperación es inválido o ha expirado',
      code: 'INVALID_RESET_TOKEN',
    });
    return;
  }

  res.json({
    success: true,
    message: 'Contraseña actualizada correctamente. Inicia sesión con tu nueva contraseña.',
    user: toPublicUser(user),
  });
}

/** Extract the `:id` path parameter as a plain string. */
function paramId(req: Request): string {
  const value = req.params['id'];
  return Array.isArray(value) ? value[0] : value;
}

/** POST /api/auth/change-password handler. */
export function changePasswordHandler(req: Request, res: Response): void {
  if (!req.auth) {
    unauthorized(res, 'Autenticación requerida');
    return;
  }

  const currentPassword =
    typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword =
    typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  const result = changePassword(req.auth.user.id, currentPassword, newPassword);
  if (result === 'invalid_password') {
    res.status(400).json({
      error: 'La contraseña actual no es correcta',
      code: 'INVALID_CURRENT_PASSWORD',
    });
    return;
  }
  if (result === 'inactive') {
    res.status(403).json({
      error: 'La cuenta está inactiva',
      code: 'FORBIDDEN',
    });
    return;
  }
  if (result !== 'ok') {
    unauthorized(res, 'Usuario no encontrado');
    return;
  }

  // The current token was issued before `password_changed_at`, so the client
  // must sign in again with the new password.
  res.json({
    success: true,
    message: 'Contraseña actualizada correctamente. Inicia sesión nuevamente.',
    requiresLogin: true,
  });
}

/** GET /api/auth/users handler. */
export function listUsersHandler(_req: Request, res: Response): void {
  res.json(listUsers());
}

/** POST /api/auth/users handler. */
export function createUserHandler(req: Request, res: Response): void {
  res.status(201).json(createUser(req.body as UserInput));
}

/** PUT /api/auth/users/:id handler. */
export function updateUserHandler(req: Request, res: Response): void {
  const id = paramId(req);
  const user = updateUser(id, req.body as UserUpdateInput);
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado', code: 'NOT_FOUND' });
    return;
  }
  res.json(user);
}

/** DELETE /api/auth/users/:id handler. */
export function deleteUserHandler(req: Request, res: Response): void {
  const deleted = deleteUser(paramId(req));
  if (!deleted) {
    res.status(404).json({ error: 'Usuario no encontrado', code: 'NOT_FOUND' });
    return;
  }
  res.json({ success: true, message: 'Usuario eliminado del sistema' });
}

/** GET /api/auth/roles handler. */
export function listRolesHandler(_req: Request, res: Response): void {
  res.json(listRoles());
}

/** POST /api/auth/roles handler. */
export function createRoleHandler(req: Request, res: Response): void {
  res.status(201).json(createRole(req.body as RoleInput));
}

/** PUT /api/auth/roles/:id handler. */
export function updateRoleHandler(req: Request, res: Response): void {
  const role = updateRole(paramId(req), req.body);
  if (!role) {
    res.status(404).json({ error: 'Rol no encontrado', code: 'NOT_FOUND' });
    return;
  }
  res.json(role);
}

/** PUT /api/auth/roles/:id/permissions handler. */
export function updateRolePermissionsHandler(
  req: Request,
  res: Response
): void {
  const role = updateRolePermissions(
    paramId(req),
    req.body?.moduleId,
    req.body?.permissions ?? {}
  );
  if (!role) {
    res.status(404).json({ error: 'Rol no encontrado', code: 'NOT_FOUND' });
    return;
  }
  res.json(role);
}

/** DELETE /api/auth/roles/:id handler. */
export function deleteRoleHandler(req: Request, res: Response): void {
  const deleted = deleteRole(paramId(req));
  if (!deleted) {
    res.status(404).json({ error: 'Rol no encontrado', code: 'NOT_FOUND' });
    return;
  }
  res.json({ success: true, message: 'Rol eliminado con éxito' });
}
