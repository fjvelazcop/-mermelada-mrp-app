import {InventoryMovement, RawMaterial} from '../../core/models/erp.models';
import {
  filterMaterials,
  filterMovements,
  movementPaymentLabel,
  normalizeSearchText,
  summarizeMovementsByMaterial,
} from './inventory.filters';

function makeMaterial(overrides: Partial<RawMaterial> = {}): RawMaterial {
  return {
    id: 'rm-1',
    code: 'MP-101',
    name: 'Guayaba fresca',
    category: 'fruta',
    currentStock: 100,
    minStock: 20,
    unit: 'kg',
    costPerUnit: 1.2,
    supplier: 'Frutas del Valle',
    lastRestockDate: '2026-01-01',
    ...overrides,
  };
}

function makeMovement(overrides: Partial<InventoryMovement> = {}): InventoryMovement {
  return {
    id: 'mov-1',
    materialId: 'rm-1',
    materialName: 'Guayaba fresca',
    type: 'entrada',
    quantity: 10,
    costPerUnit: 1.2,
    totalCost: 12,
    exchangeRateUsed: 50,
    totalCostBs: 600,
    referenceDoc: 'F-123',
    date: '2026-01-10',
    performedBy: 'admin',
    ...overrides,
  };
}

describe('normalizeSearchText', () => {
  it('ignora mayúsculas, tildes y espacios extremos', () => {
    expect(normalizeSearchText('  GUAYABA FRESCA  ')).toBe('guayaba fresca');
    expect(normalizeSearchText('Ácido Cítrico')).toBe('acido citrico');
  });
});

describe('filterMaterials', () => {
  const materials = [
    makeMaterial(),
    makeMaterial({id: 'rm-2', code: 'MP-102', name: 'Ácido cítrico', category: 'quimico', supplier: 'Quimicos SA'}),
    makeMaterial({
      id: 'rm-3',
      code: 'MP-103',
      name: 'Frasco 250g',
      category: 'empaque',
      currentStock: 5,
      minStock: 20,
      supplier: 'Envases del Centro',
    }),
  ];

  it('busca por código, nombre con tilde y proveedor', () => {
    expect(filterMaterials(materials, {search: 'mp-10', category: 'all'}).length).toBe(3);
    expect(filterMaterials(materials, {search: 'acido', category: 'all'}).map((m) => m.id)).toEqual(['rm-2']);
    expect(filterMaterials(materials, {search: 'QUIMICOS', category: 'all'}).map((m) => m.id)).toEqual(['rm-2']);
  });

  it('combina categoría y búsqueda', () => {
    const result = filterMaterials(materials, {search: 'guayaba', category: 'fruta'});
    expect(result.map((m) => m.id)).toEqual(['rm-1']);
    expect(filterMaterials(materials, {search: 'guayaba', category: 'quimico'})).toEqual([]);
  });

  it('respeta la categoría alertas y la etiqueta configurada', () => {
    expect(
      filterMaterials(materials, {search: '', category: 'alertas'}).map((m) => m.id)
    ).toEqual(['rm-3']);
    expect(
      filterMaterials(materials, {
        search: 'frutas',
        category: 'all',
        categoryLabels: {fruta: 'Frutas y Pulpas'},
      }).map((m) => m.id)
    ).toEqual(['rm-1']);
  });

  it('devuelve todos con búsqueda vacía y categoría all', () => {
    expect(filterMaterials(materials, {search: '', category: 'all'})).toEqual(materials);
  });
});

describe('filterMovements', () => {
  const movements = [
    makeMovement(),
    makeMovement({
      id: 'mov-2',
      materialId: 'rm-2',
      materialName: 'Ácido cítrico',
      type: 'salida_produccion',
      date: '2026-02-02',
      referenceDoc: 'L-77',
      notes: 'Lote 72',
    }),
    makeMovement({
      id: 'mov-3',
      materialId: 'rm-1',
      type: 'ajuste_merma',
      date: '2026-03-03',
      referenceDoc: 'AJ-9',
    }),
  ];

  it('filtra por insumo, tipo y rango de fechas', () => {
    expect(
      filterMovements(movements, {search: '', materialId: 'rm-1', type: 'all', dateFrom: '', dateTo: ''}).length
    ).toBe(2);
    expect(
      filterMovements(movements, {
        search: '',
        materialId: 'all',
        type: 'salida_produccion',
        dateFrom: '2026-02-01',
        dateTo: '2026-02-28',
      }).map((m) => m.id)
    ).toEqual(['mov-2']);
  });

  it('busca en notas, referencia y responsable sin tildes', () => {
    expect(
      filterMovements(movements, {search: 'lote 72', materialId: 'all', type: 'all', dateFrom: '', dateTo: ''}).map((m) => m.id)
    ).toEqual(['mov-2']);
    expect(
      filterMovements(movements, {search: 'f-123', materialId: 'all', type: 'all', dateFrom: '', dateTo: ''}).map((m) => m.id)
    ).toEqual(['mov-1']);
  });
});

describe('summarizeMovementsByMaterial', () => {
  it('separa entradas, salidas y ajustes y calcula el neto', () => {
    const summary = summarizeMovementsByMaterial([
      makeMovement({quantity: 10, totalCost: 12, totalCostBs: 600}),
      makeMovement({id: 'mov-2', type: 'salida_produccion', quantity: 3, totalCost: 3.6, totalCostBs: 180}),
      makeMovement({id: 'mov-3', type: 'ajuste_merma', quantity: 1, totalCost: 1.2, totalCostBs: 60}),
    ]);

    expect(summary.length).toBe(1);
    expect(summary[0].entradas).toBe(10);
    expect(summary[0].salidas).toBe(3);
    expect(summary[0].ajustes).toBe(1);
    expect(summary[0].netQuantity).toBe(6);
    expect(summary[0].totalUsd).toBe(16.8);
    expect(summary[0].totalBs).toBe(840);
    expect(summary[0].movementCount).toBe(3);
  });
});

describe('movementPaymentLabel', () => {
  it('muestra contado con banco y referencia, crédito con CxP y vencimiento, y legacy sin inventar datos', () => {
    expect(
      movementPaymentLabel(
        makeMovement({
          paymentCondition: 'contado',
          bankCode: '0134',
          paymentReference: 'TRANSF-889',
        })
      )
    ).toEqual({
      conditionLabel: 'Contado',
      conditionTone: 'cash',
      payableLabel: null,
      paymentDetail: 'Banco 0134 · Ref. TRANSF-889',
      dueDateLabel: null,
    });

    expect(
      movementPaymentLabel(
        makeMovement({
          paymentCondition: 'credito',
          payableNumber: 'FAP-2026-011',
          dueDate: '2026-12-17',
        })
      )
    ).toMatchObject({
      conditionLabel: 'Crédito',
      conditionTone: 'credit',
      payableLabel: 'CxP FAP-2026-011',
      dueDateLabel: '2026-12-17',
    });

    expect(movementPaymentLabel(makeMovement())).toMatchObject({
      conditionLabel: 'Contado (legacy)',
      conditionTone: 'legacy',
      payableLabel: null,
    });
    expect(movementPaymentLabel(makeMovement({paymentCondition: 'credito'})).payableLabel).toBe(
      'CxP pendiente'
    );
  });

  it('busca movimientos por CxP, referencia de pago o banco', () => {
    const movements = [
      makeMovement({paymentCondition: 'credito', payableNumber: 'FAP-2026-011'}),
      makeMovement({id: 'mov-2', paymentReference: 'TRANSF-889'}),
      makeMovement({id: 'mov-3', bankCode: '0134'}),
    ];
    const options = {
      search: '',
      materialId: 'all',
      type: 'all' as const,
      dateFrom: '',
      dateTo: '',
    };

    expect(filterMovements(movements, {...options, search: 'FAP-2026-011'})).toHaveLength(1);
    expect(filterMovements(movements, {...options, search: 'transf-889'})).toHaveLength(1);
    expect(filterMovements(movements, {...options, search: '0134'})).toHaveLength(1);
  });
});
