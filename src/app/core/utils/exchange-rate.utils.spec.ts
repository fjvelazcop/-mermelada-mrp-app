import {describe, expect, it} from 'vitest';
import {DailyExchangeRates, ExchangeRateRecord} from '../models/erp.models';
import {defaultDocumentRate, resolveDocumentRate} from './exchange-rate.utils';

const history: ExchangeRateRecord[] = [
  {
    id: 'rate-1',
    date: '2026-11-20',
    time: '09:15:00',
    usdRate: 40,
    usdtRate: 42,
    source: 'BCV / Oficial',
    window: 'manana_8_10',
  },
];

const rates: DailyExchangeRates = {
  currentUsd: 918.77,
  currentUsdt: 950,
  lastUpdated: '2026-11-23T10:00:00.000Z',
  isInActiveWindow: false,
  activeWindowName: 'Fuera de ventana',
  nextScheduledCheck: '2026-11-23T12:30:00.000Z',
  history,
};

describe('Política de tasa de cambio (#13)', () => {
  it('usa la tasa capturada manualmente cuando se especifica', () => {
    const resolved = resolveDocumentRate(rates, '2026-11-20', 55.5);
    expect(resolved).toEqual({rate: 55.5, source: 'Tasa capturada en el documento'});
  });

  it('usa la tasa histórica de la fecha del documento cuando no hay captura manual', () => {
    const resolved = resolveDocumentRate(rates, '2026-11-20');
    expect(resolved).toEqual({rate: 40, source: 'Tasa histórica de la fecha'});
  });

  it('cae a la tasa actual si la fecha no tiene histórico', () => {
    const resolved = resolveDocumentRate(rates, '2026-11-23');
    expect(resolved).toEqual({rate: 918.77, source: 'currentUsd (referencia)'});
  });

  it('cae al respaldo 48,35 si no hay cotizaciones ni captura', () => {
    expect(defaultDocumentRate(null)).toBe(48.35);
    expect(defaultDocumentRate(undefined, '2026-11-20')).toBe(48.35);
  });

  it('descarta tasas inválidas o en cero', () => {
    expect(resolveDocumentRate(rates, '2026-11-20', 0)).toEqual({
      rate: 40,
      source: 'Tasa histórica de la fecha',
    });
    expect(resolveDocumentRate({...rates, currentUsd: -1}, '2026-01-01', -5)).toEqual({
      rate: 48.35,
      source: 'currentUsd (referencia)',
    });
  });
});
