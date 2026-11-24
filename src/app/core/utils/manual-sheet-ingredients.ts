/**
 * Resolución de insumos de la planilla manual de marmitas.
 *
 * El cliente y el servidor deben elegir el mismo insumo para almidón, químico y
 * ácido: primero el seleccionado por el usuario y, si no hay selección, el
 * insumo sembrado histórico. La conversión evita mezclar gramos y kilos.
 */

export type ManualSheetIngredientKey = 'starchKg' | 'chemicalG' | 'acidG';

export type ManualSheetIngredientMaterialIds = Partial<
  Record<ManualSheetIngredientKey, string>
>;

interface IngredientFallback {
  ids: string[];
  codes: string[];
  pattern: RegExp;
}

export const MANUAL_SHEET_INGREDIENT_FALLBACKS: Record<
  ManualSheetIngredientKey,
  IngredientFallback
> = {
  starchKg: {
    ids: ['rm-20'],
    codes: ['MP-ADI-02'],
    pattern: /almid[oó]n/i,
  },
  chemicalG: {
    ids: ['rm-3'],
    codes: ['MP-QUI-01'],
    pattern: /pectina/i,
  },
  acidG: {
    ids: ['rm-4'],
    codes: ['MP-QUI-02'],
    pattern: /[aá]cido c[ií]trico/i,
  },
};

/** Insumo elegido por el usuario o, en su defecto, el insumo histórico. */
export function resolveManualSheetIngredientMaterial<
  T extends { id: string; code: string; name: string },
>(
  materials: T[],
  key: ManualSheetIngredientKey,
  selectedId?: string
): T | undefined {
  if (selectedId) {
    const selected = materials.find((material) => material.id === selectedId);
    if (selected) return selected;
  }
  const fallback = MANUAL_SHEET_INGREDIENT_FALLBACKS[key];
  return materials.find(
    (material) =>
      fallback.ids.includes(material.id) ||
      fallback.codes.includes(material.code) ||
      fallback.pattern.test(material.name)
  );
}

/**
 * Cantidad expresada en la unidad del insumo. La planilla captura almidón en kg
 * y químico/ácido en g, pero el maestro puede tenerlos en la unidad opuesta.
 */
export function normalizeManualSheetIngredientQuantity(
  key: ManualSheetIngredientKey,
  quantity: number,
  unit: string
): number {
  const safe = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  if (key === 'chemicalG' || key === 'acidG') {
    return unit === 'kg' ? safe / 1000 : safe;
  }
  return unit === 'g' ? safe * 1000 : safe;
}
