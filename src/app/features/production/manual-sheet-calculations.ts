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
