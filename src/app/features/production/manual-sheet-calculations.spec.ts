import {
  calculateObtainedUnits,
  calculatePackagingEstimate,
} from './manual-sheet-calculations';

describe('manual sheet calculations', () => {
  describe('calculateObtainedUnits', () => {
    it('derives units from kilos totales and presentation', () => {
      expect(calculateObtainedUnits(120, 20)).toBe(6);
      expect(calculateObtainedUnits(7, 20)).toBe(0.35);
    });

    it('returns zero for missing or invalid inputs', () => {
      expect(calculateObtainedUnits(0, 20)).toBe(0);
      expect(calculateObtainedUnits(-5, 20)).toBe(0);
      expect(calculateObtainedUnits(10, 0)).toBe(0);
      expect(calculateObtainedUnits(Number.NaN, 20)).toBe(0);
    });
  });

  describe('calculatePackagingEstimate', () => {
    it('calculates each product independently when both are used', () => {
      const estimate = calculatePackagingEstimate(200, 20, 6, 4);

      expect(estimate.estimatedUnits).toBe(10);
      expect(estimate.assignedUnits).toBe(10);
      expect(estimate.difference).toBe(0);
      expect(estimate.cunetesKg).toBe(120);
      expect(estimate.cajasKg).toBe(80);
    });

    it('works with a single product', () => {
      const estimate = calculatePackagingEstimate(200, 20, 10, 0);

      expect(estimate.assignedUnits).toBe(10);
      expect(estimate.difference).toBe(0);
      expect(estimate.cajasKg).toBe(0);
    });

    it('reports missing units when the packaging assignment is short', () => {
      const estimate = calculatePackagingEstimate(200, 20, 1, 0);

      expect(estimate.missingUnits).toBe(9);
      expect(estimate.excessUnits).toBe(0);
    });

    it('reports excess units across several products', () => {
      const estimate = calculatePackagingEstimate(200, 20, 8, 3);

      expect(estimate.excessUnits).toBe(1);
      expect(estimate.missingUnits).toBe(0);
    });

    it('does not estimate units without a valid presentation', () => {
      const estimate = calculatePackagingEstimate(200, 0, 3, 2);

      expect(estimate.estimatedUnits).toBe(0);
      expect(estimate.assignedUnits).toBe(5);
      expect(estimate.excessUnits).toBe(5);
    });
  });
});
