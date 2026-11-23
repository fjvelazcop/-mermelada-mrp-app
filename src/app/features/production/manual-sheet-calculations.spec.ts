import {
  DEFAULT_SHEET_YIELD_PERCENT,
  calculateIngredientMassKg,
  calculateMarmitaPresentationUnits,
  calculateMermaKg,
  calculateObtainedUnits,
  calculateObtainedUnitsFromIngredients,
  calculatePackagingEstimate,
  calculatePresentationsEstimate,
  calculateSheetMerma,
  calculateSheetMatrixTotals,
  calculateTotalKgFromIngredients,
  describeTotalKgCalculation,
  normalizePresentationUnits,
  reconcileSheet,
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

  describe('merma', () => {
    const inputs = {
      guavaKg: 60,
      sugarKg: 40,
      starchKg: 1,
      chemicalG: 500,
      acidG: 200,
      // Gasoil/agua is process consumption and must not enter the mass balance.
      waterGasOil: 40,
    };

    it('is ingredient mass minus captured kilos', () => {
      expect(calculateMermaKg(101.7, 90)).toBe(11.7);
      expect(calculateSheetMerma({...inputs, totalKg: 90})).toBe(11.7);
    });

    it('never includes gasoil/agua in the mass or merma', () => {
      expect(calculateIngredientMassKg(inputs)).toBe(101.7);
      expect(calculateSheetMerma({...inputs, totalKg: 101.7})).toBe(0);
    });

    it('clamps negative balances to zero', () => {
      expect(calculateMermaKg(100, 120)).toBe(0);
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

  describe('describeTotalKgCalculation', () => {
    it('explica la diferencia entre kilos estimados, capturados y merma', () => {
      const breakdown = describeTotalKgCalculation(
        {
          guavaKg: 381.18,
          sugarKg: 200,
          starchKg: 25,
          chemicalG: 250,
          acidG: 250,
        },
        88.6,
        466.57
      );

      expect(breakdown.lines.map((line) => line.kg)).toEqual([
        381.18, 200, 25, 0.25, 0.25,
      ]);
      expect(breakdown.ingredientKg).toBe(606.68);
      expect(breakdown.estimatedKg).toBe(537.52);
      expect(breakdown.capturedKg).toBe(466.57);
      expect(breakdown.isManual).toBe(true);
      expect(breakdown.mermaKg).toBe(140.11);
    });

    it('alinea isManual con la señal manual del formulario', () => {
      const input = {
        guavaKg: 100,
        sugarKg: 0,
        starchKg: 0,
        chemicalG: 0,
        acidG: 0,
      };
      const overridden = describeTotalKgCalculation(input, 88.6, 88.6, true);
      expect(overridden.estimatedKg).toBe(88.6);
      expect(overridden.capturedKg).toBe(88.6);
      expect(overridden.isManual).toBe(true);
      expect(describeTotalKgCalculation(input, 88.6, 88.6, false).isManual).toBe(false);
      expect(describeTotalKgCalculation(input, 88.6, 88.6).isManual).toBe(false);
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

  describe('marmita × presentation matrix', () => {
    it('totals every marmita, presentation column and the whole sheet', () => {
      const totals = calculateSheetMatrixTotals(
        [
          {
            number: 1,
            totalKg: 200,
            presentationUnits: [
              { presentationId: 'cunete', units: 10 },
              { presentationId: 'p250', units: 0 },
            ],
          },
          {
            number: 2,
            totalKg: 10,
            presentationUnits: [
              { presentationId: 'cunete', units: 0 },
              { presentationId: 'p250', units: 40 },
            ],
          },
          {
            number: 3,
            totalKg: 0,
            presentationUnits: [
              { presentationId: 'cunete', units: 0 },
              { presentationId: 'p250', units: 0 },
            ],
          },
        ],
        [
          { id: 'cunete', presentationKg: 20 },
          { id: 'p250', presentationKg: 0.25 },
        ]
      );

      expect(totals.marmitas).toHaveLength(3);
      expect(totals.marmitas[0].units).toBe(10);
      expect(totals.marmitas[0].assignedKg).toBe(200);
      expect(totals.marmitas[0].differenceKg).toBe(0);
      expect(totals.marmitas[1].units).toBe(40);
      expect(totals.marmitas[1].assignedKg).toBe(10);
      expect(totals.marmitas[1].cells[1].assignedKg).toBe(10);
      expect(totals.presentations[0].units).toBe(10);
      expect(totals.presentations[0].assignedKg).toBe(200);
      expect(totals.presentations[1].units).toBe(40);
      expect(totals.presentations[1].assignedKg).toBe(10);
      expect(totals.presentations[1].unitsByMarmita).toEqual([
        { number: 1, units: 0 },
        { number: 2, units: 40 },
        { number: 3, units: 0 },
      ]);
      expect(totals.totalUnits).toBe(50);
      expect(totals.assignedKg).toBe(210);
    });

    it('reports missing and excess kilos per marmita', () => {
      const totals = calculateSheetMatrixTotals(
        [
          {
            number: 1,
            totalKg: 100,
            presentationUnits: [{ presentationId: 'p250', units: 200 }],
          },
          {
            number: 2,
            totalKg: 100,
            presentationUnits: [{ presentationId: 'p250', units: 800 }],
          },
        ],
        [{ id: 'p250', presentationKg: 0.25 }]
      );

      expect(totals.marmitas[0].assignedKg).toBe(50);
      expect(totals.marmitas[0].missingKg).toBe(50);
      expect(totals.marmitas[0].excessKg).toBe(0);
      expect(totals.marmitas[1].assignedKg).toBe(200);
      expect(totals.marmitas[1].excessKg).toBe(100);
      expect(totals.marmitas[1].missingKg).toBe(0);
    });

    it('falls back to the derived units on legacy single-presentation rows', () => {
      const totals = calculateSheetMatrixTotals(
        [{ number: 1, totalKg: 100, obtainedUnits: 5 }],
        [{ id: 'cunete', presentationKg: 20 }]
      );

      expect(totals.marmitas[0].units).toBe(5);
      expect(totals.marmitas[0].assignedKg).toBe(100);
      expect(totals.presentations[0].units).toBe(5);
      expect(totals.totalUnits).toBe(5);
      expect(totals.assignedKg).toBe(100);
    });

    it('ignores unknown presentation ids and negative units', () => {
      const totals = calculateSheetMatrixTotals(
        [
          {
            number: 1,
            totalKg: 0,
            presentationUnits: [
              { presentationId: 'unknown', units: 9 },
              { presentationId: 'cunete', units: -3 },
            ],
          },
        ],
        [{ id: 'cunete', presentationKg: 20 }]
      );

      expect(totals.marmitas[0].units).toBe(0);
      expect(totals.marmitas[0].cells).toEqual([
        { presentationId: 'cunete', units: 0, assignedKg: 0 },
      ]);
      expect(totals.totalUnits).toBe(0);
    });

    it('sincroniza 1 frasco de 300 g y 19 cuñetes de 20 kg en la matriz', () => {
      const totals = calculateSheetMatrixTotals(
        [
          {
            number: 1,
            totalKg: 466.57,
            presentationUnits: [
              {presentationId: 'frasco300', units: 1},
              {presentationId: 'cunete', units: 19},
            ],
          },
        ],
        [
          {id: 'frasco300', presentationKg: 0.3},
          {id: 'cunete', presentationKg: 20},
        ]
      );
      const marmita = totals.marmitas[0];

      expect(marmita.cells).toEqual([
        {presentationId: 'frasco300', units: 1, assignedKg: 0.3},
        {presentationId: 'cunete', units: 19, assignedKg: 380},
      ]);
      expect(marmita.units).toBe(20);
      expect(marmita.assignedKg).toBe(380.3);
      expect(marmita.estimatedKg).toBe(466.57);
      expect(marmita.missingKg).toBe(86.27);
      expect(totals.presentations.map((line) => line.units)).toEqual([1, 19]);
      expect(totals.totalUnits).toBe(20);
      expect(totals.assignedKg).toBe(380.3);
      expect(
        calculateSheetMerma({
          guavaKg: 381.18,
          sugarKg: 200,
          starchKg: 25,
          chemicalG: 250,
          acidG: 250,
          totalKg: 466.57,
        })
      ).toBe(140.11);
    });
  });

  describe('reconcileSheet', () => {
    const presentations = [
      {id: 'cunete', presentationKg: 20},
      {id: 'caja', presentationKg: 20},
    ];
    const marmitas = [
      {
        number: 1,
        totalKg: 100,
        presentationUnits: [
          {presentationId: 'cunete', units: 3},
          {presentationId: 'caja', units: 2},
        ],
      },
      {
        number: 2,
        totalKg: 60,
        presentationUnits: [
          {presentationId: 'cunete', units: 1},
          {presentationId: 'caja', units: 2},
        ],
      },
    ];

    function reconcile(overrides: {
      obtainedUnits?: number;
      estimatedKg?: number;
      packagingCost?: number;
    } = {}) {
      return reconcileSheet({
        matrix: calculateSheetMatrixTotals(marmitas, presentations),
        obtainedUnits: overrides.obtainedUnits ?? 8,
        estimatedKg: overrides.estimatedKg ?? 160,
        presentationPackagingCosts: [
          {id: 'cunete', packagingCost: 12},
          {id: 'caja', packagingCost: 8},
        ],
        packagingCost: overrides.packagingCost ?? 20,
      });
    }

    it('confirma que filas, columnas, kilos, obtenidas y empaques cuadran', () => {
      const result = reconcile();
      expect(result.ok).toBe(true);
      expect(result.checks.length).toBe(7);
      expect(result.checks.every((check) => check.ok)).toBe(true);
      expect(result.totalUnits).toBe(8);
      expect(result.totalAssignedKg).toBe(160);
      expect(result.totalEstimatedKg).toBe(160);
      expect(result.packagingCost).toBe(20);
    });

    it('detecta una Cant. obtenida diferente a la matriz', () => {
      const result = reconcile({obtainedUnits: 7});
      const failed = result.checks.filter((check) => !check.ok).map((check) => check.key);
      expect(failed).toContain('obtainedUnits');
      expect(result.ok).toBe(false);
    });

    it('detecta empaques que no coinciden con el resumen', () => {
      const result = reconcile({packagingCost: 22});
      const failed = result.checks.filter((check) => !check.ok).map((check) => check.key);
      expect(failed).toEqual(['packagingCost']);
    });

    it('tolera diferencias de redondeo de un centavo', () => {
      expect(reconcile({obtainedUnits: 8.01}).ok).toBe(true);
      expect(reconcile({packagingCost: 20.01}).ok).toBe(true);
    });
  });
});
