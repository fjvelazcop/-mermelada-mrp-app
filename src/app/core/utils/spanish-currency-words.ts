const SMALL = [
  'cero',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
];

const TENS = ['', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
];

function apocopateOne(words: string): string {
  return words
    .replace(/veintiuno$/, 'veintiún')
    .replace(/ y uno$/, ' y un')
    .replace(/uno$/, 'un');
}

function underThousand(value: number): string {
  if (value < 30) return SMALL[value];
  if (value < 100) {
    const units = value % 10;
    return units ? `${TENS[Math.floor(value / 10)]} y ${SMALL[units]}` : TENS[Math.floor(value / 10)];
  }
  if (value === 100) return 'cien';
  const remainder = value % 100;
  const hundreds = value === 500 ? 'quinientos' : HUNDREDS[Math.floor(value / 100)];
  return remainder ? `${hundreds} ${underThousand(remainder)}` : hundreds;
}

function integerToWords(value: number): string {
  if (value < 1000) return underThousand(value);

  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1000);
  const remainder = value % 1000;
  const parts: string[] = [];

  if (millions) {
    parts.push(
      millions === 1
        ? 'un millón'
        : `${apocopateOne(integerToWords(millions))} millones`
    );
  }
  if (thousands) {
    parts.push(
      thousands === 1
        ? 'mil'
        : `${apocopateOne(underThousand(thousands))} mil`
    );
  }
  if (remainder) parts.push(underThousand(remainder));
  return parts.join(' ');
}

export function spanishCurrencyWords(amount: number, currency: 'dólar' | 'bolívar'): string {
  const centsValue = Math.round(Math.abs(amount) * 100);
  const integer = Math.floor(centsValue / 100);
  const cents = String(centsValue % 100).padStart(2, '0');
  const unit = currency === 'dólar' ? (integer === 1 ? 'dólar' : 'dólares') : 'bolívares';
  const sign = amount < 0 ? 'menos ' : '';
  return `${sign}${apocopateOne(integerToWords(integer))} ${unit} con ${cents}/100`;
}
