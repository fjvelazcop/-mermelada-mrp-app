import {describe, expect, it} from 'vitest';
import {
  createDefaultAccountingOpening,
  normalizeOpeningAmount,
  summarizeOpening,
} from './erp.models';

const accounts = [
  {code: '1.01.02', name: 'Bancos', type: 'activo' as const, nature: 'debito' as const},
  {code: '3.01', name: 'Capital Social', type: 'patrimonio' as const, nature: 'credito' as const},
];

describe('Cuadre de apertura #13', () => {
  it('parte de Banco 30.000 USD en 1.01.02 y muestra la contrapartida pendiente en ambas monedas', () => {
    const opening = createDefaultAccountingOpening(40);
    const bank = opening.auxiliaryBalances.find((item) => item.kind === 'banco')!;
    expect(bank.accountCode).toBe('1.01.02');
    expect(bank.amountUsd).toBe(30000);
    expect(bank.amountBs).toBe(1200000);

    const summary = summarizeOpening(opening, accounts);
    expect(summary.debitsUsd).toBe(30000);
    expect(summary.creditsUsd).toBe(0);
    expect(summary.differenceBs).toBe(1200000);
    expect(summary.balanced).toBe(false);
    expect(summary.pendingMessage).toContain('USD 30000.00');
    expect(summary.pendingMessage).toContain('Bs. 1200000.00');
    expect(summary.entryLines).toHaveLength(1);
  });

  it('cuadra al capturar aportes y conserva el asiento como propuesta borrador', () => {
    const opening = createDefaultAccountingOpening(40);
    opening.shareholders.push({
      id: 'acc-1',
      name: 'Aportante',
      accountCode: '3.01',
      amountUsd: 30000,
      amountBs: 1200000,
      exchangeRateUsed: 40,
      rateSource: 'Tasa capturada en apertura',
    });

    const summary = summarizeOpening(opening, accounts);
    expect(summary.balanced).toBe(true);
    expect(summary.differenceUsd).toBe(0);
    expect(summary.differenceBs).toBe(0);
    expect(summary.entryLines).toHaveLength(2);
    expect(summary.pendingMessage).toContain('continúa en borrador');
  });

  it('deriva USD desde Bs usando la tasa de la línea', () => {
    const amount = normalizeOpeningAmount(
      {amountBs: 4000, exchangeRateUsed: 40},
      48.35
    );
    expect(amount.amountUsd).toBe(100);
    expect(amount.amountBs).toBe(4000);
    expect(amount.rateSource).toBe('Tasa capturada en apertura');
  });
});
