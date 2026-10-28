export interface VenezuelanBank {
  code: string;
  name: string;
  shortName: string;
  businessName: string;
  isNational: boolean;
  color?: string;
}

export const VENEZUELAN_BANKS: VenezuelanBank[] = [
  { code: '0102', name: '0102 - Banco de Venezuela', shortName: 'Banco de Venezuela', businessName: 'Banco de Venezuela, S.A. Banco Universal', isNational: true, color: 'rose' },
  { code: '0104', name: '0104 - Venezolano de Crédito', shortName: 'Venezolano de Crédito', businessName: 'Venezolano de Crédito, S.A. Banco Universal', isNational: false, color: 'blue' },
  { code: '0105', name: '0105 - Banco Mercantil', shortName: 'Mercantil', businessName: 'Mercantil, C.A. Banco Universal', isNational: false, color: 'blue' },
  { code: '0108', name: '0108 - Banco Provincial (BBVA)', shortName: 'Provincial', businessName: 'Banco Provincial, S.A. Banco Universal', isNational: false, color: 'blue' },
  { code: '0114', name: '0114 - Bancaribe', shortName: 'Bancaribe', businessName: 'Bancaribe, C.A. Banco Universal', isNational: false, color: 'sky' },
  { code: '0115', name: '0115 - Banco Exterior', shortName: 'Exterior', businessName: 'Banco Exterior, C.A. Banco Universal', isNational: false, color: 'emerald' },
  { code: '0128', name: '0128 - Banco Caroní', shortName: 'Caroní', businessName: 'Banco Caroní, C.A. Banco Universal', isNational: false, color: 'amber' },
  { code: '0134', name: '0134 - Banesco', shortName: 'Banesco', businessName: 'Banesco Banco Universal, C.A.', isNational: false, color: 'emerald' },
  { code: '0137', name: '0137 - Banco Sofitasa', shortName: 'Sofitasa', businessName: 'Banco Sofitasa, Banco Universal C.A.', isNational: false, color: 'red' },
  { code: '0138', name: '0138 - Banco Plaza', shortName: 'Plaza', businessName: 'Banco Plaza, Banco Universal C.A.', isNational: false, color: 'amber' },
  { code: '0146', name: '0146 - Bangente', shortName: 'Bangente', businessName: 'Banco de la Gente Emprendedora, C.A.', isNational: false, color: 'orange' },
  { code: '0151', name: '0151 - BFC Banco Fondo Común', shortName: 'Fondo Común', businessName: 'BFC Banco Fondo Común, C.A. Banco Universal', isNational: false, color: 'cyan' },
  { code: '0156', name: '0156 - 100% Banco', shortName: '100% Banco', businessName: '100% Banco, Banco Universal C.A.', isNational: false, color: 'stone' },
  { code: '0157', name: '0157 - DelSur Banco Universal', shortName: 'DelSur', businessName: 'DelSur, Banco Universal C.A.', isNational: false, color: 'yellow' },
  { code: '0163', name: '0163 - Banco del Tesoro', shortName: 'Banco del Tesoro', businessName: 'Banco del Tesoro, C.A. Banco Universal', isNational: true, color: 'red' },
  { code: '0166', name: '0166 - Banco Agrícola de Venezuela', shortName: 'Agrícola', businessName: 'Banco Agrícola de Venezuela, C.A. Banco Universal', isNational: true, color: 'green' },
  { code: '0168', name: '0168 - Bancrecer', shortName: 'Bancrecer', businessName: 'Bancrecer, S.A. Banco Microfinanciero', isNational: false, color: 'violet' },
  { code: '0169', name: '0169 - Mi Banco', shortName: 'Mi Banco', businessName: 'Mi Banco, Banco Microfinanciero C.A.', isNational: false, color: 'indigo' },
  { code: '0171', name: '0171 - Banco Activo', shortName: 'Activo', businessName: 'Banco Activo, Banco Universal C.A.', isNational: false, color: 'amber' },
  { code: '0172', name: '0172 - Bancamiga', shortName: 'Bancamiga', businessName: 'Bancamiga, Banco Universal C.A.', isNational: false, color: 'teal' },
  { code: '0174', name: '0174 - Banplus', shortName: 'Banplus', businessName: 'Banplus Banco Universal, C.A.', isNational: false, color: 'purple' },
  { code: '0175', name: '0175 - Banco Bicentenario del Pueblo', shortName: 'Bicentenario', businessName: 'Banco Bicentenario del Pueblo, Banco Universal C.A.', isNational: true, color: 'red' },
  { code: '0177', name: '0177 - BANFANB', shortName: 'BANFANB', businessName: 'Banco de la Fuerza Armada Nacional Bolivariana', isNational: true, color: 'emerald' },
  { code: '0191', name: '0191 - BNC Banco Nacional de Crédito', shortName: 'BNC', businessName: 'Banco Nacional de Crédito, C.A. Banco Universal', isNational: false, color: 'stone' },
  { code: '0001', name: '0001 - Zelle / Cuenta Internacional USD', shortName: 'Zelle / Int. USD', businessName: 'Transferencia Directa en Divisas (Zelle / Wire)', isNational: false, color: 'purple' },
  { code: '0002', name: '0002 - Efectivo Caja Chica Planta', shortName: 'Caja Chica', businessName: 'Efectivo en Billetes (USD / Bs.)', isNational: false, color: 'emerald' },
  { code: '0003', name: '0003 - Binance Pay USDT', shortName: 'Binance Pay', businessName: 'Criptoactivos Estables (USDT)', isNational: false, color: 'yellow' },
];

export function filterVenezuelanBanks(query: string): VenezuelanBank[] {
  if (!query || query.trim() === '') {
    return VENEZUELAN_BANKS;
  }
  const q = query.toLowerCase().trim();
  return VENEZUELAN_BANKS.filter(
    b =>
      b.code.includes(q) ||
      b.name.toLowerCase().includes(q) ||
      b.shortName.toLowerCase().includes(q) ||
      b.businessName.toLowerCase().includes(q)
  );
}

export function findBankByCode(code: string): VenezuelanBank | undefined {
  return VENEZUELAN_BANKS.find(b => b.code === code);
}
