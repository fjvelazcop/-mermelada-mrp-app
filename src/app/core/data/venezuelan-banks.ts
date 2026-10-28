/**
 * Catálogo de bancos venezolanos (códigos SUDEBAN).
 *
 * Se usa tanto en el cliente (autocompletado) como en el servidor
 * (validación del banco emisor/receptor). El código de 4 dígitos es la
 * identificación oficial de la institución financiera.
 */
export interface VenezuelanBank {
  code: string;
  name: string;
}

export const VENEZUELAN_BANKS: readonly VenezuelanBank[] = [
  { code: '0102', name: 'Banco de Venezuela' },
  { code: '0104', name: 'Venezolano de Crédito' },
  { code: '0105', name: 'Mercantil' },
  { code: '0108', name: 'Banco Provincial (BBVA)' },
  { code: '0114', name: 'Bancaribe' },
  { code: '0115', name: 'Banco Exterior' },
  { code: '0128', name: 'Banco Caroní' },
  { code: '0134', name: 'Banesco' },
  { code: '0137', name: 'Sofitasa' },
  { code: '0138', name: 'Banco Plaza' },
  { code: '0146', name: 'Bangente' },
  { code: '0151', name: 'BFC Banco Fondo Común' },
  { code: '0156', name: '100% Banco' },
  { code: '0157', name: 'DelSur' },
  { code: '0163', name: 'Banco del Tesoro' },
  { code: '0166', name: 'Banco Agrícola de Venezuela' },
  { code: '0168', name: 'Bancrecer' },
  { code: '0169', name: 'Mi Banco' },
  { code: '0171', name: 'Banco Activo' },
  { code: '0172', name: 'Bancamiga' },
  { code: '0174', name: 'Banplus' },
  { code: '0175', name: 'Banco Bicentenario' },
  { code: '0177', name: 'Banfanb' },
  { code: '0191', name: 'Banco Nacional de Crédito (BNC)' },
] as const;

/** Normaliza un texto para búsquedas tolerantes a mayúsculas/acentos. */
export function normalizeBankQuery(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Busca un banco por código exacto o por nombre/código parcial. */
export function findBank(query: string): VenezuelanBank | undefined {
  const normalized = normalizeBankQuery(query);
  if (!normalized) return undefined;

  const byCode = VENEZUELAN_BANKS.find((bank) => bank.code === normalized);
  if (byCode) return byCode;

  return VENEZUELAN_BANKS.find(
    (bank) =>
      normalizeBankQuery(bank.name) === normalized ||
      normalizeBankQuery(`${bank.code} - ${bank.name}`) === normalized
  );
}

/** Devuelve la etiqueta oficial `código - nombre`. */
export function bankLabel(bank: VenezuelanBank): string {
  return `${bank.code} - ${bank.name}`;
}
