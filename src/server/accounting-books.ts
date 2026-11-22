/**
 * Generación de libros contables derivados de los asientos de la Fase 1 y de
 * los movimientos operativos ya existentes (facturación, cobros, pagos y
 * gastos). Es una implementación provisional: no calcula impuestos, no define
 * consecutivos oficiales y no sustituye la validación del contador (#13).
 *
 * Las plantillas y las referencias normativas están documentadas en
 * `docs/PLANTILLAS-LIBROS.md` y `docs/MATRIZ-OBLIGACIONES-FISCALES.md`.
 */

import { createHash } from 'node:crypto';
import type {
  Account,
  AccountingBookMetadata,
  AccountingBookSettings,
  AccountingBookReport,
  AccountingBookRow,
  AccountingBookRowType,
  AccountingBookType,
  AccountingEntry,
  AccountingEntryLine,
  AccountingPeriod,
  AccountingPeriodStatus,
  Expense,
  FiscalBooksReport,
  FiscalSettings,
  FinishedGood,
  InventoryMovement,
  Payable,
  PayablePayment,
  RawMaterial,
  SalesOrder,
} from '../app/core/models/erp.models.js';

export interface AccountingBookActor {
  userId?: string;
  userName?: string;
  userRole?: string;
}

export interface AccountingBookInput {
  type: AccountingBookType;
  year: number;
  month: number;
  accounts: Account[];
  entries: AccountingEntry[];
  periods: AccountingPeriod[];
  fiscalSettings: FiscalSettings;
  fiscalBooks: FiscalBooksReport;
  salesOrders: SalesOrder[];
  payables: Payable[];
  payablePayments: PayablePayment[];
  expenses: Expense[];
  rawMaterials: RawMaterial[];
  finishedGoods: FinishedGood[];
  inventoryMovements: InventoryMovement[];
  exchangeRateUsed: number;
  /** Tasas guardadas en el documento (id de factura/gasto), cuando existen. */
  documentRates?: Record<string, number>;
  bookSettings?: AccountingBookSettings;
  actor?: AccountingBookActor;
}

interface BookContent {
  headers: string[];
  rows: AccountingBookRow[];
  totals: { label: string; value: number; valueBs?: number }[];
  notes: string[];
  /** Tasa aplicada por fila; si falta se usa la tasa de referencia. */
  rowRates?: { rate: number; source: string }[];
}

interface AccountMovement {
  code: string;
  name: string;
  nature: Account['nature'];
  type: Account['type'];
  openingDebit: number;
  openingCredit: number;
  debit: number;
  credit: number;
}

interface CashMovement {
  date: string;
  description: string;
  direction: 'Ingreso' | 'Egreso';
  method: string;
  bank: string;
  reference: string;
  amount: number;
}

const BOOK_TITLES: Record<AccountingBookType, string> = {
  diario: 'Libro Diario',
  mayor: 'Libro Mayor',
  balance_comprobacion: 'Balance de Comprobación',
  balance_general: 'Libro de Inventarios y Balances — Balance General',
  inventario: 'Libro de Inventario — BORRADOR / PRUEBA',
  estado_resultados: 'Estado de Resultados',
  compras: 'Libro de Compras',
  ventas: 'Libro de Ventas',
  retenciones: 'Libro de Retenciones IVA / ISLR',
  caja_banco: 'Libro Auxiliar de Caja y Banco',
  auxiliar_cxc: 'Libro Auxiliar de Cuentas por Cobrar',
  auxiliar_cxp: 'Libro Auxiliar de Cuentas por Pagar',
};

function round(value: number): number {
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}

function periodKeyFor(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function periodBounds(year: number, month: number): { start: string; end: string } {
  const key = periodKeyFor(year, month);
  return {
    start: `${key}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

function splitNaturalBalance(
  nature: Account['nature'],
  amount: number
): { debit: number; credit: number } {
  const value = round(Math.abs(amount));
  if (nature === 'debito') {
    return amount >= 0 ? { debit: value, credit: 0 } : { debit: 0, credit: value };
  }
  return amount >= 0 ? { debit: 0, credit: value } : { debit: value, credit: 0 };
}

function naturalBalance(movement: AccountMovement, includePeriod: boolean): number {
  const debits = movement.openingDebit + (includePeriod ? movement.debit : 0);
  const credits = movement.openingCredit + (includePeriod ? movement.credit : 0);
  return round(
    movement.nature === 'debito' ? debits - credits : credits - debits
  );
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + Math.max(0, days));
  return value.toISOString().slice(0, 10);
}

function paymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    transferencia_bancaria: 'Transferencia bancaria',
    pago_movil: 'Pago móvil',
    efectivo_usd: 'Efectivo USD',
    efectivo_bs: 'Efectivo Bs',
    zelle: 'Zelle',
    tarjeta: 'Tarjeta',
  };
  return labels[method] || method || '—';
}

function buildMovements(input: AccountingBookInput): AccountMovement[] {
  const { start } = periodBounds(input.year, input.month);
  const key = periodKeyFor(input.year, input.month);
  const byCode = new Map<string, AccountMovement>();

  for (const account of [...input.accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    byCode.set(account.code, {
      code: account.code,
      name: account.name,
      nature: account.nature,
      type: account.type,
      openingDebit: 0,
      openingCredit: 0,
      debit: 0,
      credit: 0,
    });
  }

  const applyLine = (line: AccountingEntryLine, opening: boolean): void => {
    let movement = byCode.get(line.accountCode);
    if (!movement) {
      movement = {
        code: line.accountCode,
        name: line.accountName || line.accountCode,
        nature: 'debito',
        type: 'gasto',
        openingDebit: 0,
        openingCredit: 0,
        debit: 0,
        credit: 0,
      };
      byCode.set(line.accountCode, movement);
    }
    if (opening) {
      movement.openingDebit = round(movement.openingDebit + line.debit);
      movement.openingCredit = round(movement.openingCredit + line.credit);
    } else {
      movement.debit = round(movement.debit + line.debit);
      movement.credit = round(movement.credit + line.credit);
    }
  };

  for (const entry of input.entries) {
    if (entry.status !== 'confirmado') continue;
    if (entry.date < start) entry.lines.forEach((line) => applyLine(line, true));
    if (entry.periodKey === key) entry.lines.forEach((line) => applyLine(line, false));
  }

  return [...byCode.values()];
}

function row(
  cells: (string | number | null)[],
  rowType: AccountingBookRowType = 'detail'
): AccountingBookRow {
  return { cells, rowType };
}

/**
 * Índices de las columnas monetarias USD en el orden de columnas aprobado.
 * Se usan para intercalar la columna Bs. inmediatamente después de cada
 * importe USD, sin alterar el orden original.
 */
const MONETARY_INDICES: Record<AccountingBookType, number[]> = {
  diario: [6, 7],
  mayor: [3, 4, 5, 6],
  balance_comprobacion: [2, 3, 4, 5, 6, 7],
  balance_general: [2],
  inventario: [4, 5],
  estado_resultados: [2],
  compras: [5, 7, 8, 9, 10, 11],
  ventas: [7, 8, 9, 10, 11],
  retenciones: [7, 9],
  caja_banco: [6, 7, 8],
  auxiliar_cxc: [5, 6, 7],
  auxiliar_cxp: [5, 6, 7],
};

function roundRate(value: number): number {
  return Number((Math.round(value * 10000) / 10000).toFixed(4));
}

/**
 * Agrega el equivalente en Bs. junto a cada importe USD y dos columnas finales
 * de trazabilidad. La tasa del documento tiene prioridad; si no existe se usa
 * `currentUsd` y se marca explícitamente como referencia de borrador/prueba.
 */
function withSecondaryCurrency(
  content: BookContent,
  type: AccountingBookType,
  fallbackRate: number
): BookContent {
  const monetary = new Set(MONETARY_INDICES[type]);
  const headers: string[] = [];
  content.headers.forEach((header, index) => {
    headers.push(header);
    if (monetary.has(index)) {
      headers.push(`${header.replace(/\s*USD\s*$/i, '')} Bs.`);
    }
  });
  headers.push('Tasa Bs./USD', 'Origen de la tasa');

  const rows = content.rows.map((item, rowIndex) => {
    const explicit = content.rowRates?.[rowIndex];
    const rate =
      explicit && Number.isFinite(explicit.rate) && explicit.rate > 0
        ? explicit.rate
        : fallbackRate;
    const source = explicit?.source || 'currentUsd (referencia)';
    const cells: (string | number | null)[] = [];
    item.cells.forEach((cell, index) => {
      cells.push(cell);
      if (monetary.has(index)) {
        cells.push(
          typeof cell === 'number' && Number.isFinite(cell) ? round(cell * rate) : ''
        );
      }
    });
    cells.push(roundRate(rate), source);
    return { ...item, cells };
  });

  return {
    headers,
    rows,
    totals: content.totals.map((total) => ({
      ...total,
      valueBs: round(total.value * fallbackRate),
    })),
    notes: [
      ...content.notes,
      'Columnas Bs. pareadas a cada importe USD. Se usa la tasa guardada en el documento cuando existe; de lo contrario currentUsd como referencia en borradores/pruebas.',
    ],
  };
}

function buildDiario(input: AccountingBookInput): {
  headers: string[];
  rows: AccountingBookRow[];
  totals: { label: string; value: number }[];
  notes: string[];
} {
  const key = periodKeyFor(input.year, input.month);
  const entries = input.entries
    .filter((entry) => entry.periodKey === key && entry.status !== 'borrador')
    .sort((a, b) => `${a.date}${a.entryNumber}`.localeCompare(`${b.date}${b.entryNumber}`));
  const rows: AccountingBookRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const entry of entries) {
    const isAnnulled = entry.status === 'anulado';
    for (const line of entry.lines) {
      rows.push(
        row([
          entry.date,
          entry.entryNumber,
          entry.description,
          entry.sourceType,
          line.accountCode,
          line.accountName,
          isAnnulled ? 0 : line.debit,
          isAnnulled ? 0 : line.credit,
          entry.status,
          line.memo || (isAnnulled ? `ANULADO: ${entry.annulmentReason || ''}` : ''),
        ])
      );
    }
    if (!isAnnulled) {
      totalDebit = round(totalDebit + entry.totalDebit);
      totalCredit = round(totalCredit + entry.totalCredit);
      rows.push(
        row(
          [
            entry.date,
            entry.entryNumber,
            `Total asiento ${entry.entryNumber}`,
            entry.sourceType,
            '',
            '',
            entry.totalDebit,
            entry.totalCredit,
            entry.status,
            '',
          ],
          'entryTotal'
        )
      );
    }
  }

  return {
    headers: [
      'Fecha',
      'Nro. Asiento',
      'Descripción',
      'Origen',
      'Código',
      'Cuenta',
      'Débito USD',
      'Crédito USD',
      'Estado',
      'Detalle',
    ],
    rows,
    totals: [
      { label: 'Total débitos', value: totalDebit },
      { label: 'Total créditos', value: totalCredit },
      { label: 'Diferencia', value: round(totalDebit - totalCredit) },
    ],
    notes: [
      'Solo se totalizan los asientos confirmados. Los asientos anulados se conservan para auditoría con montos en cero.',
      'Los asientos en borrador no forman parte del libro formal.',
    ],
  };
}

function buildMayor(input: AccountingBookInput): {
  headers: string[];
  rows: AccountingBookRow[];
  totals: { label: string; value: number }[];
  notes: string[];
} {
  const movements = buildMovements(input);
  const rows: AccountingBookRow[] = [];
  let totalOpening = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  let totalClosing = 0;

  for (const movement of movements) {
    const opening = naturalBalance(movement, false);
    const closing = naturalBalance(movement, true);
    totalOpening = round(totalOpening + opening);
    totalDebit = round(totalDebit + movement.debit);
    totalCredit = round(totalCredit + movement.credit);
    totalClosing = round(totalClosing + closing);
    rows.push(
      row([
        movement.code,
        movement.name,
        movement.nature,
        opening,
        movement.debit,
        movement.credit,
        closing,
      ])
    );
  }

  rows.push(
    row(
      ['', 'TOTALES', '', round(totalOpening), round(totalDebit), round(totalCredit), round(totalClosing)],
      'grandTotal'
    )
  );

  return {
    headers: [
      'Código',
      'Cuenta',
      'Naturaleza',
      'Saldo inicial',
      'Débitos del período',
      'Créditos del período',
      'Saldo final',
    ],
    rows,
    totals: [
      { label: 'Saldo inicial', value: round(totalOpening) },
      { label: 'Débitos', value: round(totalDebit) },
      { label: 'Créditos', value: round(totalCredit) },
      { label: 'Saldo final', value: round(totalClosing) },
    ],
    notes: [
      'Los saldos se presentan según la naturaleza de cada cuenta: débito o crédito.',
      'El saldo inicial incluye todos los asientos confirmados de períodos anteriores.',
    ],
  };
}

function buildBalanceComprobacion(input: AccountingBookInput): {
  headers: string[];
  rows: AccountingBookRow[];
  totals: { label: string; value: number }[];
  notes: string[];
} {
  const movements = buildMovements(input);
  const rows: AccountingBookRow[] = [];
  const totals = {
    openingDebit: 0,
    openingCredit: 0,
    movementDebit: 0,
    movementCredit: 0,
    closingDebit: 0,
    closingCredit: 0,
  };

  for (const movement of movements) {
    const opening = splitNaturalBalance(movement.nature, naturalBalance(movement, false));
    const closing = splitNaturalBalance(movement.nature, naturalBalance(movement, true));
    totals.openingDebit = round(totals.openingDebit + opening.debit);
    totals.openingCredit = round(totals.openingCredit + opening.credit);
    totals.movementDebit = round(totals.movementDebit + movement.debit);
    totals.movementCredit = round(totals.movementCredit + movement.credit);
    totals.closingDebit = round(totals.closingDebit + closing.debit);
    totals.closingCredit = round(totals.closingCredit + closing.credit);
    rows.push(
      row([
        movement.code,
        movement.name,
        opening.debit,
        opening.credit,
        movement.debit,
        movement.credit,
        closing.debit,
        closing.credit,
      ])
    );
  }

  rows.push(
    row(
      [
        '',
        'TOTALES',
        totals.openingDebit,
        totals.openingCredit,
        totals.movementDebit,
        totals.movementCredit,
        totals.closingDebit,
        totals.closingCredit,
      ],
      'grandTotal'
    )
  );

  return {
    headers: [
      'Código',
      'Cuenta',
      'Saldo inicial Debe',
      'Saldo inicial Haber',
      'Movimiento Debe',
      'Movimiento Haber',
      'Saldo final Debe',
      'Saldo final Haber',
    ],
    rows,
    totals: [
      { label: 'Debe', value: totals.closingDebit },
      { label: 'Haber', value: totals.closingCredit },
      { label: 'Diferencia', value: round(totals.closingDebit - totals.closingCredit) },
    ],
    notes: [
      'El balance de comprobación se deriva del Libro Mayor y debe cuadrar en Debe y Haber.',
      'Una diferencia distinto de cero indica saldos con naturaleza contraria o asientos sin confirmar.',
    ],
  };
}

function buildBalanceGeneral(input: AccountingBookInput): {
  headers: string[];
  rows: AccountingBookRow[];
  totals: { label: string; value: number }[];
  notes: string[];
} {
  const movements = buildMovements(input);
  const rows: AccountingBookRow[] = [];
  const groups: Record<'activo' | 'pasivo' | 'patrimonio', number> = {
    activo: 0,
    pasivo: 0,
    patrimonio: 0,
  };

  const sections: { type: keyof typeof groups; label: string }[] = [
    { type: 'activo', label: 'ACTIVO' },
    { type: 'pasivo', label: 'PASIVO' },
    { type: 'patrimonio', label: 'PATRIMONIO' },
  ];

  for (const section of sections) {
    rows.push(row([section.label, '', '', ''], 'section'));
    for (const movement of movements.filter((item) => item.type === section.type)) {
      const signed = naturalBalance(movement, true);
      const presented = section.type === 'activo' ? signed : signed;
      groups[section.type] = round(groups[section.type] + presented);
      rows.push(row([movement.code, movement.name, presented, '']));
    }
    rows.push(row(['', `Total ${section.label.toLowerCase()}`, groups[section.type], ''], 'total'));
  }

  const totalActivo = groups.activo;
  const totalPasivoPatrimonio = round(groups.pasivo + groups.patrimonio);
  rows.push(
    row(
      ['', 'TOTAL ACTIVO', totalActivo, ''],
      'grandTotal'
    )
  );
  rows.push(
    row(
      ['', 'TOTAL PASIVO + PATRIMONIO', totalPasivoPatrimonio, ''],
      'grandTotal'
    )
  );
  rows.push(
    row(
      ['', 'DIFERENCIA', round(totalActivo - totalPasivoPatrimonio), ''],
      'grandTotal'
    )
  );

  return {
    headers: ['Código', 'Cuenta', 'Saldo USD', 'Observaciones'],
    rows,
    totals: [
      { label: 'Total activo', value: totalActivo },
      { label: 'Total pasivo + patrimonio', value: totalPasivoPatrimonio },
      { label: 'Diferencia', value: round(totalActivo - totalPasivoPatrimonio) },
    ],
    notes: [
      'Estructura provisional basada en el plan de cuentas de la Fase 1; pendiente de aprobación del contador (#13).',
      'No incluye saldos iniciales manuales ni ajustes de apertura; la diferencia debe revisarse antes de presentar el libro.',
    ],
  };
}

function buildEstadoResultados(input: AccountingBookInput): {
  headers: string[];
  rows: AccountingBookRow[];
  totals: { label: string; value: number }[];
  notes: string[];
} {
  const movements = buildMovements(input);
  const rows: AccountingBookRow[] = [];
  let ingresos = 0;
  let costos = 0;
  let gastos = 0;

  const sections: { type: Account['type']; label: string }[] = [
    { type: 'ingreso', label: 'INGRESOS' },
    { type: 'costo', label: 'COSTOS' },
    { type: 'gasto', label: 'GASTOS' },
  ];

  for (const section of sections) {
    rows.push(row([section.label, '', '', ''], 'section'));
    let sectionTotal = 0;
    for (const movement of movements.filter((item) => item.type === section.type)) {
      const movementAmount = round(movement.debit - movement.credit);
      const presented =
        section.type === 'ingreso' ? round(-movementAmount) : movementAmount;
      sectionTotal = round(sectionTotal + presented);
      rows.push(row([movement.code, movement.name, presented, '']));
    }
    if (section.type === 'ingreso') ingresos = sectionTotal;
    if (section.type === 'costo') costos = sectionTotal;
    if (section.type === 'gasto') gastos = sectionTotal;
    rows.push(row(['', `Total ${section.label.toLowerCase()}`, sectionTotal, ''], 'total'));
  }

  const resultado = round(ingresos - costos - gastos);
  rows.push(row(['', 'RESULTADO DEL PERÍODO', resultado, ''], 'grandTotal'));

  return {
    headers: ['Código', 'Cuenta', 'Importe USD', 'Observaciones'],
    rows,
    totals: [
      { label: 'Ingresos', value: ingresos },
      { label: 'Costos', value: costos },
      { label: 'Gastos', value: gastos },
      { label: 'Resultado del período', value: resultado },
    ],
    notes: [
      'Se consideran únicamente los movimientos del período; no incorpora saldos iniciales de resultados acumulados.',
      'Clasificación provisional pendiente de validación con el contador (#13).',
    ],
  };
}

function buildVentas(input: AccountingBookInput): BookContent {
  const report = input.fiscalBooks;
  const rows = report.salesRows.map((item) =>
    row([
      item.date,
      item.documentType,
      item.documentNumber,
      item.controlNumber,
      item.customerName,
      item.customerTaxId,
      item.saleCondition,
      round(item.taxableBases.reduce((sum, base) => sum + base.base, 0)),
      item.taxAmount,
      item.exemptAmount,
      item.nonSubjectAmount,
      item.total,
    ])
  );
  rows.push(
    row(
      [
        '',
        'TOTALES',
        '',
        '',
        '',
        '',
        '',
        round(report.salesTotals.taxableBases.reduce((sum, group) => sum + group.base, 0)),
        report.salesTotals.taxAmount,
        report.salesTotals.exemptAmount,
        report.salesTotals.nonSubjectAmount,
        report.salesTotals.total,
      ],
      'grandTotal'
    )
  );

  return {
    headers: [
      'Fecha',
      'Tipo',
      'Documento',
      'Control',
      'Cliente',
      'RIF',
      'Condición',
      'Base gravada USD',
      'IVA USD',
      'Exento USD',
      'No sujeto USD',
      'Total USD',
    ],
    rows,
    totals: [
      { label: 'Base gravada', value: report.salesTotals.taxableBases.reduce((sum, group) => sum + group.base, 0) },
      { label: 'IVA', value: report.salesTotals.taxAmount },
      { label: 'Total', value: report.salesTotals.total },
    ],
    rowRates: [
      ...report.salesRows.map((item) => {
        const rate = input.documentRates?.[item.id];
        return rate && rate > 0
          ? { rate, source: 'Tasa guardada en el documento' }
          : { rate: input.exchangeRateUsed, source: 'currentUsd (referencia)' };
      }),
      { rate: input.exchangeRateUsed, source: 'currentUsd (referencia)' },
    ],
    notes: [
      'Libro reutilizado del cierre fiscal existente; montos en USD con tasa del documento cuando está disponible.',
      'La clasificación IVA 0%/8% es referencia provisional: se registran base imponible, exento e impuesto, pero no se calculan tasas reducidas hasta validar #13.',
      'Formato y campos pendientes de validación con el contador (#13).',
    ],
  };
}

function buildCompras(input: AccountingBookInput): BookContent {
  const report = input.fiscalBooks;
  const rows = report.purchaseRows.map((item) =>
    row([
      item.date,
      item.documentType,
      item.documentNumber,
      item.supplierName,
      item.supplierTaxId,
      item.taxableBase,
      item.taxRatePercent,
      item.taxAmount,
      item.exemptAmount,
      item.nonSubjectAmount,
      item.vatWithholding,
      item.total,
      item.fiscalCreditEligible ? 'Sí' : 'No',
    ])
  );
  rows.push(
    row(
      [
        '',
        'TOTALES',
        '',
        '',
        '',
        report.purchaseTotals.taxableBase,
        '',
        report.purchaseTotals.taxAmount,
        report.purchaseTotals.exemptAmount,
        report.purchaseTotals.nonSubjectAmount,
        report.purchaseTotals.vatWithholding,
        report.purchaseTotals.total,
        '',
      ],
      'grandTotal'
    )
  );

  return {
    headers: [
      'Fecha',
      'Tipo',
      'Documento',
      'Proveedor',
      'RIF',
      'Base gravada USD',
      'Alícuota %',
      'IVA USD',
      'Exento USD',
      'No sujeto USD',
      'Retención IVA USD',
      'Total USD',
      'Crédito fiscal',
    ],
    rows,
    totals: [
      { label: 'Base gravada', value: report.purchaseTotals.taxableBase },
      { label: 'IVA', value: report.purchaseTotals.taxAmount },
      { label: 'Retención IVA', value: report.purchaseTotals.vatWithholding },
      { label: 'Total', value: report.purchaseTotals.total },
    ],
    rowRates: [
      ...report.purchaseRows.map((item) => {
        const rate = input.documentRates?.[item.id];
        return rate && rate > 0
          ? { rate, source: 'Tasa guardada en el documento' }
          : { rate: input.exchangeRateUsed, source: 'currentUsd (referencia)' };
      }),
      { rate: input.exchangeRateUsed, source: 'currentUsd (referencia)' },
    ],
    notes: [
      'Incluye solo gastos marcados como elegibles para el Libro de Compras.',
      'IVA 16% general por defecto; exento 0% para materias primas agrícolas primarias en estado natural (según aplique) y 8% solo para supuestos taxativos: referencia provisional, sin cálculo hasta validar #13.',
      'La retención mostrada es informativa; el cálculo de retenciones permanece desactivado (#13).',
    ],
  };
}

/**
 * Libro de inventario de prueba derivado del stock operativo actual. Usa las
 * cuentas 1.03.01 y 1.03.02 del plan base como control provisional; no calcula
 * impuestos ni constituye un inventario formal a efectos legales.
 */
function buildInventario(input: AccountingBookInput): {
  headers: string[];
  rows: AccountingBookRow[];
  totals: { label: string; value: number }[];
  notes: string[];
} {
  const { start, end } = periodBounds(input.year, input.month);
  const rows: AccountingBookRow[] = [];
  const headers = [
    'Código / ID',
    'Concepto',
    'Tipo',
    'Cantidad',
    'Costo unitario USD',
    'Valor USD',
    'Cuenta provisional',
    'Unidad / Referencia',
    'Observaciones',
  ];

  const movements = input.inventoryMovements
    .filter((movement) => movement.date >= start && movement.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const rawMaterialValue = input.rawMaterials.reduce(
    (sum, material) => sum + material.currentStock * material.costPerUnit,
    0
  );
  const finishedGoodValue = input.finishedGoods.reduce(
    (sum, product) => sum + product.stockUnits * product.baseCost,
    0
  );

  rows.push(
    row(
      [
        'Cuentas de control provisionales: 1.03.01 Materia Prima · 1.03.02 Producto Terminado',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
      'note'
    )
  );

  rows.push(row(['MATERIAS PRIMAS', '', '', '', '', '', '', '', ''], 'section'));
  for (const material of input.rawMaterials) {
    rows.push(
      row([
        material.code,
        material.name,
        'Materia prima',
        round(material.currentStock),
        round(material.costPerUnit),
        round(material.currentStock * material.costPerUnit),
        '1.03.01',
        material.unit,
        material.supplier || material.notes || '',
      ])
    );
  }
  rows.push(
    row(
      ['Total materia prima', '', '', '', '', round(rawMaterialValue), '', '', ''],
      'total'
    )
  );

  rows.push(row(['PRODUCTO TERMINADO', '', '', '', '', '', '', '', ''], 'section'));
  for (const product of input.finishedGoods) {
    rows.push(
      row([
        product.code,
        `${product.flavor} · ${product.presentationLabel}`,
        'Producto terminado',
        round(product.stockUnits),
        round(product.baseCost),
        round(product.stockUnits * product.baseCost),
        '1.03.02',
        product.presentationLabel,
        `Reservadas: ${product.reservedUnits}`,
      ])
    );
  }
  rows.push(
    row(
      ['Total producto terminado', '', '', '', '', round(finishedGoodValue), '', '', ''],
      'total'
    )
  );

  rows.push(row(['MOVIMIENTOS DEL PERÍODO', '', '', '', '', '', '', '', ''], 'section'));
  if (movements.length === 0) {
    rows.push(
      row(
        ['', `Sin movimientos entre ${start} y ${end}`, '', '', '', '', '', '', ''],
        'note'
      )
    );
  }
  for (const movement of movements) {
    rows.push(
      row([
        movement.id,
        movement.materialName,
        movement.type,
        round(movement.quantity),
        round(movement.costPerUnit),
        round(movement.totalCost),
        '1.03.01',
        movement.date,
        movement.referenceDoc || movement.notes || movement.performedBy,
      ])
    );
  }

  rows.push(
    row(
      [
        'Valoración provisional total',
        '',
        '',
        '',
        '',
        round(rawMaterialValue + finishedGoodValue),
        '1.03',
        '',
        '',
      ],
      'grandTotal'
    )
  );

  return {
    headers,
    rows,
    totals: [
      { label: 'Materia prima', value: round(rawMaterialValue) },
      { label: 'Producto terminado', value: round(finishedGoodValue) },
      { label: 'Valoración provisional', value: round(rawMaterialValue + finishedGoodValue) },
      { label: 'Movimientos del período', value: movements.length },
    ],
    notes: [
      'BORRADOR / PRUEBA: valorado con el stock operativo actual y el plan base de 35 cuentas.',
      'No incluye inventario inicial auditado, ajustes de cierre ni saldos de apertura.',
      'Las cuentas 1.03.01 y 1.03.02 son provisionales hasta la validación contable (#13).',
    ],
  };
}

function buildRetenciones(): {
  headers: string[];
  rows: AccountingBookRow[];
  totals: { label: string; value: number }[];
  notes: string[];
} {
  return {
    headers: [
      'Fecha',
      'Impuesto',
      'Dirección',
      'Tercero',
      'RIF',
      'Comprobante',
      'Factura referencia',
      'Base USD',
      'Alícuota %',
      'Monto USD',
      'Moneda',
      'Tasa BCV',
    ],
    rows: [
      row(
        [
          '',
          'IVA / ISLR',
          'Recibida (cliente SPE)',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          'USD',
          '',
        ],
        'note'
      ),
    ],
    totals: [
      { label: 'Retenciones practicadas', value: 0 },
      { label: 'Retenciones recibidas', value: 0 },
    ],
    notes: [
      'SIN OPERACIONES. Como contribuyente ordinario no practicamos retenciones al pagar; solo se contempla el registro/control de comprobantes de retención que clientes SPE nos practican al cobrar (#13).',
      'Retenciones practicadas: NO APLICA (vatWithholdingEnabled=false e islrWithholdingEnabled=false). Retenciones recibidas: 0, solo control documental; sin cálculo real ni consecutivos oficiales.',
      'La cuenta de control para retenciones recibidas de ISLR queda pendiente de definir con el contador; hoy se usa el plan base provisional.',
    ],
  };
}

function buildCajaBanco(input: AccountingBookInput): {
  headers: string[];
  rows: AccountingBookRow[];
  totals: { label: string; value: number }[];
  notes: string[];
} {
  const { start, end } = periodBounds(input.year, input.month);
  const movements: CashMovement[] = [];

  for (const order of input.salesOrders) {
    for (const collection of order.collections || []) {
      const date = String(collection.collectedAt || '').slice(0, 10);
      if (!date || date < start || date > end) continue;
      movements.push({
        date,
        description: `Cobro pedido ${order.orderNumber}`,
        direction: 'Ingreso',
        method: paymentMethodLabel(collection.paymentMethod),
        bank: collection.bankName || collection.bankCode || '—',
        reference: collection.reference,
        amount: round(collection.amountUsd),
      });
    }
  }

  for (const payment of input.payablePayments) {
    const date = String(payment.paidAt || '').slice(0, 10);
    if (!date || date < start || date > end) continue;
    const payable = input.payables.find((item) => item.id === payment.payableId);
    movements.push({
      date,
      description: `Pago CxP ${payable?.payableNumber || payment.payableId}`,
      direction: 'Egreso',
      method: paymentMethodLabel(payment.paymentMethod),
      bank: payment.bankName || payment.bankCode || '—',
      reference: payment.reference,
      amount: round(-payment.amountUsd),
    });
  }

  for (const expense of input.expenses) {
    if (expense.payableId) continue;
    if (expense.date < start || expense.date > end) continue;
    movements.push({
      date: expense.date,
      description: expense.concept,
      direction: 'Egreso',
      method: paymentMethodLabel(expense.paymentMethod),
      bank: expense.issuingBankName || expense.issuingBankCode || '—',
      reference: expense.paymentReference || expense.documentNumber || '',
      amount: round(-expense.amountUsd),
    });
  }

  movements.sort((a, b) =>
    `${a.date}${a.direction}`.localeCompare(`${b.date}${b.direction}`)
  );

  const rows: AccountingBookRow[] = [];
  let balance = 0;
  let ingresos = 0;
  let egresos = 0;

  for (const movement of movements) {
    balance = round(balance + movement.amount);
    if (movement.amount >= 0) ingresos = round(ingresos + movement.amount);
    else egresos = round(egresos + Math.abs(movement.amount));
    rows.push(
      row([
        movement.date,
        movement.description,
        movement.direction,
        movement.method,
        movement.bank,
        movement.reference,
        movement.amount > 0 ? movement.amount : 0,
        movement.amount < 0 ? Math.abs(movement.amount) : 0,
        balance,
      ])
    );
  }

  rows.push(
    row(
      ['', 'TOTALES', '', '', '', '', round(ingresos), round(egresos), round(balance)],
      'grandTotal'
    )
  );

  return {
    headers: [
      'Fecha',
      'Concepto',
      'Tipo',
      'Método de pago',
      'Banco',
      'Referencia',
      'Ingreso USD',
      'Egreso USD',
      'Saldo USD',
    ],
    rows,
    totals: [
      { label: 'Ingresos', value: round(ingresos) },
      { label: 'Egresos', value: round(egresos) },
      { label: 'Saldo final', value: round(balance) },
    ],
    notes: [
      'Auxiliar de movimientos derivado de cobros, pagos CxP y gastos; no incluye saldo inicial ni conciliación bancaria.',
      'Para un Libro de Banco formal se requiere configurar cuentas bancarias y saldos de apertura con el contador.',
    ],
  };
}

function buildAuxiliarCxc(input: AccountingBookInput): {
  headers: string[];
  rows: AccountingBookRow[];
  totals: { label: string; value: number }[];
  notes: string[];
} {
  const { start, end } = periodBounds(input.year, input.month);
  const rows: AccountingBookRow[] = [];
  let cargos = 0;
  let abonos = 0;
  let saldo = 0;

  for (const order of input.salesOrders) {
    const invoiceDate = String(order.deliveryDate || order.orderDate || '').slice(0, 10);
    const collections = (order.collections || []).filter((item) => {
      const date = String(item.collectedAt || '').slice(0, 10);
      return date >= start && date <= end;
    });
    const invoiceInPeriod = invoiceDate >= start && invoiceDate <= end;
    if (!invoiceInPeriod && collections.length === 0) continue;

    if (invoiceInPeriod) {
      const amount = round(order.total);
      saldo = round(saldo + amount);
      cargos = round(cargos + amount);
      rows.push(
        row([
          invoiceDate,
          order.customerName,
          order.customerTaxId,
          order.orderNumber,
          'Factura / cargo',
          amount,
          0,
          saldo,
          order.saleCondition === 'credito'
            ? addDays(invoiceDate, order.creditDays || 0)
            : invoiceDate,
        ])
      );
    }

    for (const collection of collections) {
      const date = String(collection.collectedAt).slice(0, 10);
      const amount = round(collection.amountUsd);
      saldo = round(saldo - amount);
      abonos = round(abonos + amount);
      rows.push(
        row([
          date,
          order.customerName,
          order.customerTaxId,
          order.orderNumber,
          'Abono / cobro',
          0,
          amount,
          saldo,
          '',
        ])
      );
    }
  }

  rows.sort((a, b) => String(a.cells[0] || '').localeCompare(String(b.cells[0] || '')));
  rows.push(
    row(['', 'TOTALES', '', '', '', round(cargos), round(abonos), round(saldo), ''], 'grandTotal')
  );

  return {
    headers: [
      'Fecha',
      'Cliente',
      'RIF',
      'Documento',
      'Tipo de movimiento',
      'Cargo USD',
      'Abono USD',
      'Saldo USD',
      'Vencimiento',
    ],
    rows,
    totals: [
      { label: 'Cargos', value: round(cargos) },
      { label: 'Abonos', value: round(abonos) },
      { label: 'Saldo final', value: round(saldo) },
    ],
    notes: [
      'Auxiliar de cobros pendientes derivado de pedidos y abonos; no incluye saldos iniciales por cliente.',
      'Conciliar con el estado de cuenta antes de usar el saldo como evidencia contable.',
    ],
  };
}

function buildAuxiliarCxp(input: AccountingBookInput): {
  headers: string[];
  rows: AccountingBookRow[];
  totals: { label: string; value: number }[];
  notes: string[];
} {
  const { start, end } = periodBounds(input.year, input.month);
  const paymentsByPayable = new Map<string, PayablePayment[]>();
  for (const payment of input.payablePayments) {
    const list = paymentsByPayable.get(payment.payableId) || [];
    list.push(payment);
    paymentsByPayable.set(payment.payableId, list);
  }

  const rows: AccountingBookRow[] = [];
  let cargos = 0;
  let abonos = 0;
  let saldo = 0;

  for (const payable of input.payables) {
    const payments = (paymentsByPayable.get(payable.id) || []).filter((item) => {
      const date = String(item.paidAt || '').slice(0, 10);
      return date >= start && date <= end;
    });
    const issueInPeriod = payable.issueDate >= start && payable.issueDate <= end;
    if (!issueInPeriod && payments.length === 0) continue;

    if (issueInPeriod) {
      const amount = round(payable.amountUsd);
      saldo = round(saldo + amount);
      cargos = round(cargos + amount);
      rows.push(
        row([
          payable.issueDate,
          payable.supplierName,
          payable.taxId || '',
          payable.invoiceNumber,
          'Factura / cargo',
          amount,
          0,
          saldo,
          payable.dueDate,
        ])
      );
    }

    for (const payment of payments) {
      const date = String(payment.paidAt).slice(0, 10);
      const amount = round(payment.amountUsd);
      saldo = round(saldo - amount);
      abonos = round(abonos + amount);
      rows.push(
        row([
          date,
          payable.supplierName,
          payable.taxId || '',
          payable.invoiceNumber,
          'Pago / abono',
          0,
          amount,
          saldo,
          '',
        ])
      );
    }
  }

  rows.sort((a, b) => String(a.cells[0] || '').localeCompare(String(b.cells[0] || '')));
  rows.push(
    row(['', 'TOTALES', '', '', '', round(cargos), round(abonos), round(saldo), ''], 'grandTotal')
  );

  return {
    headers: [
      'Fecha',
      'Proveedor',
      'RIF',
      'Documento',
      'Tipo de movimiento',
      'Cargo USD',
      'Abono USD',
      'Saldo USD',
      'Vencimiento',
    ],
    rows,
    totals: [
      { label: 'Cargos', value: round(cargos) },
      { label: 'Abonos', value: round(abonos) },
      { label: 'Saldo final', value: round(saldo) },
    ],
    notes: [
      'Auxiliar de pagos derivado de facturas por pagar; no incluye saldos iniciales por proveedor.',
      'Conciliar con el estado de cuenta del proveedor antes de usar el saldo como evidencia contable.',
    ],
  };
}

function calculateTotalControl(rows: AccountingBookRow[]): number {
  const total = rows
    .filter((item) => item.rowType === 'detail' || item.rowType === 'grandTotal')
    .flatMap((item) => item.cells)
    .reduce<number>((sum, cell) => {
      if (typeof cell !== 'number' || !Number.isFinite(cell)) return sum;
      return sum + Math.abs(cell);
    }, 0);
  return round(total);
}

function buildMetadata(
  input: AccountingBookInput,
  title: string,
  rows: AccountingBookRow[],
  totalControl: number,
  periodStatus: AccountingPeriodStatus
): AccountingBookMetadata {
  const { start, end } = periodBounds(input.year, input.month);
  const generatedAt = new Date().toISOString();
  // El hash incluye todas las celdas (USD y Bs.); el saldo de control solo
  // considera los importes USD para no duplicar la misma operación.
  const hashBase = JSON.stringify({
    type: input.type,
    periodKey: periodKeyFor(input.year, input.month),
    title,
    rows,
    totalControl,
    periodStatus,
  });
  const hash = createHash('sha256').update(hashBase).digest('hex').slice(0, 16);

  return {
    companyName: input.fiscalSettings.companyName || 'Razón social pendiente',
    taxId: input.fiscalSettings.companyTaxId || 'RIF pendiente',
    fiscalAddress: input.fiscalSettings.fiscalAddress || '',
    periodLabel: periodKeyFor(input.year, input.month),
    startDate: start,
    endDate: end,
    currency: 'USD',
    currencyLabel: 'USD (equivalente en Bs. según tasa del documento)',
    secondaryCurrency: 'BS',
    secondaryCurrencyLabel: 'Bs. (bolívares soberanos)',
    exchangeRateUsed: input.exchangeRateUsed,
    exchangeRatePolicy:
      input.bookSettings?.exchangeRatePolicy || 'documento_con_fallback',
    generatedAt,
    generatedBy: input.actor?.userName || 'sistema',
    totalControl,
    hash,
    provisional: true,
    signatureLabel:
      input.bookSettings?.signatureText ||
      'Firma: _______________________   Contador / Representante legal',
  };
}

/** Construye un libro contable completo, con metadatos y firma provisional. */
export function buildAccountingBook(input: AccountingBookInput): AccountingBookReport {
  const key = periodKeyFor(input.year, input.month);
  const periodStatus =
    input.periods.find((period) => period.key === key)?.status || 'abierto';
  const title = BOOK_TITLES[input.type];

  let content: BookContent;

  switch (input.type) {
    case 'diario':
      content = buildDiario(input);
      break;
    case 'mayor':
      content = buildMayor(input);
      break;
    case 'balance_comprobacion':
      content = buildBalanceComprobacion(input);
      break;
    case 'balance_general':
      content = buildBalanceGeneral(input);
      break;
    case 'inventario':
      content = buildInventario(input);
      break;
    case 'estado_resultados':
      content = buildEstadoResultados(input);
      break;
    case 'compras':
      content = buildCompras(input);
      break;
    case 'ventas':
      content = buildVentas(input);
      break;
    case 'retenciones':
      content = buildRetenciones();
      break;
    case 'caja_banco':
      content = buildCajaBanco(input);
      break;
    case 'auxiliar_cxc':
      content = buildAuxiliarCxc(input);
      break;
    case 'auxiliar_cxp':
      content = buildAuxiliarCxp(input);
      break;
  }

  const totalControl = calculateTotalControl(content.rows);
  const localized = withSecondaryCurrency(content, input.type, input.exchangeRateUsed);
  const notes = [
    'BORRADOR / PRUEBA – PROVISIONAL – PENDIENTE DE VALIDACIÓN CONTABLE (#13).',
    'Generado con el plan base actual y cuentas de control provisionales; no es evidencia fiscal.',
    'Saldos de apertura, fecha de corte, formatos legales, firma definitiva y numeración de libro/página: pendientes de ajustar con el contador (#13).',
    ...localized.notes,
    ...(input.bookSettings?.notes ? [input.bookSettings.notes] : []),
    ...(input.bookSettings?.pagination
      ? [`Paginación: ${input.bookSettings.pagination}`]
      : ['Paginación: aun por definir (#13).']),
  ];
  const rows = [
    ...localized.rows,
    row([`LIBRO: ${title}`, '', '', ''], 'section'),
    row(
      [
        `SALDO DE CONTROL USD: ${totalControl.toFixed(2)}`,
        `SALDO DE CONTROL Bs.: ${round(totalControl * input.exchangeRateUsed).toFixed(2)}`,
        '',
        '',
      ],
      'note'
    ),
  ];
  const metadata = buildMetadata(input, title, localized.rows, totalControl, periodStatus);

  return {
    type: input.type,
    title,
    year: input.year,
    month: input.month,
    periodKey: key,
    periodStatus,
    headers: localized.headers,
    rows,
    totals: localized.totals,
    notes,
    metadata,
  };
}
