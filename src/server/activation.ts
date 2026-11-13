import { randomBytes } from 'node:crypto';
import { getDb } from './database/persistence.js';

/**
 * Activation & payment control records.
 *
 * This module is exclusive to the hidden `master` role. The table is kept
 * separate from the operational ERP entities because it is a control ledger:
 * each row documents a customer activation/payment period and can be created,
 * edited or deleted by master only.
 */

export type ActivationCurrency = 'USD' | 'Bs';
export type ActivationStatus =
  | 'activo'
  | 'pendiente'
  | 'vencido'
  | 'suspendido';

export interface ActivationRecord {
  id: string;
  clientName: string;
  clientDocument?: string;
  concept: string;
  amount: number;
  currency: ActivationCurrency;
  paymentMethod: string;
  reference?: string;
  paymentDate: string;
  periodStart?: string;
  periodEnd?: string;
  status: ActivationStatus;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivationInput {
  clientName: string;
  clientDocument?: string;
  concept: string;
  amount: number;
  currency?: ActivationCurrency;
  paymentMethod: string;
  reference?: string;
  paymentDate: string;
  periodStart?: string;
  periodEnd?: string;
  status?: ActivationStatus;
  notes?: string;
}

interface ActivationRow {
  id: string;
  client_name: string;
  client_document: string | null;
  concept: string;
  amount: number;
  currency: string;
  payment_method: string;
  reference: string | null;
  payment_date: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: ActivationRow): ActivationRecord {
  return {
    id: row.id,
    clientName: row.client_name,
    clientDocument: row.client_document ?? undefined,
    concept: row.concept,
    amount: Number(row.amount),
    currency: row.currency === 'Bs' ? 'Bs' : 'USD',
    paymentMethod: row.payment_method,
    reference: row.reference ?? undefined,
    paymentDate: row.payment_date,
    periodStart: row.period_start ?? undefined,
    periodEnd: row.period_end ?? undefined,
    status: ['activo', 'pendiente', 'vencido', 'suspendido'].includes(row.status)
      ? (row.status as ActivationStatus)
      : 'activo',
    notes: row.notes ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listActivations(): ActivationRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM activation_records
        ORDER BY payment_date DESC, created_at DESC`
    )
    .all() as ActivationRow[];
  return rows.map(toRecord);
}

export function getActivation(id: string): ActivationRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM activation_records WHERE id = ?')
    .get(id) as ActivationRow | undefined;
  return row ? toRecord(row) : null;
}

export function createActivation(
  input: ActivationInput,
  createdBy?: string
): ActivationRecord {
  const db = getDb();
  const id = `act-${randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();
  const currency = input.currency === 'Bs' ? 'Bs' : 'USD';
  const status = input.status ?? 'activo';

  db.prepare(`
    INSERT INTO activation_records (
      id, client_name, client_document, concept, amount, currency,
      payment_method, reference, payment_date, period_start, period_end,
      status, notes, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.clientName.trim(),
    input.clientDocument?.trim() || null,
    input.concept.trim(),
    input.amount,
    currency,
    input.paymentMethod.trim(),
    input.reference?.trim() || null,
    input.paymentDate.trim(),
    input.periodStart?.trim() || null,
    input.periodEnd?.trim() || null,
    status,
    input.notes?.trim() || null,
    createdBy?.trim() || null,
    now,
    now
  );

  return getActivation(id)!;
}

export function updateActivation(
  id: string,
  patch: Partial<ActivationInput>
): ActivationRecord | null {
  const current = getActivation(id);
  if (!current) return null;

  const merged = {
    clientName: patch.clientName ?? current.clientName,
    clientDocument:
      patch.clientDocument === undefined
        ? current.clientDocument
        : patch.clientDocument.trim() || undefined,
    concept: patch.concept ?? current.concept,
    amount: patch.amount ?? current.amount,
    currency: patch.currency ?? current.currency,
    paymentMethod: patch.paymentMethod ?? current.paymentMethod,
    reference:
      patch.reference === undefined
        ? current.reference
        : patch.reference.trim() || undefined,
    paymentDate: patch.paymentDate ?? current.paymentDate,
    periodStart:
      patch.periodStart === undefined
        ? current.periodStart
        : patch.periodStart.trim() || undefined,
    periodEnd:
      patch.periodEnd === undefined
        ? current.periodEnd
        : patch.periodEnd.trim() || undefined,
    status: patch.status ?? current.status,
    notes:
      patch.notes === undefined
        ? current.notes
        : patch.notes.trim() || undefined,
  };

  getDb()
    .prepare(
      `UPDATE activation_records SET
        client_name = ?, client_document = ?, concept = ?, amount = ?,
        currency = ?, payment_method = ?, reference = ?, payment_date = ?,
        period_start = ?, period_end = ?, status = ?, notes = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      merged.clientName.trim(),
      merged.clientDocument || null,
      merged.concept.trim(),
      merged.amount,
      merged.currency === 'Bs' ? 'Bs' : 'USD',
      merged.paymentMethod.trim(),
      merged.reference || null,
      merged.paymentDate.trim(),
      merged.periodStart || null,
      merged.periodEnd || null,
      merged.status,
      merged.notes || null,
      new Date().toISOString(),
      id
    );

  return getActivation(id);
}

export function deleteActivation(id: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM activation_records WHERE id = ?')
    .run(id);
  return result.changes > 0;
}
