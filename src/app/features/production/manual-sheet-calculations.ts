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
