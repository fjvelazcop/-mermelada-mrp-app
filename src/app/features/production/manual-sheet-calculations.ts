/**
 * Pure helpers for the manual production sheet (physical Lote 72 format).
 *
 * The sheet is captured by weight (kilos totales) and valued by packaging
 * presentation, so the number of units must be derived instead of typed twice.
 * Keeping the formulas here makes the UI and their tests agree on rounding.
 */

/** Round to two decimals, the precision used by the sheet inputs. */
export function roundSheetValue(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

/**
 * Default yield inferred from the master BOMs (finished kilos / ingredient
 * kilos). It is configurable in the sheet and only used as a starting value.
 */
export const DEFAULT_SHEET_YIELD_PERCENT = 88.6;

function nonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Ingredient mass that becomes product, in kilos. Water/gasoil is excluded. */
export interface IngredientMassInput {
  guavaKg: number;
  sugarKg: number;
  starchKg: number;
  chemicalG: number;
  acidG: number;
}

/**
 * Ingredient mass in kilos: guava + sugar + starch + chemical g + acid g.
 * "Agua/gasoil" is process consumption (utility), not product mass.
 */
export function calculateIngredientMassKg(input: IngredientMassInput): number {
  return roundSheetValue(
    nonNegative(input.guavaKg) +
      nonNegative(input.sugarKg) +
      nonNegative(input.starchKg) +
      nonNegative(input.chemicalG) / 1000 +
      nonNegative(input.acidG) / 1000
  );
}

/** Clamp the configured yield to a usable percentage. */
export function normalizeYieldPercent(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SHEET_YIELD_PERCENT;
  }
  return Math.min(100, parsed);
}

/**
 * Kilos totales estimated from the captured ingredients and the configured
 * yield. The result is editable by the operator.
 */
export function calculateTotalKgFromIngredients(
  input: IngredientMassInput,
  yieldPercent: number
): number {
  const massKg = calculateIngredientMassKg(input);
  return roundSheetValue(massKg * (normalizeYieldPercent(yieldPercent) / 100));
}

/**
 * Units obtained from a marmita: kilos totales ÷ peso por envase.
 * Returns 0 when either input is missing or the presentation is invalid.
 */
export function calculateObtainedUnits(
  totalKg: number,
  presentationKg: number
): number {
  const weight = Number(totalKg);
  const presentation = Number(presentationKg);
  if (
    !Number.isFinite(weight) ||
    weight <= 0 ||
    !Number.isFinite(presentation) ||
    presentation <= 0
  ) {
    return 0;
  }
  return roundSheetValue(weight / presentation);
}

/** Units obtained directly from the ingredients, yield and presentation. */
export function calculateObtainedUnitsFromIngredients(
  input: IngredientMassInput,
  yieldPercent: number,
  presentationKg: number
): number {
  return calculateObtainedUnits(
    calculateTotalKgFromIngredients(input, yieldPercent),
    presentationKg
  );
}

export interface PackagingEstimate {
  presentationKg: number;
  estimatedUnits: number;
  assignedUnits: number;
  difference: number;
  missingUnits: number;
  excessUnits: number;
  cunetesKg: number;
  cajasKg: number;
}

/**
 * Compares the units that the captured kilos represent against the units
 * assigned to the available products (cuñetes and cajas). Each product keeps
 * its own weight and assignment, so the sheet works with one or both.
 */
export function calculatePackagingEstimate(
  totalKg: number,
  presentationKg: number,
  cunetes: number,
  cajas: number
): PackagingEstimate {
  const weight = Number.isFinite(Number(totalKg)) ? Number(totalKg) : 0;
  const presentation =
    Number.isFinite(Number(presentationKg)) && Number(presentationKg) > 0
      ? Number(presentationKg)
      : 0;
  const cunetesValue =
    Number.isFinite(Number(cunetes)) && Number(cunetes) > 0
      ? Number(cunetes)
      : 0;
  const cajasValue =
    Number.isFinite(Number(cajas)) && Number(cajas) > 0 ? Number(cajas) : 0;

  const estimatedUnits =
    presentation > 0 ? roundSheetValue(weight / presentation) : 0;
  const assignedUnits = roundSheetValue(cunetesValue + cajasValue);
  const difference = roundSheetValue(assignedUnits - estimatedUnits);

  return {
    presentationKg: presentation,
    estimatedUnits,
    assignedUnits,
    difference,
    missingUnits: difference < 0 ? roundSheetValue(-difference) : 0,
    excessUnits: difference > 0 ? difference : 0,
    cunetesKg: roundSheetValue(cunetesValue * presentation),
    cajasKg: roundSheetValue(cajasValue * presentation),
  };
}

/** Minimal presentation shape needed by the unit helpers. */
export interface PresentationWeight {
  id: string;
  presentationKg: number;
}

/** Units of one presentation produced by a marmita. */
export interface PresentationUnitAssignment {
  presentationId: string;
  units: number;
}

/** True when the operator must capture units per presentation manually. */
export function requiresManualPresentationUnits(
  presentations: PresentationWeight[]
): boolean {
  return presentations.length > 1;
}

/** Total units across all presentation lines of a marmita. */
export function sumPresentationUnits(
  units: PresentationUnitAssignment[]
): number {
  return roundSheetValue(
    (units || []).reduce((sum, item) => sum + nonNegative(item.units), 0)
  );
}

/**
 * Normalise the manual distribution of one marmita so every presentation is
 * present exactly once and invalid values become zero.
 */
export function normalizePresentationUnits(
  units: PresentationUnitAssignment[] | undefined,
  presentations: PresentationWeight[]
): PresentationUnitAssignment[] {
  const byId = new Map<string, number>();
  for (const item of units || []) {
    if (!item?.presentationId) continue;
    byId.set(item.presentationId, nonNegative(item.units));
  }
  return presentations.map((line) => ({
    presentationId: line.id,
    units: byId.get(line.id) ?? 0,
  }));
}

/**
 * Units produced by a marmita for the configured presentations.
 *
 * - One presentation: automatic (kilos totales ÷ peso por envase).
 * - Several presentations: the operator-provided manual distribution wins.
 */
export function calculateMarmitaPresentationUnits(
  totalKg: number,
  presentations: PresentationWeight[],
  manualUnits?: PresentationUnitAssignment[]
): PresentationUnitAssignment[] {
  if (presentations.length === 0) return [];
  if (requiresManualPresentationUnits(presentations)) {
    return normalizePresentationUnits(manualUnits, presentations);
  }
  const line = presentations[0];
  return [
    {
      presentationId: line.id,
      units: calculateObtainedUnits(totalKg, line.presentationKg),
    },
  ];
}

/** Units represented by kilos totales for a given presentation. */
export interface PresentationKilosEstimate {
  id: string;
  presentationKg: number;
  units: number;
  estimatedUnits: number;
  difference: number;
  missingUnits: number;
  excessUnits: number;
  assignedKg: number;
}

/**
 * Compares each presentation's assigned units against the units represented
 * by the captured kilos. Used by the multi-presentation summary.
 */
export function calculatePresentationsEstimate(
  totalKg: number,
  presentations: { id: string; presentationKg: number; units: number }[]
): PresentationKilosEstimate[] {
  return presentations.map((line) => {
    const presentationKg = nonNegative(line.presentationKg);
    const units = nonNegative(line.units);
    const estimatedUnits =
      presentationKg > 0
        ? roundSheetValue(nonNegative(totalKg) / presentationKg)
        : 0;
    const difference = roundSheetValue(units - estimatedUnits);
    return {
      id: line.id,
      presentationKg,
      units,
      estimatedUnits,
      difference,
      missingUnits: difference < 0 ? roundSheetValue(-difference) : 0,
      excessUnits: difference > 0 ? difference : 0,
      assignedKg: roundSheetValue(units * presentationKg),
    };
  });
}

/** One editable cell of the marmita × presentation matrix. */
export interface SheetMatrixCellTotals {
  presentationId: string;
  units: number;
  assignedKg: number;
}

/** Units and kilos of a marmita across every configured presentation. */
export interface SheetMarmitaTotals {
  number: number;
  units: number;
  assignedKg: number;
  estimatedKg: number;
  differenceKg: number;
  missingKg: number;
  excessKg: number;
  cells: SheetMatrixCellTotals[];
}

/** Totals of one presentation column across every marmita. */
export interface SheetPresentationTotals {
  id: string;
  units: number;
  assignedKg: number;
  unitsByMarmita: { number: number; units: number }[];
}

/** Totals of the whole marmita × presentation matrix. */
export interface SheetMatrixTotals {
  marmitas: SheetMarmitaTotals[];
  presentations: SheetPresentationTotals[];
  totalUnits: number;
  assignedKg: number;
}

/** Marmita row as captured by the manual sheet (subset used by the matrix). */
export interface SheetMatrixMarmitaInput {
  number: number;
  totalKg: number;
  obtainedUnits?: number;
  presentationUnits?: PresentationUnitAssignment[];
}

/**
 * Totals of the marmita × presentation matrix: one row per marmita, one column
 * per presentation and a grand total.
 *
 * Legacy single-presentation sheets may not persist `presentationUnits`; in
 * that case the derived units of the marmita row are used for the only column.
 */
export function calculateSheetMatrixTotals(
  marmitas: SheetMatrixMarmitaInput[],
  presentations: PresentationWeight[]
): SheetMatrixTotals {
  const columns = presentations.map((line) => ({
    id: line.id,
    presentationKg: nonNegative(line.presentationKg),
  }));
  const presentationTotals: SheetPresentationTotals[] = columns.map((line) => ({
    id: line.id,
    units: 0,
    assignedKg: 0,
    unitsByMarmita: [],
  }));

  let totalUnits = 0;
  let assignedKg = 0;

  const marmitaTotals = marmitas.map((row) => {
    const stored = new Map<string, number>();
    for (const item of row.presentationUnits || []) {
      if (!item?.presentationId) continue;
      stored.set(item.presentationId, nonNegative(item.units));
    }
    if (columns.length === 1 && !stored.has(columns[0].id)) {
      const fallback = nonNegative(row.obtainedUnits);
      if (fallback > 0) stored.set(columns[0].id, fallback);
    }

    let units = 0;
    let rowKg = 0;
    const cells = columns.map((column, index) => {
      const cellUnits = stored.get(column.id) ?? 0;
      const cellKg = roundSheetValue(cellUnits * column.presentationKg);
      units = roundSheetValue(units + cellUnits);
      rowKg = roundSheetValue(rowKg + cellKg);
      presentationTotals[index].units = roundSheetValue(
        presentationTotals[index].units + cellUnits
      );
      presentationTotals[index].assignedKg = roundSheetValue(
        presentationTotals[index].assignedKg + cellKg
      );
      presentationTotals[index].unitsByMarmita.push({
        number: row.number,
        units: cellUnits,
      });
      return {
        presentationId: column.id,
        units: cellUnits,
        assignedKg: cellKg,
      };
    });

    const estimatedKg = nonNegative(row.totalKg);
    const differenceKg = roundSheetValue(rowKg - estimatedKg);
    totalUnits = roundSheetValue(totalUnits + units);
    assignedKg = roundSheetValue(assignedKg + rowKg);

    return {
      number: row.number,
      units,
      assignedKg: rowKg,
      estimatedKg,
      differenceKg,
      missingKg: differenceKg < 0 ? roundSheetValue(-differenceKg) : 0,
      excessKg: differenceKg > 0 ? differenceKg : 0,
      cells,
    };
  });

  return {
    marmitas: marmitaTotals,
    presentations: presentationTotals,
    totalUnits,
    assignedKg,
  };
}
