import {InventoryMovement, RawMaterial} from '../../core/models/erp.models';

/** Normaliza texto para búsquedas tolerantes a mayúsculas y tildes. */
export function normalizeSearchText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();
}

export interface MaterialFilterOptions {
  search: string;
  category: string;
  categoryLabels?: Record<string, string>;
}

/** Filtra insumos por texto (código, nombre, proveedor, categoría) y categoría activa. */
export function filterMaterials(
  materials: RawMaterial[],
  options: MaterialFilterOptions
): RawMaterial[] {
  const term = normalizeSearchText(options.search);
  const category = options.category || 'all';

  return materials.filter((material) => {
    if (category === 'alertas') {
      if (material.currentStock > material.minStock) return false;
    } else if (category !== 'all' && material.category !== category) {
      return false;
    }
    if (!term) return true;

    const haystack = [
      material.code,
      material.name,
      material.supplier,
      material.category,
      options.categoryLabels?.[material.category],
    ]
      .filter(Boolean)
      .map((value) => normalizeSearchText(String(value)))
      .join(' ');

    return haystack.includes(term);
  });
}

export type MovementTypeFilter = 'all' | InventoryMovement['type'];

export interface MovementFilterOptions {
  search: string;
  materialId: string;
  type: MovementTypeFilter;
  dateFrom: string;
  dateTo: string;
}

/** Filtra movimientos por insumo, tipo, rango de fechas y texto libre. */
export function filterMovements(
  movements: InventoryMovement[],
  options: MovementFilterOptions
): InventoryMovement[] {
  const term = normalizeSearchText(options.search);
  const materialId = options.materialId || 'all';
  const type = options.type || 'all';
  const dateFrom = options.dateFrom || '';
  const dateTo = options.dateTo || '';

  return movements.filter((movement) => {
    if (materialId !== 'all' && movement.materialId !== materialId) return false;
    if (type !== 'all' && movement.type !== type) return false;
    if (dateFrom && movement.date < dateFrom) return false;
    if (dateTo && movement.date > dateTo) return false;
    if (!term) return true;

    return [
      movement.materialName,
      movement.referenceDoc,
      movement.performedBy,
      movement.type,
      movement.notes,
    ]
      .filter(Boolean)
      .map((value) => normalizeSearchText(String(value)))
      .join(' ')
      .includes(term);
  });
}

export interface MaterialMovementSummary {
  materialId: string;
  materialName: string;
  entradas: number;
  salidas: number;
  ajustes: number;
  netQuantity: number;
  totalUsd: number;
  totalBs: number;
  movementCount: number;
}

const round = (value: number): number => Number(value.toFixed(2));

/** Resumen de entradas, salidas y ajustes por insumo. */
export function summarizeMovementsByMaterial(
  movements: InventoryMovement[]
): MaterialMovementSummary[] {
  const byMaterial = new Map<string, MaterialMovementSummary>();

  for (const movement of movements) {
    let summary = byMaterial.get(movement.materialId);
    if (!summary) {
      summary = {
        materialId: movement.materialId,
        materialName: movement.materialName,
        entradas: 0,
        salidas: 0,
        ajustes: 0,
        netQuantity: 0,
        totalUsd: 0,
        totalBs: 0,
        movementCount: 0,
      };
      byMaterial.set(movement.materialId, summary);
    }
    const quantity = Number(movement.quantity) || 0;
    summary.movementCount += 1;
    summary.totalUsd = round(summary.totalUsd + (Number(movement.totalCost) || 0));
    summary.totalBs = round(
      summary.totalBs +
        (Number(movement.totalCostBs) ||
          Number(movement.totalCost) * Number(movement.exchangeRateUsed || 0) ||
          0)
    );
    if (movement.type === 'entrada') {
      summary.entradas = round(summary.entradas + quantity);
      summary.netQuantity = round(summary.netQuantity + quantity);
    } else if (movement.type === 'salida_produccion') {
      summary.salidas = round(summary.salidas + quantity);
      summary.netQuantity = round(summary.netQuantity - quantity);
    } else {
      summary.ajustes = round(summary.ajustes + quantity);
      summary.netQuantity = round(summary.netQuantity - quantity);
    }
  }

  return [...byMaterial.values()].sort((a, b) =>
    a.materialName.localeCompare(b.materialName, 'es')
  );
}
