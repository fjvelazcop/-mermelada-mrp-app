/**
 * Normalización y validación de RIF / Cédula de Identidad venezolana.
 *
 * Se aceptan los prefijos V (cédula), J (RIF jurídico), G (RIF gubernamental),
 * E (RIF extranjero) y C (RIF consular). Los separadores se normalizan para
 * evitar duplicados que difieran sólo en puntos o espacios.
 */
const TAX_ID_PREFIXES = 'VEJGPC';

export function normalizeTaxId(value: string | null | undefined): string {
  if (!value) return '';
  const raw = value
    .toUpperCase()
    .replace(/[\s.]/g, '')
    .replace(new RegExp(`^([${TAX_ID_PREFIXES}])`), '$1-');
  const [prefix, ...rest] = raw.split('-');
  const digits = rest.join('');
  if (!digits) return prefix;
  if (digits.length === 9) {
    return `${prefix}-${digits.slice(0, 8)}-${digits.slice(8)}`;
  }
  return `${prefix}-${digits}`;
}

export function isValidTaxId(value: string | null | undefined): boolean {
  return new RegExp(`^[${TAX_ID_PREFIXES}]-\\d{6,9}(?:-\\d)?$`).test(
    normalizeTaxId(value)
  );
}

export function sameTaxId(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeTaxId(a) === normalizeTaxId(b);
}
