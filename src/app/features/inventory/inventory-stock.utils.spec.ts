import {describe, expect, it} from 'vitest';
import {InventoryMovement, RawMaterial} from '../../core/models/erp.models';
import {
  buildStockConsolidation,
  validateMovementReference,
} from './inventory-stock.utils';

describe('Validación de referencia de movimientos de inventario', () => {
  it('permite una nota sin factura en una entrada de contado', () => {
    expect(
      validateMovementReference({
        type: 'entrada',
        paymentCondition: 'contado',
        referenceDoc: 'NOTA-0001',
        supplierId: '',
      })
    ).toBe('ok');
  });

  it('exige proveedor y documento en una compra a crédito', () => {
    const base = {
      type: 'entrada' as const,
      paymentCondition: 'credito' as const,
      referenceDoc: 'F-310',
      supplierId: 'PROV-0001',
    };
    expect(validateMovementReference(base)).toBe('ok');
    expect(validateMovementReference({...base, supplierId: ''})).toBe(
      'missing-credit-reference'
    );
    expect(validateMovementReference({...base, referenceDoc: '  '})).toBe(
      'missing-credit-reference'
    );
  });

  it('no aplica la regla a salidas ni ajustes', () => {
    expect(
      validateMovementReference({
        type: 'ajuste_merma',
        paymentCondition: 'credito',
        referenceDoc: '',
        supplierId: '',
      })
    ).toBe('ok');
  });
});

function material(
  id: string,
  code: string,
  name: string,
  category: string,
  currentStock: number,
  unit: RawMaterial['unit'],
  costPerUnit = 1
): RawMaterial {
  return {
    id,
    code,
    name,
    category,
    currentStock,
    minStock: 0,
    unit,
    costPerUnit,
    lastRestockDate: '2026-11-01',
  };
}

function movement(
  id: string,
  materialId: string,
  date: string,
  type: InventoryMovement['type'] = 'entrada'
): InventoryMovement {
  return {
    id,
    materialId,
    materialName: materialId,
    type,
    quantity: 1,
    costPerUnit: 1,
    totalCost: 1,
    exchangeRateUsed: 48.35,
    date,
    performedBy: 'prueba',
  };
}

describe('Consolidado del Reporte Oficial', () => {
  const todayIso = '2026-11-23';
  const categoryLabel = (code: string) => `Etiqueta ${code}`;

  it('consolida el maestro completo aunque existan filtros activos en la tabla', () => {
    const result = buildStockConsolidation({
      materials: [
        material('m1', 'MP-001', 'Almidón', 'aditivo', 10, 'kg'),
        material('m2', 'MP-002', 'Pectina', 'quimico', 2, 'kg'),
        material('m3', 'MP-003', 'Frasco 300g', 'envases', 100, 'unidades', 0.5),
      ],
      movements: [],
      exchangeRate: 48,
      todayIso,
      categoryLabel,
    });

    expect(result.byMaterial).toHaveLength(3);
    expect(result.byGroup.map((group) => group.key)).toEqual(['aditivo', 'quimico', 'envases']);
    expect(result.byGroup[0].label).toBe('Etiqueta aditivo');
  });

  it('convierte gramos a kilos y valora todas las unidades con la tasa vigente', () => {
    const result = buildStockConsolidation({
      materials: [
        material('m1', 'MP-001', 'Azúcar', 'aditivo', 1500, 'g', 2),
        material('m2', 'MP-002', 'Caja 6kg', 'cajas', 20, 'unidades', 5),
      ],
      movements: [],
      exchangeRate: 50,
      todayIso,
      categoryLabel,
    });

    expect(result.byMaterial[0].stockKg).toBe(1.5);
    expect(result.byMaterial[1].stockKg).toBe(0);
    expect(result.byMaterial[0].valueUsd).toBe(3000);
    expect(result.byMaterial[0].valueBs).toBe(150000);
    expect(result.totalKg).toBe(1.5);
    expect(result.totalUsd).toBe(3100);
  });

  it('mantiene la agrupación especial de Guayaba y el último movimiento', () => {
    const result = buildStockConsolidation({
      materials: [
        material('m1', 'MP-FRU-01', 'Guayaba Roja', 'fruta', 8, 'kg', 2),
        material('m2', 'MP-002', 'Otra fruta', 'fruta', 3, 'kg', 1),
      ],
      movements: [
        movement('mv1', 'm1', '2026-11-20'),
        movement('mv2', 'm1', '2026-11-22', 'ajuste_merma'),
      ],
      exchangeRate: 48.35,
      todayIso,
      categoryLabel,
    });

    expect(result.byGroup.map((group) => group.key)).toEqual(['guayaba', 'fruta']);
    expect(result.byGroup[0].label).toBe('Guayaba');
    expect(result.byMaterial[0].lastMovement?.id).toBe('mv2');
    expect(result.byMaterial[0].movementCount).toBe(2);
    expect(result.byMaterial[0].recent).toBe(true);
    expect(result.byMaterial[1].recent).toBe(false);
  });
});
