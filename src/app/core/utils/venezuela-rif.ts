const VENEZUELAN_RIF_PATTERN = /^[VEJPG]\d{8,9}$/;

export function normalizeVenezuelanRif(value: string): string {
  return value.trim().toUpperCase().replace(/[\s.:-]/g, '');
}

export function isValidVenezuelanRif(value: string): boolean {
  return VENEZUELAN_RIF_PATTERN.test(normalizeVenezuelanRif(value));
}
