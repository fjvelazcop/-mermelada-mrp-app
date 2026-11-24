import {DailyExchangeRates} from '../models/erp.models';

/** Origen de la tasa aplicada a un documento, expuesto en la interfaz. */
export type DocumentRateSource =
  | 'Tasa capturada en el documento'
  | 'Tasa histórica de la fecha'
  | 'currentUsd (referencia)';

export interface DocumentRate {
  rate: number;
  source: DocumentRateSource;
}

/** Respaldo histórico cuando aún no hay cotizaciones cargadas. */
export const FALLBACK_EXCHANGE_RATE = 48.35;

function roundRate(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Resuelve la tasa de un documento con la política acordada para #13:
 * 1) tasa capturada manualmente en el formulario;
 * 2) tasa histórica correspondiente a la fecha del documento;
 * 3) tasa actual (`currentUsd`) y, si tampoco existe, el respaldo 48,35.
 *
 * Nunca devuelve cero ni negativos: los valores inválidos se descartan.
 */
export function resolveDocumentRate(
  rates: DailyExchangeRates | null | undefined,
  date?: string,
  explicitRate?: number | null
): DocumentRate {
  const manual = Number(explicitRate);
  if (Number.isFinite(manual) && manual > 0) {
    return {rate: roundRate(manual), source: 'Tasa capturada en el documento'};
  }

  const historic = date ? rates?.history?.find((item) => item.date === date) : undefined;
  if (historic && Number(historic.usdRate) > 0) {
    return {rate: roundRate(historic.usdRate), source: 'Tasa histórica de la fecha'};
  }

  const current = Number(rates?.currentUsd);
  return {
    rate: Number.isFinite(current) && current > 0 ? roundRate(current) : FALLBACK_EXCHANGE_RATE,
    source: 'currentUsd (referencia)',
  };
}

/** Tasa por defecto de un formulario: actual o histórica por fecha, sin captura manual. */
export function defaultDocumentRate(
  rates: DailyExchangeRates | null | undefined,
  date?: string,
  explicitRate?: number | null
): number {
  return resolveDocumentRate(rates, date, explicitRate).rate;
}
