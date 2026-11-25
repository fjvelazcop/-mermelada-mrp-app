import {InventoryMovement, RawMaterial} from '../../core/models/erp.models';
import {normalizeSearchText} from './inventory.filters';

export type MovementReferenceValidation =
  | 'ok'
  | 'missing-credit-reference';

export interface MovementReferenceInput {
  type: 'entrada' | 'salida_produccion' | 'ajuste_merma';
  paymentCondition?: 'contado' | 'credito';
  referenceDoc?: string;
  supplierId?: string;
}

/**
 * Solo las compras a crédito exigen proveedor y documento. Una entrada de
 * contado puede estar respaldada por una nota sin factura: se conserva el
 * número en `referenceDoc` sin forzar un proveedor del maestro.
 */
export function validateMovementReference(
  input: MovementReferenceInput
): MovementReferenceValidation {
  if (input.type !== 'entrada' || input.paymentCondition !== 'credito') return 'ok';
  const hasReference = Boolean(input.referenceDoc?.trim());
  const hasSupplier = Boolean(input.supplierId?.trim());
  return hasReference && hasSupplier ? 'ok' : 'missing-credit-reference';
}

export interface StockConsolidationRow {
  material: RawMaterial;
  stockKg: number;
  valueUsd: number;
  valueBs: number;
  movementCount: number;
  lastMovement?: InventoryMovement;
  recent: boolean;
}

export interface StockConsolidationGroup {
  key: string;
  label: string;
  materialCount: number;
  stockKg: number;
  valueUsd: number;
  valueBs: number;
}

export interface StockConsolidation {
  byMaterial: StockConsolidationRow[];
  byGroup: StockConsolidationGroup[];
  totalKg: number;
  totalUsd: number;
  totalBs: number;
}

export interface StockConsolidationInput {
  /** Maestro completo: el reporte oficial no depende de los filtros de la tabla. */
  materials: RawMaterial[];
  movements: InventoryMovement[];
  exchangeRate: number;
  todayIso: string;
  categoryLabel: (code: string) => string;
}

/**
 * Consolida existencias y valoración desde el maestro completo de insumos.
 * Solo `kg`/`g` aportan kilos; todas las unidades aportan valoración.
 */
export function buildStockConsolidation(
  input: StockConsolidationInput
): StockConsolidation {
  const today = new Date(`${input.todayIso}T00:00:00`);
  const byMaterial: StockConsolidationRow[] = input.materials.map((material) => {
    const materialMovements = input.movements
      .filter((movement) => movement.materialId === material.id)
      .sort((a, b) =>
        (b.movementDate || b.date).localeCompare(a.movementDate || a.date)
      );
    const lastMovement = materialMovements[0];
    const daysSince = lastMovement
      ? Math.floor(
          (today.getTime() - new Date(`${lastMovement.movementDate || lastMovement.date}T00:00:00`).getTime()) /
            86_400_000
        )
      : Number.POSITIVE_INFINITY;
    const kg =
      material.unit === 'kg'
        ? material.currentStock
        : material.unit === 'g'
          ? material.currentStock / 1000
          : 0;
    return {
      material,
      stockKg: Number(kg.toFixed(2)),
      valueUsd: Number((material.currentStock * material.costPerUnit).toFixed(2)),
      valueBs: Number(
        (material.currentStock * material.costPerUnit * input.exchangeRate).toFixed(2)
      ),
      movementCount: materialMovements.length,
      lastMovement,
      recent: daysSince >= 0 && daysSince <= 7,
    };
  });

  return buildConsolidationResult(byMaterial, input.categoryLabel);
}

/** Agrupa filas ya consolidadas, conservando la regla especial de Guayaba. */
function buildConsolidationResult(
  byMaterial: StockConsolidationRow[],
  categoryLabel: (code: string) => string
): StockConsolidation {
  const groups = new Map<string, StockConsolidationGroup>();
  for (const row of byMaterial) {
    const name = row.material.name.toLowerCase();
    const isGuava = name.includes('guayaba') || row.material.code === 'MP-FRU-01';
    const key = isGuava ? 'guayaba' : row.material.category;
    const label = isGuava ? 'Guayaba' : categoryLabel(row.material.category);
    const group =
      groups.get(key) || {
        key,
        label,
        materialCount: 0,
        stockKg: 0,
        valueUsd: 0,
        valueBs: 0,
      };
    group.materialCount += 1;
    group.stockKg += row.stockKg;
    group.valueUsd += row.valueUsd;
    group.valueBs += row.valueBs;
    groups.set(key, group);
  }

  const byGroup = [...groups.values()]
    .map((group) => ({
      ...group,
      stockKg: Number(group.stockKg.toFixed(2)),
      valueUsd: Number(group.valueUsd.toFixed(2)),
      valueBs: Number(group.valueBs.toFixed(2)),
    }))
    .sort((a, b) => b.stockKg - a.stockKg);

  return {
    byMaterial,
    byGroup,
    totalKg: Number(byMaterial.reduce((sum, row) => sum + row.stockKg, 0).toFixed(2)),
    totalUsd: Number(byMaterial.reduce((sum, row) => sum + row.valueUsd, 0).toFixed(2)),
    totalBs: Number(byMaterial.reduce((sum, row) => sum + row.valueBs, 0).toFixed(2)),
  };
}

/**
 * Filtro visual del reporte: localiza insumos por nombre, código, categoría o
 * etiqueta sin alterar los totales globales ni los exportes del Reporte Oficial.
 */
export function filterStockConsolidation(
  consolidation: StockConsolidation,
  options: { search: string; categoryLabel: (code: string) => string }
): StockConsolidation {
  const term = normalizeSearchText(options.search);
  if (!term) return consolidation;

  const byMaterial = consolidation.byMaterial.filter((row) => {
    const haystack = [
      row.material.code,
      row.material.name,
      row.material.category,
      options.categoryLabel(row.material.category),
    ]
      .filter(Boolean)
      .map((value) => normalizeSearchText(String(value)))
      .join(' ');
    return haystack.includes(term);
  });

  return {
    ...buildConsolidationResult(byMaterial, options.categoryLabel),
    totalKg: consolidation.totalKg,
    totalUsd: consolidation.totalUsd,
    totalBs: consolidation.totalBs,
  };
}
