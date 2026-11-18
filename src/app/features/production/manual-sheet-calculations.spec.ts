import {
  DEFAULT_SHEET_YIELD_PERCENT,
  calculateIngredientMassKg,
  calculateMarmitaPresentationUnits,
  calculateObtainedUnits,
  calculateObtainedUnitsFromIngredients,
  calculatePackagingEstimate,
  calculatePresentationsEstimate,
  calculateTotalKgFromIngredients,
  normalizePresentationUnits,
  requiresManualPresentationUnits,
  sumPresentationUnits,
} from './manual-sheet-calculations';

describe('manual sheet calculations', () => {
  describe('calculateIngredientMassKg', () => {
    it('adds kilos and converts chemical grams to kilos', () => {
      expect(
        calculateIngredientMassKg({
          guavaKg: 60,
          sugarKg: 52,
          starchKg: 1,
          chemicalG: 520,
          acidG: 240,
        })
      ).toBe(113.76);
    });

    it('ignores missing or negative values', () => {
      expect(
        calculateIngredientMassKg({
          guavaKg: -5,
          sugarKg: 10,
          starchKg: 0,
          chemicalG: Number.NaN,
          acidG: 0,
        })
      ).toBe(10);
    });
  });

  describe('calculateTotalKgFromIngredients', () => {
    it('applies the configured yield to the ingredient mass', () => {
      expect(
        calculateTotalKgFromIngredients(
          {
            guavaKg: 60,
            sugarKg: 52,
            starchKg: 0,
            chemicalG: 520,
            acidG: 240,
          },
          88.6
        )
      ).toBe(99.91);
    });

    it('uses the BOM default when the yield is missing', () => {
      const input = {
        guavaKg: 10,
        sugarKg: 10,
        starchKg: 0,
        chemicalG: 0,
        acidG: 0,
      };
      expect(calculateTotalKgFromIngredients(input, 0)).toBe(
        Number((20 * (DEFAULT_SHEET_YIELD_PERCENT / 100)).toFixed(2))
      );
    });

    it('derives units from ingredients, yield and presentation', () => {
      expect(
        calculateObtainedUnitsFromIngredients(
          {
            guavaKg: 60,
            sugarKg: 52,
            starchKg: 0,
            chemicalG: 520,
            acidG: 240,
          },
          88.6,
          20
        )
      ).toBe(5);
    });
  });

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

  describe('multiple presentations', () => {
    const lines = [
      { id: 'p250', presentationKg: 0.25 },
      { id: 'g5', presentationKg: 5 },
    ];

    it('requires manual units only when more than one presentation exists', () => {
      expect(requiresManualPresentationUnits([lines[0]])).toBe(false);
      expect(requiresManualPresentationUnits(lines)).toBe(true);
      expect(requiresManualPresentationUnits([])).toBe(false);
    });

    it('calculates a single presentation automatically from kilos', () => {
      expect(
        calculateMarmitaPresentationUnits(10, [lines[0]], [
          { presentationId: 'p250', units: 999 },
        ])
      ).toEqual([{ presentationId: 'p250', units: 40 }]);
    });

    it('keeps the manual distribution for several presentations', () => {
      const units = calculateMarmitaPresentationUnits(10, lines, [
        { presentationId: 'p250', units: 12 },
        { presentationId: 'g5', units: 1.4 },
      ]);

      expect(units).toEqual([
        { presentationId: 'p250', units: 12 },
        { presentationId: 'g5', units: 1.4 },
      ]);
      expect(sumPresentationUnits(units)).toBe(13.4);
    });

    it('fills missing presentations with zero and discards unknown ids', () => {
      expect(
        normalizePresentationUnits(
          [
            { presentationId: 'g5', units: 2 },
            { presentationId: 'unknown', units: 7 },
            { presentationId: 'g5', units: -1 },
          ],
          lines
        )
      ).toEqual([
        { presentationId: 'p250', units: 0 },
        { presentationId: 'g5', units: 0 },
      ]);
    });

    it('summarises assigned kilos per presentation against captured kilos', () => {
      const estimate = calculatePresentationsEstimate(20, [
        { id: 'p250', presentationKg: 0.25, units: 40 },
        { id: 'g5', presentationKg: 5, units: 2 },
      ]);

      expect(estimate).toHaveLength(2);
      expect(estimate[0].assignedKg).toBe(10);
      expect(estimate[1].assignedKg).toBe(10);
      expect(estimate.reduce((sum, line) => sum + line.assignedKg, 0)).toBe(20);
      expect(estimate[0].estimatedUnits).toBe(80);
      expect(estimate[0].missingUnits).toBe(40);
    });
  });
});
