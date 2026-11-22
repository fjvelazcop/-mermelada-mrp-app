import {describe, expect, it} from 'vitest';
import {isValidTaxId, normalizeTaxId, sameTaxId} from './tax-id.utils';

describe('tax-id.utils', () => {
  it('normalizes RIF and cédula separators', () => {
    expect(normalizeTaxId('j-31.849.201-4')).toBe('J-31849201-4');
    expect(normalizeTaxId('V 18.490.231')).toBe('V-18490231');
    expect(normalizeTaxId('g123456789')).toBe('G-12345678-9');
  });

  it('validates only supported Venezuelan prefixes', () => {
    expect(isValidTaxId('J-31849201-4')).toBe(true);
    expect(isValidTaxId('v-18490231')).toBe(true);
    expect(isValidTaxId('X-12345678')).toBe(false);
    expect(isValidTaxId('J-12')).toBe(false);
  });

  it('detects duplicates regardless of formatting', () => {
    expect(sameTaxId('J-31849201-4', 'j 31.849.201-4')).toBe(true);
    expect(sameTaxId('J-31849201-4', 'V-18490231')).toBe(false);
  });
});
