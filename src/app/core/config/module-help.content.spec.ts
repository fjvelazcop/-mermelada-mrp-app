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

  it('devuelve el contenido genérico para claves no registradas', () => {
    expect(getModuleHelp('modulo_inexistente' as ModuleHelpKey)).toBe(GENERIC_MODULE_HELP);
  });
});
