import {describe, expect, it} from 'vitest';
import {
  GENERIC_MODULE_HELP,
  MODULE_HELP,
  ModuleHelpKey,
  getModuleHelp,
} from './module-help.content';

describe('Contenido de ayuda por módulo', () => {
  it('declara título, resumen y secciones no vacías para cada módulo', () => {
    const keys = Object.keys(MODULE_HELP) as ModuleHelpKey[];
    expect(keys.length).toBeGreaterThan(10);

    for (const key of keys) {
      const content = MODULE_HELP[key];
      expect(content.title, key).not.toBe('');
      expect(content.summary, key).not.toBe('');
      expect(content.sections.length, key).toBeGreaterThan(0);
      for (const section of content.sections) {
        expect(section.title, key).not.toBe('');
        expect(section.bullets.length, key).toBeGreaterThan(0);
        expect(section.bullets.every((bullet) => bullet.trim().length > 0), key).toBe(true);
      }
    }
  });

  it('documenta el simulador de costos sin usar el texto eliminado del encabezado', () => {
    const costing = MODULE_HELP.costing;
    const text = JSON.stringify(costing);
    expect(text).not.toContain('Hoja de Excel');
    expect(text).not.toContain('Hoja Excel');
    expect(text).toContain('Preset Img 2');
    expect(text).toContain('Lote 72');
    expect(text).toContain('costing.canExport');
  });

  it('documenta la carga de histórico ISLR y los soportes #13 sin activar módulos', () => {
    const text = JSON.stringify(MODULE_HELP.fiscal_reference_values);
    expect(text).toContain('ISLR');
    expect(text).toContain('sustraendos');
    expect(text).toContain('Paginación 1 al 99');
    expect(text).toContain('no modifica cálculos');
    expect(text).toContain('régimen ordinario/no SPE está adoptado');
  });

  it('documenta los iconos, la doble fecha y los precios en la ayuda de inventario', () => {
    const text = JSON.stringify(MODULE_HELP.inventory);
    expect(text).toContain('Editar ficha del insumo');
    expect(text).toContain('Ver movimientos del insumo');
    expect(text).toContain('Registrar entrada o ajuste');
    expect(text).toContain('Fijar existencia física (solo bitácora)');
    expect(text).toContain('tooltip');
    expect(text).toContain('fecha del movimiento');
    expect(text).toContain('fecha real de registro');
    expect(text).toContain('Actualizar precios');
    expect(text).toContain('costo base permanece intacto');
    expect(text).toContain('no modifica totales ni exportes');
    expect(text).not.toContain('Preparar producto nuevo');
  });

  it('mantiene la nota del cierre #13 de forma uniforme en todos los módulos que la mencionan', () => {
    const note =
      'El cierre #13 continúa en BORRADOR/PRUEBA – PROVISIONAL – PENDIENTE DE VALIDACIÓN CONTABLE; no activar SENIAT, v17 fiscal, retenciones ni facturación digital.';
    for (const content of Object.values(MODULE_HELP)) {
      const text = JSON.stringify(content);
      if (text.includes('cierre #13')) expect(text).toContain(note);
    }
  });

  it('devuelve el contenido genérico para claves no registradas', () => {
    expect(getModuleHelp('modulo_inexistente' as ModuleHelpKey)).toBe(GENERIC_MODULE_HELP);
  });
});
