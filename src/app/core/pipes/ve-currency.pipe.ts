import {Pipe, PipeTransform} from '@angular/core';

/**
 * Formats a number with Venezuelan convention:
 * - Thousands separator: '.' (period)
 * - Decimal separator: ',' (comma)
 */
export function formatVeNumber(value: number | string | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === '') return '0,' + '0'.repeat(decimals);
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0,' + '0'.repeat(decimals);

  // Format with fixed decimals
  const parts = num.toFixed(decimals).split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1] || '';

  // Add thousand dots: 1234567 -> 1.234.567
  const withDots = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return decimals > 0 ? `${withDots},${decimalPart}` : withDots;
}

export function formatVeCurrency(
  value: number | string | null | undefined,
  currency: 'Bs.' | '$' | 'USDT' = 'Bs.',
  decimals = 2
): string {
  const formatted = formatVeNumber(value, decimals);
  if (currency === '$') {
    return `$ ${formatted}`;
  }
  if (currency === 'USDT') {
    return `${formatted} USDT`;
  }
  return `Bs. ${formatted}`;
}

@Pipe({
  name: 'veNumber',
  standalone: true,
})
export class VeNumberPipe implements PipeTransform {
  transform(value: number | string | null | undefined, decimals = 2): string {
    return formatVeNumber(value, decimals);
  }
}

@Pipe({
  name: 'veCurrency',
  standalone: true,
})
export class VeCurrencyPipe implements PipeTransform {
  transform(
    value: number | string | null | undefined,
    currency: 'Bs.' | '$' | 'USDT' = 'Bs.',
    decimals = 2
  ): string {
    return formatVeCurrency(value, currency, decimals);
  }
}
