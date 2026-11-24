import {describe, expect, it} from 'vitest';
import {
  normalizeManualSheetIngredientQuantity,
  resolveManualSheetIngredientMaterial,
} from './manual-sheet-ingredients';

const materials = [
  {id: 'rm-3', code: 'MP-QUI-01', name: 'Pectina Cítrica HM'},
  {id: 'rm-30', code: 'MP-QUI-09', name: 'Goma Xantana'},
  {id: 'rm-31', code: 'MP-ADI-09', name: 'Almidón de Arrurruz', unit: 'g'},
];

describe('resolveManualSheetIngredientMaterial', () => {
  it('respeta el insumo elegido por el usuario', () => {
    const selected = resolveManualSheetIngredientMaterial(
      materials,
      'chemicalG',
      'rm-30'
    );
    expect(selected?.id).toBe('rm-30');
  });

  it('usa el insumo histórico cuando no hay selección', () => {
    const selected = resolveManualSheetIngredientMaterial(materials, 'chemicalG');
    expect(selected?.id).toBe('rm-3');
  });

  it('ignora una selección inexistente y aplica el fallback', () => {
    const selected = resolveManualSheetIngredientMaterial(
      materials,
      'chemicalG',
      'no-existe'
    );
    expect(selected?.id).toBe('rm-3');
  });
});

describe('normalizeManualSheetIngredientQuantity', () => {
  it('convierte gramos capturados a kilos del insumo', () => {
    expect(normalizeManualSheetIngredientQuantity('chemicalG', 500, 'kg')).toBe(0.5);
  });

  it('convierte kilos capturados a gramos del insumo', () => {
    expect(normalizeManualSheetIngredientQuantity('starchKg', 2, 'g')).toBe(2000);
  });

  it('respeta la unidad cuando coincide', () => {
    expect(normalizeManualSheetIngredientQuantity('acidG', 30, 'g')).toBe(30);
    expect(normalizeManualSheetIngredientQuantity('starchKg', 2, 'kg')).toBe(2);
  });
});
