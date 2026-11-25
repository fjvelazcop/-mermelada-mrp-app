import type {ManualSheetIngredientMaterialIds} from '../utils/manual-sheet-ingredients';

export type UserRole = 'admin' | 'master' | 'operator' | 'operador_produccion' | string;

export type AppModuleId =
  | 'dashboard'
  | 'inventory'
  | 'production'
  | 'costing'
  | 'sales'
  | 'payroll'
  | 'expenses'
  | 'accounting'
  | 'suppliers'
  | 'supplier_types'
  | 'material_categories'
  | 'settings'
  | 'architecture'
  | 'activation';

export type SettingsSection =
  | 'users'
  | 'roles'
  | 'simulator'
  | 'fiscal'
  | 'fiscalReferences'
  | 'notifications'
  | 'supplierTypes'
  | 'materialCategories'
  | 'presentationTypes'
  | 'operations';

export interface NotificationRecipient {
  id: string;
  email: string;
  name?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TunnelSessionInfo {
  id: string;
  provider: string;
  mode: string;
  publicUrl: string;
  apiUrl: string;
  status: string;
  pid?: number;
  startedAt: string;
  endedAt?: string;
}

export interface TunnelSessionsResponse {
  latest: TunnelSessionInfo | null;
  history: TunnelSessionInfo[];
  emailConfigured: boolean;
}

export interface NotificationDispatchResult {
  status: string;
  reason?: string;
  error?: string;
  recipients: string[];
  bcc: string[];
  attempts: number;
}

export interface ModulePermissions {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
}

export interface SystemRole {
  id: string;
  name: string;
  description: string;
  isSystem?: boolean;
  color: string;
  permissions: Record<AppModuleId, ModulePermissions>;
}

export interface SystemUser {
  id: string;
  fullName: string;
  username: string;
  email: string;
  nationalId: string;
  roleId: string;
  roleName: string;
  department: string;
  status: 'activo' | 'inactivo';
  avatarBg?: string;
  createdAt: string;
}

export type ActivationCurrency = 'USD' | 'Bs';

export type ActivationStatus =
  | 'activo'
  | 'pendiente'
  | 'vencido'
  | 'suspendido';

/** Master-only record for activation and payment control. */
export interface ActivationRecord {
  id: string;
  clientName: string;
  clientDocument?: string;
  concept: string;
  amount: number;
  currency: ActivationCurrency;
  paymentMethod: string;
  reference?: string;
  paymentDate: string;
  periodStart?: string;
  periodEnd?: string;
  status: ActivationStatus;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Global system license shared by every user. */
export type LicenseStatus = 'activa' | 'prueba' | 'suspendida';
export type LicenseMode = 'normal' | 'aviso' | 'gracia' | 'solo_lectura';

export interface SystemLicense {
  enabled: boolean;
  licenseId: string;
  status: LicenseStatus;
  holder?: string;
  issuedAt: string;
  expiresAt: string;
  graceDays: number;
  daysRemaining: number;
  mode: LicenseMode;
  readOnly: boolean;
  maxDays: number;
  alertDays: number;
  clockTampered: boolean;
  updatedAt: string;
}

export interface LicenseEvent {
  id: string;
  licenseId?: string;
  action: string;
  status?: string;
  expiresAt?: string;
  graceDays?: number;
  actor?: string;
  source: string;
  tokenId?: string;
  detail?: string;
  createdAt: string;
}

export interface LicenseAlert {
  id: string;
  licenseId: string;
  alertDate: string;
  daysRemaining: number;
  recipients: string[];
  status: string;
  error?: string;
  createdAt: string;
  sentAt?: string;
}

export type UnitOfMeasure = 'kg' | 'g' | 'l' | 'ml' | 'unidades' | 'cajas' | 'paquetes';

/** Categoría de materia prima. El catálogo editable vive en `material_categories`. */
export type MaterialCategory = string;

/** Fila del catálogo administrable de categorías de materia prima. */
export interface MaterialCategoryConfig {
  id: string;
  code: string;
  label: string;
  description: string;
  color: string;
  active: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PresentationType =
  | 'pequena_250g'
  | 'pequena_300g'
  | 'grande_1000g'
  | 'galon_5kg'
  | 'balde_15kg'
  | 'pote_20kg'
  | 'caja_20kg'
  | 'caja_6kg'
  | 'otra';

export const PRESENTATION_TYPE_CODES: PresentationType[] = [
  'pequena_250g',
  'pequena_300g',
  'grande_1000g',
  'galon_5kg',
  'balde_15kg',
  'pote_20kg',
  'caja_20kg',
  'caja_6kg',
  'otra',
];

/** Presentación administrable. Códigos nuevos se conservan como `otra`. */
export interface PresentationTypeConfig {
  id: string;
  code: string;
  label: string;
  weightGrams: number;
  packagingMaterialId?: string;
  active: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Traduce un código del catálogo al enum cerrado usado por libros y URI. */
export function presentationTypeForCode(code: string): PresentationType {
  return PRESENTATION_TYPE_CODES.includes(code as PresentationType)
    ? (code as PresentationType)
    : 'otra';
}

/** Catálogo base compartido entre BD, API y fallbacks de la UI. */
export const DEFAULT_PRESENTATION_TYPES: PresentationTypeConfig[] = [
  {id: 'pt-250g', code: 'pequena_250g', label: 'Frasco 250 g', weightGrams: 250, active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'pt-300g', code: 'pequena_300g', label: 'Frasco 300 g', weightGrams: 300, active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'pt-1000g', code: 'grande_1000g', label: 'Frasco 1000 g', weightGrams: 1000, active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'pt-galon5', code: 'galon_5kg', label: 'Galón 5 kg', weightGrams: 5000, active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'pt-balde15', code: 'balde_15kg', label: 'Balde 15 kg', weightGrams: 15000, active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'pt-cunete20', code: 'pote_20kg', label: 'Cuñete 20 kg', weightGrams: 20000, active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'pt-caja20', code: 'caja_20kg', label: 'Caja 20 kg', weightGrams: 20000, active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'pt-caja6', code: 'caja_6kg', label: 'Caja 6 kg', weightGrams: 6000, active: true, isSystem: true, createdAt: '', updatedAt: ''},
];

export interface RawMaterial {
  id: string;
  code: string;
  name: string;
  category: MaterialCategory;
  currentStock: number;
  minStock: number;
  unit: UnitOfMeasure;
  costPerUnit: number; // Costo unitario promedio ponderado
  supplier?: string;
  supplierId?: string;
  supplierTaxId?: string;
  paymentCondition?: 'contado' | 'credito';
  creditDays?: number;
  paymentDueDate?: string;
  lastRestockDate: string;
  notes?: string;
}

export interface InventoryMovement {
  id: string;
  materialId: string;
  materialName: string;
  type: 'entrada' | 'salida_produccion' | 'ajuste_merma';
  quantity: number;
  costPerUnit: number;
  totalCost: number;
  exchangeRateUsed: number; // Tasa del día (USD en Bs.)
  costPerUnitBs?: number; // Costo unitario en Bs.
  totalCostBs?: number; // Total en Bs.
  referenceDoc?: string; // ej: Lote L-2026-10, Factura F-442
  /** Fecha operativa elegida por el usuario (cuando ocurrió el movimiento). */
  movementDate?: string;
  /** Fecha y hora reales de registro, generadas por el servidor. */
  registeredAt?: string;
  /** Proveedor maestro al que pertenece la factura de compra. */
  supplierId?: string;
  supplierNameSnapshot?: string;
  supplierTaxIdSnapshot?: string;
  notes?: string;
  date: string;
  performedBy: string;
  /** Condición de pago capturada en compras a proveedor. */
  paymentCondition?: 'contado' | 'credito';
  paymentMethod?: 'transferencia_bancaria' | 'pago_movil' | 'efectivo_usd' | 'efectivo_bs' | 'zelle' | 'tarjeta';
  bankCode?: string;
  bankName?: string;
  paymentReference?: string;
  creditDays?: number;
  /** Vencimiento de la factura cuando la compra es a crédito. */
  dueDate?: string;
  /** CxP generado automáticamente por una compra a crédito. */
  payableId?: string;
  payableNumber?: string;
  /** Cuenta contable elegida para el lado efectivo/banco del asiento automático. */
  paymentAccountCode?: string;
}

export type BasePriceTier = 'mayorista' | 'detal' | 'especial';
export type PriceTierType = BasePriceTier | 'personalizado';

export interface FinishedGood {
  id: string;
  code: string;
  flavor: string; // Guayaba, Fresa, etc.
  presentation: PresentationType;
  presentationLabel: string; // ej: Frasco 250g, Frasco 1000g
  weightGrams: number;
  stockUnits: number;
  reservedUnits: number;
  availableUnits: number;
  baseCost: number;
  suggestedWholesalePrice: number; // Precio Mayorista (panaderías, distribuidores)
  suggestedRetailPrice: number; // Precio Detal / Minorista (venta directa al público)
  suggestedSpecialPrice: number; // Precio Especial / Institucional (gran volumen / convenios)
  minStock: number;
  /** Estado del maestro. Los productos en borrador no se venden todavía. */
  status?: 'borrador' | 'activo' | 'inactivo';
  notes?: string;
  createdAt?: string;
}

export interface BOMItem {
  materialId: string;
  materialName: string;
  quantity: number;
  unit: UnitOfMeasure;
  estimatedCost: number;
}

export interface RecipeBOM {
  id: string;
  code: string;
  name: string; // ej: Mermelada de Guayaba Tradicional (Lote 50 frascos 250g)
  flavor: string;
  presentation: PresentationType;
  batchSizeUnits: number; // Unidades que rinde este lote (ej. 50 frascos)
  items: BOMItem[];
  directLaborMinutes: number; // Minutos de mano de obra directa para el lote
  estimatedUtilityCost: number; // Gas, energía, agua estimada para el lote
  instructions?: string;
  /** Presentación del catálogo cuando el código cerrado es `otra`. */
  presentationLabel?: string;
  weightGrams?: number;
}

export type ProductionOrderStatus =
  | 'borrador'
  | 'planificada'
  | 'en_proceso'
  | 'completada'
  | 'cancelada'
  | 'anulada';

export type ProductionOrderMode = 'automatico' | 'manual';

export interface ProductionOrderFormula {
  recipeId: string;
  recipeName: string;
  flavor: string;
  presentation: PresentationType;
  batchCount: number;
  targetUnits: number;
  directMaterialCost: number;
  directLaborCost: number;
  indirectCost: number;
  totalProductionCost: number;
  unitCost: number;
}

/** Units of one presentation produced by a single marmita. */
export interface ProductionSheetPresentationUnits {
  presentationId: string;
  units: number;
}

/**
 * One presentation handled by the manual sheet. A sheet with a single line
 * calculates units automatically; a sheet with several lines captures them
 * manually per marmita.
 */
export interface ProductionSheetPresentationLine {
  id: string;
  label: string;
  presentation: PresentationType;
  presentationKg: number;
  /** Total units of this presentation across the six marmitas. */
  units: number;
  /** Unit valuation rate in force when the order was saved (USD). */
  unitRate?: number;
  /** Packaging material cost per unit in force when the order was saved (USD). */
  packagingUnitCost?: number;
  /** Units × unitRate (USD). */
  productionValue?: number;
  /** Units × packagingUnitCost (USD). */
  packagingCost?: number;
}

/** One of the six fixed marmitas on the physical plant production sheet. */
export interface ProductionMarmitaSheetRow {
  number: number; // 1..6
  basketsBase: number; // cestas / base
  guavaKg: number;
  sugarKg: number;
  starchKg: number;
  chemicalG: number;
  acidG: number;
  waterGasOil: number; // agua / gasoil
  finishedAt: string; // HH:mm
  obtainedUnits: number; // cantidad obtenida
  totalKg: number; // kilos totales
  reprocess: boolean;
  /** Manual distribution when the sheet handles more than one presentation. */
  presentationUnits?: ProductionSheetPresentationUnits[];
}

export interface ProductionSheetPackaging {
  presentationKg: number; // peso por cuñete / caja (ej. 20 kg)
  cunetes: number;
  cajas: number;
  /** Rendimiento de insumos a producto terminado, en porcentaje (ej. 88.6). */
  rendimiento?: number;
  /** Unit valuation rate in force when the order was saved (USD). */
  cuneteUnitRate: number;
  cajaUnitRate: number;
  /** Packaging material cost per unit in force when the order was saved (USD). */
  cunetePackagingUnitCost: number;
  cajaPackagingUnitCost: number;
  /** Presentation lines. Omitted on legacy single-presentation sheets. */
  presentations?: ProductionSheetPresentationLine[];
}

export interface ProductionSheetTotals {
  guavaKg: number;
  sugarKg: number;
  starchKg: number;
  chemicalG: number;
  acidG: number;
  waterGasOil: number;
  obtainedUnits: number;
  totalKg: number;
  /** Ingredient mass minus captured kilos, excluding water/gasoil. */
  mermaKg?: number;
  /** Units represented by totalKg ÷ presentationKg (snapshot at save time). */
  estimatedUnits?: number;
}

export interface ProductionSheetPresentationCost {
  id: string;
  label: string;
  presentation: PresentationType;
  units: number;
  presentationKg: number;
  unitRate: number;
  packagingUnitCost: number;
  productionValue: number;
  packagingCost: number;
}

export interface ProductionSheetCosts {
  materialsCost: number; // insumos (guayaba, azúcar, almidón, químicos, ácidos, agua/gasoil)
  packagingCost: number; // envases (cuñetes + cajas)
  totalCost: number; // insumos + empaques
  cuneteValue: number;
  cajaValue: number;
  productionValue: number; // valor total de producción según tarifa vigente
  valuationRule: string;
  /** Per-presentation valuation when the sheet handles several lines. */
  presentations?: ProductionSheetPresentationCost[];
}

/** Detail captured by the manual production sheet (physical Lote 72 format). */
interface ProductionManualSheet {
  productionDate: string;
  marmitas: ProductionMarmitaSheetRow[]; // exactly six rows
  packaging: ProductionSheetPackaging;
  totals: ProductionSheetTotals;
  costs: ProductionSheetCosts;
  /** Insumos concretos elegidos para almidón, químico y ácido. */
  ingredientMaterialIds?: ManualSheetIngredientMaterialIds;
}

export interface ProductionOrder {
  id: string;
  orderNumber: string; // ej: OP-2026-089
  recipeId: string;
  recipeName: string;
  flavor: string;
  presentation: PresentationType;
  targetUnits: number; // Unidades a producir
  batchCount: number; // Multiplicador de lote
  lotNumber: string; // ej: L-GUAY-2610
  status: ProductionOrderStatus;
  mode?: ProductionOrderMode; // automatico = MTO, manual = carga/ajuste manual
  formulas?: ProductionOrderFormula[]; // Solo órdenes manuales multi-fórmula
  manualSheet?: ProductionManualSheet; // Solo órdenes manuales capturadas con la planilla de marmitas
  productionDate?: string; // Fecha de producción de la planilla manual
  commitmentReference?: string; // Referencia del compromiso de inventario
  createdBy?: string;
  updatedBy?: string;
  processedBy?: string;
  processedAt?: string;
  annulledBy?: string;
  annulledAt?: string;
  salesOrderId?: string; // MTO: pedido de cliente asociado
  customerName?: string;
  startDate: string;
  completionDate?: string;
  createdAt?: string; // Fecha de creación
  exchangeRateUsed?: number; // Tasa del día USD/Bs al momento de la orden
  consumedMaterials: {
    materialId: string;
    materialName: string;
    quantityConsumed: number;
    unit: UnitOfMeasure;
    unitCost: number;
    totalCost: number;
  }[];
  directMaterialCost: number;
  directLaborCost: number;
  indirectCost: number;
  totalProductionCost: number;
  totalCost?: number; // Alias totalProductionCost
  unitCost: number;
  totalProductionCostBs?: number;
  unitCostBs?: number;
  operatorNotes?: string;
}

export interface Customer {
  id: string;
  businessName: string; // Razón Social ej: Panadería El Trigal C.A.
  taxId: string; // RIF / NIT / RFC
  nit?: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  clientType: 'panaderia' | 'fabricante_bocadillos' | 'pasteleria' | 'distribuidor' | 'otro';
  creditLimit: number;
  paymentTerms: string; // Contado, 7 días, 15 días
}

/** Tipo de proveedor. El catálogo editable vive en `supplier_types`. */
export type SupplierType = string;

/** Fila del catálogo administrable de tipos de proveedor. */
export interface SupplierTypeConfig {
  id: string;
  code: string;
  label: string;
  description: string;
  color: string;
  active: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  code: string; // ej: PROV-0001
  businessName: string; // Razón social
  taxId: string; // RIF
  primaryContact: string; // Contacto principal (obligatorio)
  primaryPhone: string; // Teléfono principal (obligatorio)
  secondaryPhone?: string;
  email?: string;
  fiscalAddress: string; // Dirección fiscal (obligatoria)
  physicalAddress?: string;
  supplierType: SupplierType;
  paymentTerms: string;
  status: 'activo' | 'inactivo';
  notes?: string;
  createdAt: string;
}

/** Seed compartido entre la BD, la API y los fallbacks de la UI. */
export const DEFAULT_SUPPLIER_TYPES: SupplierTypeConfig[] = [
  {id: 'st-fruta', code: 'fruta', label: 'Fruta / Pulpa', description: 'Fruta fresca, pulpas y concentrados', color: 'emerald', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'st-aditivo', code: 'aditivo', label: 'Aditivo / Azúcar', description: 'Azúcares, pectina y aditivos alimentarios', color: 'amber', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'st-empaque', code: 'empaque', label: 'Etiquetas / Empaque general', description: 'Etiquetas, cintas y material de empaque general', color: 'stone', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'st-quimico', code: 'quimico', label: 'Químico / Conservante', description: 'Conservantes, insecticidas y químicos de proceso', color: 'rose', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'st-servicios', code: 'servicios', label: 'Servicios', description: 'Mantenimiento, transporte y servicios varios', color: 'violet', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'st-envases', code: 'envases', label: 'Envases / Frascos y Tapas', description: 'Frascos de vidrio, tapas twist-off y envases', color: 'blue', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'st-cajas', code: 'cajas', label: 'Cajas / Cartón', description: 'Cajas de cartón, estuches y empaques de transporte', color: 'orange', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'st-otro', code: 'otro', label: 'Otro', description: 'Proveedores no clasificados', color: 'stone', active: true, isSystem: true, createdAt: '', updatedAt: ''},
];

export const DEFAULT_MATERIAL_CATEGORIES: MaterialCategoryConfig[] = [
  {id: 'mc-fruta', code: 'fruta', label: 'Fruta / Pulpa Natural', description: 'Fruta fresca y pulpas', color: 'emerald', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'mc-aditivo', code: 'aditivo', label: 'Aditivo / Endulzante', description: 'Azúcares y aditivos', color: 'amber', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'mc-quimico', code: 'quimico', label: 'Químico (Pectina / Ácido)', description: 'Pectina, ácido y químicos de proceso', color: 'rose', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'mc-empaque', code: 'empaque', label: 'Etiquetas / Empaque general', description: 'Etiquetas y material de empaque general', color: 'stone', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'mc-envases', code: 'envases', label: 'Envases / Frascos y Tapas', description: 'Frascos de vidrio y tapas', color: 'blue', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'mc-cajas', code: 'cajas', label: 'Cajas / Cartón', description: 'Cajas y estuches de cartón', color: 'orange', active: true, isSystem: true, createdAt: '', updatedAt: ''},
  {id: 'mc-otro', code: 'otro', label: 'Otro', description: 'Insumos no clasificados', color: 'stone', active: true, isSystem: true, createdAt: '', updatedAt: ''},
];

export interface SupplierPrice {
  id: string;
  supplierId: string;
  supplierName: string;
  materialId?: string; // Materia prima asociada (opcional)
  productName: string;
  unit: UnitOfMeasure;
  priceUsd: number;
  validFrom: string; // YYYY-MM-DD
  validTo?: string; // Vigente hasta (nulo = precio actual)
  isCurrent: boolean;
  notes?: string;
  createdAt: string;
  createdBy?: string;
}

export type SalesOrderStatus =
  | 'pendiente'
  | 'en_produccion'
  | 'listo_despacho'
  | 'despachado'
  | 'cobrado_parcial'
  | 'cobrado';

/** Abono bancario registrado contra un pedido de venta. */
export interface SalesCollection {
  id: string;
  bankCode: string;
  bankName: string;
  paymentMethod: 'transferencia_bancaria' | 'pago_movil' | 'efectivo_usd' | 'efectivo_bs' | 'zelle' | 'tarjeta';
  /** Cuenta contable de entrada elegida para el asiento automático. */
  accountCode?: string;
  reference: string;
  amountUsd: number;
  amountBs?: number;
  exchangeRateUsed: number;
  collectedAt: string;
  collectedBy: string;
}
export type FiscalSaleCondition = 'contado' | 'credito';
export type FiscalPaymentMethod =
  | 'transferencia_bancaria'
  | 'pago_movil'
  | 'efectivo_usd'
  | 'efectivo_bs'
  | 'zelle'
  | 'tarjeta'
  | 'credito';

export interface SalesOrderItem {
  finishedGoodId: string;
  flavor: string;
  presentation: PresentationType;
  presentationLabel: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  unitPriceBs?: number;
  subtotalBs?: number;
  priceTier?: PriceTierType;
  profitMarginPercent?: number;
  baseCost?: number;
  taxCategory?: SalesTaxCategory;
  taxRatePercent?: number;
  taxAmount?: number;
}

export type SalesTaxCategory = 'gravado' | 'exento' | 'no_sujeto';

export interface SalesOrder {
  id: string;
  orderNumber: string; // ej: PED-2026-042
  customerId: string;
  customerName: string;
  customerTaxId: string;
  customerNit?: string;
  saleCondition?: FiscalSaleCondition;
  paymentMethod?: FiscalPaymentMethod;
  /** Días de plazo cuando la condición de venta es a crédito (0 = contado). */
  creditDays?: number;
  orderDate: string;
  deliveryDate: string;
  status: SalesOrderStatus;
  exchangeRateUsed: number; // Tasa del día USD aplicada (Bs./USD)
  items: SalesOrderItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  subtotalBs?: number;
  taxAmountBs?: number;
  totalBs?: number;
  hasDeliveryNote: boolean;
  deliveryNoteNumber?: string;
  productionOrderId?: string;
  notes?: string;
  /** Full name of the user that registered the order (audit trail). */
  createdBy?: string;
  /** Último cobro registrado. Se conserva por compatibilidad; la fuente de verdad es `collections`. */
  collection?: SalesCollection;
  /** Historial completo de abonos del pedido. */
  collections?: SalesCollection[];
}

export interface DeliveryNote {
  id: string;
  noteNumber: string; // ej: NE-000124
  salesOrderId: string;
  salesOrderNumber: string;
  customerName: string;
  customerTaxId: string;
  customerAddress: string;
  customerPhone: string;
  dispatchDate: string;
  exchangeRateUsed: number; // Tasa del día USD en Bs. al momento del despacho
  items: {
    description: string;
    presentationLabel: string;
    quantity: number;
    lotNumber?: string;
    unitPrice: number;
    subtotal: number;
    unitPriceBs?: number;
    subtotalBs?: number;
  }[];
  subtotal: number;
  taxIncluded: boolean;
  taxAmount: number;
  total: number;
  subtotalBs?: number;
  taxAmountBs?: number;
  totalBs?: number;
  transporter?: string;
  receivedByName?: string;
  receivedById?: string;
  signatureDate?: string;
  status: 'emitida' | 'entregada' | 'anulada';
  observations?: string;
}

export type FiscalRegime = 'ordinario' | 'especial';
export type FiscalBooksFormat = 'xlsx' | 'csv' | 'pdf' | 'txt';
export type DigitalInvoicingEnvironment = 'pruebas' | 'produccion';
export type HistoricalOrdersTreatment =
  | 'no_emitir'
  | 'emitir_actual'
  | 'revisar';

export interface FiscalSettings {
  enabled: boolean;
  companyName: string;
  companyTaxId: string; // RIF/NIT/RFC
  fiscalAddress: string;
  companyPhone: string;
  companyEmail: string;
  economicActivity: string;
  taxRegime: FiscalRegime;
  taxRatePercent: number; // ej: 16% IVA
  invoicePrefix: string; // ej: FACT-
  invoiceSerie: string; // ej: A
  nextInvoiceNumber: number;
  controlPrefix: string; // prefijo del número de control
  nextControlNumber: number;
  nextCreditNoteNumber: number;
  nextDebitNoteNumber: number;
  authorizationCode: string;
  authorizationValidUntil: string; // yyyy-mm-dd
  branchName: string; // sucursal / establecimiento
  branchAddress: string;
  vatWithholdingAgent: boolean;
  vatWithholdingPercent: number; // % de retención de IVA
  islrWithholdingAgent: boolean;
  islrWithholdingPercent: number; // % de retención de ISLR
  specialTaxpayer: boolean; // Sujeto Pasivo Especial (SPE)
  /** Habilita el módulo Contabilidad. El plan de cuentas base es provisional hasta #13. */
  accountingEnabled: boolean;
  /** Retenciones de IVA. Permanecen apagadas hasta la validación contable (#13). */
  vatWithholdingEnabled: boolean;
  /** Retenciones de ISLR. Permanecen apagadas hasta la validación contable (#13). */
  islrWithholdingEnabled: boolean;
  booksFormat: FiscalBooksFormat;
  historicalOrdersTreatment: HistoricalOrdersTreatment;
  printNotes: string;
  /** Solo preparación: no emite ni envía nada al SENIAT todavía. */
  digitalInvoicingEnabled: boolean;
  digitalInvoicingProvider: string;
  digitalInvoicingProviderTaxId: string;
  digitalInvoicingApiUrl: string;
  digitalInvoicingEnvironment: DigitalInvoicingEnvironment;
  digitalInvoicingCertificateLabel: string;
  digitalInvoicingCertificateExpiry: string;
  digitalInvoicingStartDate: string;
  digitalInvoicingNotes: string;
}

export type FiscalObligationKey =
  | 'tax_regime'
  | 'special_taxpayer'
  | 'vat_withholding'
  | 'islr_withholding'
  | 'igtf'
  | 'digital_invoicing'
  | 'snat_2026_00093'
  | 'fiscal_documents'
  | 'fiscal_books'
  | 'legal_reconversion'
  | 'opening_cutoff'
  | 'accrual_criteria'
  | 'spe_vouchers'
  | 'record_retention';

export type FiscalObligationApplicability =
  | 'pendiente'
  | 'aplica'
  | 'no_aplica';

export interface FiscalObligationRecord {
  key: FiscalObligationKey;
  title: string;
  applicability: FiscalObligationApplicability;
  normativeReference: string;
  reviewedAt: string;
  notes: string;
  updatedAt: string;
  updatedBy: string;
  updatedByRole: string;
}

export interface FiscalObligationHistoryEntry {
  id: string;
  obligationKey: FiscalObligationKey;
  obligationTitle: string;
  previous: Pick<
    FiscalObligationRecord,
    'applicability' | 'normativeReference' | 'reviewedAt' | 'notes'
  >;
  current: Pick<
    FiscalObligationRecord,
    'applicability' | 'normativeReference' | 'reviewedAt' | 'notes'
  >;
  changedAt: string;
  userId: string;
  userName: string;
  userRole: string;
}

export interface FiscalObligationsResponse {
  obligations: FiscalObligationRecord[];
  history: FiscalObligationHistoryEntry[];
}

export interface FiscalReferenceValuesResponse {
  values: FiscalReferenceValue[];
  activeIva: FiscalReferenceValue | null;
  activeUt: FiscalReferenceValue | null;
  date: string;
}

export type FiscalReferenceKind = 'iva' | 'ut' | 'islr';
export type FiscalReferenceValueUnit = 'percent' | 'bs';
export type FiscalReferenceStatus =
  | 'referencia'
  | 'confirmado'
  | 'historico'
  | 'anulado';

/** Histórico de IVA/UT/ISLR. Solo consulta; no calcula impuestos ni activa módulos (#13). */
export interface FiscalReferenceValue {
  id: string;
  kind: FiscalReferenceKind;
  value: number;
  valueUnit: FiscalReferenceValueUnit;
  /** Rubro ISLR del art. 9 del Decreto 1.808; opcional para IVA/UT. */
  conceptCode: string;
  conceptLabel: string;
  taxpayerType: FiscalReferenceTaxpayerType | '';
  sustraendoUt: number | null;
  effectiveFrom: string;
  effectiveTo: string;
  instrumentType: string;
  instrumentNumber: string;
  officialGazette: string;
  publicationDate: string;
  legalBasis: string;
  notes: string;
  status: FiscalReferenceStatus;
  confirmedByAccountant: boolean;
  supportDocument: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  annulledAt: string;
  annulledReason: string;
  annulledBy: string;
}

export type FiscalReferenceInput = Omit<
  FiscalReferenceValue,
  | 'id'
  | 'createdAt'
  | 'createdBy'
  | 'updatedAt'
  | 'annulledAt'
  | 'annulledReason'
  | 'annulledBy'
>;

/** Catálogo de referencia de la Fase 0: clasificación IVA y rubros ISLR. */
export type FiscalReferenceCatalogGroup = 'iva' | 'islr';
export type FiscalReferenceTaxpayerType = 'natural' | 'juridica';
export type FiscalReferenceApplicability = 'general' | 'exento' | 'reducido' | 'rubro';

export interface FiscalReferenceCatalogEntry {
  id: string;
  group: FiscalReferenceCatalogGroup;
  code: string;
  label: string;
  applicability: FiscalReferenceApplicability;
  ratePercent: number | null;
  taxpayerTypes: FiscalReferenceTaxpayerType[];
  utReference: number | null;
  sustraendo: number | null;
  legalBasis: string;
  notes: string;
  status: 'referencia';
  confirmedByAccountant: false;
}

export interface FiscalReferenceCatalogResponse {
  entries: FiscalReferenceCatalogEntry[];
  utReference: number;
  generatedAt: string;
  notes: string[];
}

export interface AccountingBookSettings {
  id: number;
  approvedFormats: string;
  auxiliaryFormat: string;
  pagination: string;
  signatureText: string;
  signatureRole: string;
  /** Firmantes del cierre #13: contador y socios. */
  accountantSigner?: string;
  partnerSigners?: string;
  /** Numeración de libro/página pendiente para las respuestas 8 y 9. */
  bookPageNumbering?: string;
  /** Instrumento y fecha de vigencia formal de las respuestas 8, 9 y 10. */
  ratificationInstrument?: string;
  exchangeRatePolicy: string;
  notes: string;
  approvedAt: string;
  updatedAt: string;
  updatedBy: string;
}

export type AccountingBookSettingsInput = Omit<
  AccountingBookSettings,
  'id' | 'updatedAt' | 'updatedBy'
>;

export const FISCAL_OBLIGATION_DEFINITIONS: readonly Pick<
  FiscalObligationRecord,
  'key' | 'title'
>[] = [
  { key: 'tax_regime', title: 'Régimen tributario de la empresa' },
  { key: 'special_taxpayer', title: 'Sujeto Pasivo Especial (SPE)' },
  { key: 'vat_withholding', title: 'Agente de retención de IVA' },
  { key: 'islr_withholding', title: 'Agente de retención de ISLR' },
  { key: 'igtf', title: 'Impuesto a las Grandes Transacciones Financieras (IGTF)' },
  { key: 'digital_invoicing', title: 'Facturación digital y autorización aplicable' },
  { key: 'snat_2026_00093', title: 'Transición a SNAT/2026/00093' },
  { key: 'fiscal_documents', title: 'Requisitos de facturas, notas y leyendas' },
  { key: 'fiscal_books', title: 'Formato y campos de libros fiscales' },
  { key: 'legal_reconversion', title: 'Reconversión y acta constitutiva (#13)' },
  { key: 'opening_cutoff', title: 'Fecha de corte y saldos de apertura (#13)' },
  { key: 'accrual_criteria', title: 'Criterio pago vs. devengo (#13)' },
  { key: 'spe_vouchers', title: 'Comprobantes SPE y Libro de Retenciones (#13)' },
  { key: 'record_retention', title: 'Conservación, firmantes y bitácora (#13)' },
];

/**
 * Fiscal invoice emitted for a sale.
 *
 * The emitter and customer data are copied (snapshotted) at emission time so
 * later edits to the masters never alter an already issued document. Invoice
 * and control numbers are consecutive and never reused, even when annulled.
 */
export type FiscalInvoiceStatus = 'emitida' | 'anulada';

export interface FiscalInvoiceEmitterSnapshot {
  companyName: string;
  companyTaxId: string;
  fiscalAddress: string;
  companyPhone?: string;
  companyEmail?: string;
  economicActivity?: string;
  taxRegime?: FiscalRegime;
  branchName?: string;
  branchAddress?: string;
  invoicePrefix?: string;
  controlPrefix?: string;
  authorizationCode?: string;
  authorizationValidUntil?: string;
  printNotes?: string;
}

export interface FiscalInvoiceCustomerSnapshot {
  customerId: string;
  businessName: string;
  taxId: string;
  nit?: string;
  address?: string;
  phone?: string;
}

export interface FiscalInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  taxCategory?: SalesTaxCategory;
  taxRatePercent: number;
  taxAmount: number;
  total: number;
}

export interface FiscalInvoice {
  id: string;
  serie: string;
  invoiceNumber: number;
  controlNumber: number;
  saleCondition: FiscalSaleCondition;
  paymentMethod: FiscalPaymentMethod;
  /** Plazo pactado al emitir; se copia del pedido (0 en ventas de contado). */
  creditDays: number;
  salesOrderId?: string;
  salesOrderNumber?: string;
  emitterSnapshot: FiscalInvoiceEmitterSnapshot;
  customerSnapshot: FiscalInvoiceCustomerSnapshot;
  items: FiscalInvoiceLine[];
  subtotal: number;
  taxAmount: number;
  total: number;
  subtotalBs?: number;
  taxAmountBs?: number;
  totalBs?: number;
  exchangeRateUsed: number;
  status: FiscalInvoiceStatus;
  issuedAt: string;
  printCount: number;
  annulledAt?: string;
  annulledBy?: string;
  annulmentReason?: string;
  periodYear: number;
  periodMonth: number;
}

export type FiscalAdjustmentType = 'nota_credito' | 'nota_debito';
export type FiscalAdjustmentReason =
  | 'devolucion'
  | 'descuento'
  | 'bonificacion'
  | 'error_precio'
  | 'anulacion_parcial'
  | 'otro';

export interface FiscalAdjustmentLine {
  description: string;
  subtotal: number;
  taxCategory: SalesTaxCategory;
  taxRatePercent: number;
  taxAmount: number;
  total: number;
}

export interface FiscalAdjustmentNote {
  id: string;
  type: FiscalAdjustmentType;
  serie: string;
  noteNumber: number;
  controlNumber: number;
  fiscalInvoiceId: string;
  invoiceNumber: string;
  invoiceControlNumber: number;
  invoiceIssuedAt: string;
  emitterSnapshot: FiscalInvoiceEmitterSnapshot;
  customerSnapshot: FiscalInvoiceCustomerSnapshot;
  reason: FiscalAdjustmentReason;
  reasonDetails?: string;
  items: FiscalAdjustmentLine[];
  subtotal: number;
  taxAmount: number;
  total: number;
  exchangeRateUsed: number;
  issuedAt: string;
  issuedBy: string;
  printCount: number;
  periodYear: number;
  periodMonth: number;
}

export interface FiscalPeriodClosure {
  year: number;
  month: number;
  closedAt: string;
  closedBy: string;
  snapshotHash: string;
  salesTotal: number;
  purchaseTotal: number;
}

export interface FiscalBooksSalesRow {
  id: string;
  date: string;
  documentType: 'factura' | 'nota_credito' | 'nota_debito' | 'factura_anulada';
  documentNumber: string;
  controlNumber: string;
  customerName: string;
  customerTaxId: string;
  saleCondition: FiscalSaleCondition;
  taxableBases: { rate: number; base: number; tax: number }[];
  exemptAmount: number;
  nonSubjectAmount: number;
  taxAmount: number;
  total: number;
}

export interface FiscalBooksPurchaseRow {
  id: string;
  date: string;
  documentType: Expense['documentType'];
  documentNumber: string;
  supplierName: string;
  supplierTaxId: string;
  exemptAmount: number;
  nonSubjectAmount: number;
  taxableBase: number;
  taxRatePercent: number;
  taxAmount: number;
  total: number;
  vatWithholding: number;
  fiscalCreditEligible: boolean;
}

export interface FiscalBooksReport {
  year: number;
  month: number;
  isClosed: boolean;
  closure?: FiscalPeriodClosure;
  salesRows: FiscalBooksSalesRow[];
  purchaseRows: FiscalBooksPurchaseRow[];
  salesTotals: {
    taxableBases: { rate: number; base: number; tax: number }[];
    exemptAmount: number;
    nonSubjectAmount: number;
    taxAmount: number;
    total: number;
  };
  purchaseTotals: {
    taxableBase: number;
    exemptAmount: number;
    nonSubjectAmount: number;
    taxAmount: number;
    vatWithholding: number;
    total: number;
  };
  reconciliation: {
    salesDifference: number;
    purchaseDifference: number;
    /** IVA débito de las ventas del período. */
    taxDebit: number;
    /** IVA crédito de los gastos elegibles, descontando retenciones. */
    taxCredit: number;
    /** Débito menos crédito; positivo significa saldo a pagar. */
    netTaxPayable: number;
  };
}

export interface Employee {
  id: string;
  fullName: string;
  nationalId: string;
  roleTitle: string; // ej: Maestro de Marmitas, Auxiliar de Empaque
  weeklyBaseSalary: number;
  hourlyRate: number;
  status: 'activo' | 'vacaciones' | 'inactivo';
}

export interface PayrollWeek {
  id: string;
  weekNumber: number; // 1 a 52
  year: number;
  startDate: string;
  endDate: string;
  isActiveProduction: boolean; // TRUE: semana con producción; FALSE: semana inactiva (sin producción)
  inactivityReason?: 'mantenimiento_preventivo' | 'escasez_fruta' | 'acumulacion_stock' | 'vacaciones_colectivas' | 'temporada_baja';
  payments: {
    employeeId: string;
    employeeName: string;
    roleTitle: string;
    baseAmount: number;
    productionBonus: number;
    deductions: number;
    netPaid: number;
  }[];
  totalPayrollPaid: number;
  fixedAbsorptionCost: number; // Costo fijo absorbido o trasladado a gastos operativos
  bonusByRole?: Record<string, number>; // Bono por rendimiento discriminado por cargo
  notes?: string;
}

export interface CostStructureAnalysis {
  directMaterialsCostAverage: number;
  directLaborWeeklyAverage: number;
  indirectManufacturingCostsWeekly: number;
  inactiveWeeksCountYTD: number;
  unabsorbedFixedCostYTD: number;
  costBreakdownByPresentation: {
    presentation: PresentationType;
    label: string;
    directMaterial: number;
    directPackaging: number;
    directLabor: number;
    cifAllocation: number;
    totalUnitCost: number;
    suggestedWholesalePrice: number;
    suggestedRetailPrice: number;
    marginWholesalePercent: number;
    marginRetailPercent: number;
  }[];
}

export interface MonthlySalesStat {
  month: string; // ej: 'Agosto', 'Septiembre', 'Octubre'
  year: number;
  smallUnitsSold: number;
  largeUnitsSold: number;
  totalRevenue: number;
  grossMargin: number;
  grossMarginPercent: number;
}

export interface ExchangeRateRecord {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm:ss
  usdRate: number; // Tasa USD Oficial (BCV) en Bs.
  usdtRate: number; // Tasa USDT Paralelo/Binance en Bs.
  source: string; // ej: 'BCV / Oficial', 'Binance P2P / Monitor', 'Ajuste Manual'
  window: 'manana_8_10' | 'tarde_1230_15' | 'extraordinaria';
  variationUsdPercent?: number;
  variationUsdtPercent?: number;
  notes?: string;
}

export interface DailyExchangeRates {
  currentUsd: number;
  currentUsdt: number;
  lastUpdated: string;
  isInActiveWindow: boolean;
  activeWindowName: string;
  nextScheduledCheck: string;
  history: ExchangeRateRecord[];
}

export interface WeeklySalesStat {
  week: string; // ej: 'Sem 36', 'Sem 37'
  label: string; // ej: 'Semana 36 (31 Ago - 06 Sep)'
  startDate: string;
  endDate: string;
  revenue: number; // Ingresos brutos en USD
  cost: number; // Costos operacionales directos en USD
  margin: number; // Margen bruto en USD
  marginPercent: number; // Margen %
  smallUnitsSold: number; // Frasco 250g
  largeUnitsSold: number; // Frasco 1000g
  totalUnits: number; // Total unidades vendidas
  status: 'activa' | 'inactiva';
}

export interface InventoryTurnoverStat {
  period: string; // ej: 'Sem 36', 'Sem 37'
  label: string;
  turnoverRatio: number; // Veces de rotación anualizada (COGS / Inventario promedio)
  daysOfSupply: number; // Días de inventario en almacén
  rawMaterialsTurnover: number; // Rotación insumos y pulpa
  finishedGoodsTurnover: number; // Rotación producto terminado
  packagingTurnover: number; // Rotación envases de vidrio y tapas
  holdingCost: number; // Costo estimado de inmovilización en almacén USD
  status: 'activa' | 'inactiva';
}

export interface InventoryTurnoverCategory {
  category: string;
  turnoverRatio: number;
  inventoryValueUsd: number;
  averageDaysInWarehouse: number;
  turnoverClassification: 'Alta Rotación' | 'Rotación Media' | 'Baja Rotación';
  description: string;
}

export interface ProductionStockAlert {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  category: MaterialCategory;
  unit: UnitOfMeasure;
  currentStock: number;
  minStock: number;
  isBelowMinStock: boolean;
  requiredForActiveOrders: number;
  insufficientForProduction: boolean;
  productionShortage: number; // Max(0, requiredForActiveOrders - currentStock)
  severity: 'critical' | 'warning' | 'caution';
  affectedOrders: {
    orderId: string;
    orderNumber: string;
    recipeName: string;
    required: number;
    batchCount: number;
    status: ProductionOrderStatus;
  }[];
  affectedRecipes: {
    recipeId: string;
    recipeName: string;
    quantityPerBatch: number;
    maxBatchesPossible: number;
  }[];
  estimatedReplenishCostUsd: number;
  estimatedReplenishCostBs: number;
  recommendation: string;
}

export interface RecipeFeasibilityResult {
  recipeId: string;
  recipeName: string;
  batchCount: number;
  targetUnits: number;
  canProduce: boolean;
  totalMissingCount: number;
  missingMaterials: {
    materialId: string;
    materialName: string;
    category: MaterialCategory;
    unit: UnitOfMeasure;
    required: number;
    available: number;
    deficit: number;
    estimatedCostToCoverUsd: number;
    estimatedCostToCoverBs: number;
  }[];
  sufficientMaterials: {
    materialId: string;
    materialName: string;
    unit: UnitOfMeasure;
    required: number;
    available: number;
    remainingAfter: number;
  }[];
}

// --- ESTRUCTURA DE COSTOS DETALLADA (HOJA EXCEL IMAGEN 2) ---
export interface RawMaterialCostItem {
  id: string;
  description: string;
  costBcv: number; // Costo compra (saco, cesta, litro)
  presentation: number; // Kilos o unidades por empaque
  presentationUnit: string; // 'cesta', 'saco 50kg', 'saco 25kg', 'litro'
  unitCost: number; // Costo por kg o por litro
  costPerGram: number; // Costo por gramo
  cantProduction: number; // Cantidad consumida en la producción
  costPerProduction: number; // Costo total consumido
}

export interface PackagingCostItem {
  id: string;
  presentation: string; // Potes 20kg, Etiquetas, CAJA, TIRRO, BOLSA, TIRRAJE
  quantity?: number;
  totalAmount?: number;
  rate?: number;
  unitCost: number;
}

export interface SampleCostItem {
  id: string;
  description: string;
  bulkCost?: number;
  unitCost: number;
}

export interface FixedExpenseItem {
  id: string;
  concept: string;
  monthlyAmount: number;
  workDays: number;
  dailyAmount: number;
  costPerKg: number;
}

export interface WorkerPayrollItem {
  id: string;
  name: string;
  weeklySalary: number;
  role?: string;
}

export interface FinishedPresentationCost {
  id: string;
  name: string;
  weightKg: number;
  packagingCost: number;
  rawMaterialPerKg: number;
  fixedCostPerKg: number;
  rawMaterialTotal: number;
  fixedCostTotal: number;
  costWithoutPackaging: number;
  totalUnitCost: number;
  marginPrices: {
    margin20: number;
    margin25: number;
    margin30: number;
    customMarginPercent: number;
    customPrice: number;
  };
}

export type AuditModule =
  | 'inventario'
  | 'produccion'
  | 'costos'
  | 'ventas'
  | 'gastos'
  | 'compras'
  | 'contabilidad';
export type AuditSeverity = 'info' | 'success' | 'warning' | 'critical';

export interface AuditLogDetails {
  targetId?: string;
  targetCode?: string;
  itemName?: string;
  quantity?: number;
  unit?: string;
  costUsd?: number;
  amount?: number;
  remainingUsd?: number;
  collectionCount?: number;
  lotNumber?: string;
  brix?: number;
  wasteKg?: number;
  previousStock?: number;
  newStock?: number;
  movementDate?: string;
  registeredAt?: string;
  referenceDoc?: string;
  supplierId?: string;
  supplierName?: string;
  taxId?: string;
  salesOrderId?: string;
  invoiceId?: string;
  payableId?: string;
  movementId?: string;
  origin?: string;
  entryNumber?: string;
  accountCode?: string;
  periodKey?: string;
  cutoffDate?: string;
  openingEntryId?: string;
  balances?: number;
  adjustmentId?: string;
  exchangeRateUsed?: number;
  rateSource?: string;
  sourceType?: string;
  reason?: string;
  previousStatus?: string;
  status?: string;
  documentType?: string;
  adjustmentType?: FiscalAdjustmentType;
  year?: number;
  month?: number;
  snapshotHash?: string;
  salesTotal?: number;
  purchaseTotal?: number;
  operatorNotes?: string;
  formulas?: string[];
  changes?: string[];
  bankCode?: string;
  bankName?: string;
  totalUnits?: number;
  expenses?: number;
  orders?: number;
  movements?: number;
  materials?: number;
  products?: number;
  printCount?: number;
  isDuplicate?: boolean;
  repairedEntries?: number;
  firstBrokenEntryId?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string; // ISO-8601
  module: AuditModule;
  actionType:
    | 'entrada_materia_prima'
    | 'salida_produccion'
    | 'ajuste_merma'
    | 'ajuste_existencia'
    | 'insumo_actualizado'
    | 'reabastecimiento_alerta'
    | 'orden_produccion_creada'
    | 'orden_produccion_procesada'
    | 'orden_manual_creada'
    | 'orden_manual_actualizada'
    | 'orden_manual_eliminada'
    | 'orden_manual_procesada'
    | 'orden_manual_anulada'
    | 'receta_bom_creada'
    | 'presentacion_creada'
    | 'presentacion_actualizada'
    | 'presentacion_eliminada'
    | 'producto_terminado_creado'
    | 'producto_terminado_actualizado'
    | 'alerta_stock_critico'
    | 'gasto_registrado'
    | 'gasto_eliminado'
    | 'gasto_elegibilidad_actualizada'
    | 'categoria_gasto_creada'
    | 'categoria_gasto_actualizada'
    | 'categoria_gasto_eliminada'
    | 'payable_registrado'
    | 'payable_actualizado'
    | 'payable_actualizado_linea_inventario'
    | 'payable_anulado'
    | 'payable_pago_registrado'
    | 'proveedor_creado'
    | 'proveedor_actualizado'
    | 'proveedor_eliminado'
    | 'precio_proveedor_registrado'
    | 'tipo_proveedor_creado'
    | 'tipo_proveedor_actualizado'
    | 'tipo_proveedor_eliminado'
    | 'categoria_materia_prima_creada'
    | 'categoria_materia_prima_actualizada'
    | 'categoria_materia_prima_eliminada'
    | 'operacion_reseteada'
    | 'pedido_venta_creado'
    | 'cobro_registrado'
    | 'cobro_parcial_registrado'
    | 'factura_emitida'
    | 'factura_anulada'
    | 'factura_impresa'
    | 'factura_reimpresa'
    | 'configuracion_fiscal_actualizada'
    | 'obligacion_fiscal_actualizada'
    | 'nota_fiscal_creada'
    | 'nota_fiscal_impresa'
    | 'libro_fiscal_cerrado'
    | 'libro_fiscal_exportado'
    | 'cuenta_creada'
    | 'cuenta_actualizada'
    | 'asiento_creado'
    | 'asiento_automatico'
    | 'asiento_confirmado'
    | 'asiento_anulado'
    | 'cadena_hash_reparada'
    | 'periodo_contable_cerrado'
    | 'periodo_contable_abierto'
    | 'valor_fiscal_referencia_creado'
    | 'valor_fiscal_referencia_actualizado'
    | 'valor_fiscal_referencia_anulado'
    | 'valor_fiscal_referencia_vigencia_cerrada'
    | 'configuracion_libros_actualizada'
    | 'apertura_actualizada'
    | 'apertura_ajuste_registrado'
    | 'operario_inactivado'
    | 'operario_vacaciones'
    | 'operario_activado'
    | 'operario_eliminado';
  title: string;
  description: string;
  userId: string;
  userName: string;
  userRole: string;
  severity: AuditSeverity;
  details?: AuditLogDetails;
}

// --- MÓDULO DE GASTOS & EGRESOS OPERATIVOS ---
export type ExpenseCategory =
  | 'alquiler_instalaciones'
  | 'viajes_viaticos'
  | 'gastos_personales_socios'
  | 'servicios_basicos'
  | 'mantenimiento_reparacion'
  | 'ventas_fletes_marketing'
  | 'honorarios_profesionales'
  | 'suministros_oficina_planta'
  | 'otros'
  | string;

export interface ExpenseCategoryConfig {
  id: string; // ej: 'alquiler_instalaciones', 'viajes_viaticos', o id personalizado 'cat-xxx'
  name: string; // ej: 'Alquiler de Instalaciones / Planta'
  icon: string; // Material Icon name
  color: string; // Tailwind color token or hex, ej: 'amber', 'sky', 'emerald', 'purple', 'rose', 'indigo'
  monthlyBudgetUsd: number; // Presupuesto mensual asignado en USD
  accountingAccountCode?: string; // ej: 5.1.01.01
  accountingAccountName?: string;
  defaultTaxCategory?: ExpenseTaxCategory;
  description?: string;
  isSystem?: boolean; // True si es una de las categorías base del ERP
}

export type ExpenseTaxCategory =
  | 'con_factura_iva' // Con crédito fiscal para futuro Libro de Compras (Art. 56 Ley IVA)
  | 'exento' // Factura/Recibo exento de IVA
  | 'no_sujeto' // Gasto personal / Viático sin factura fiscal / No deducible
  | 'retencion_aplicada'; // Sujeto a retención de IVA o ISLR

export interface Expense {
  id: string;
  expenseNumber: string; // ej: GTO-2026-0042
  date: string; // YYYY-MM-DD
  concept: string; // Concepto o descripción del egreso
  category: ExpenseCategory;
  categoryLabel: string;
  amountUsd: number;
  exchangeRateUsed: number;
  amountBs: number;
  supplierOrBeneficiary: string; // Razón social del proveedor o nombre del beneficiario
  /** Presente cuando el beneficiario se seleccionó desde el maestro de proveedores. */
  supplierId?: string;
  taxId?: string; // RIF o Cédula (J-..., V-...)
  documentType: 'factura_fiscal' | 'recibo_pago' | 'nota_debito' | 'vale_caja' | 'otro';
  documentNumber?: string; // Nro. de Factura / Control / Recibo
  paymentMethod: 'transferencia_bancaria' | 'pago_movil' | 'efectivo_usd' | 'efectivo_bs' | 'zelle' | 'tarjeta';
  paymentReference?: string;
  issuingBankCode?: string; // Código SUDEBAN del banco emisor (obligatorio para pagos bancarios)
  issuingBankName?: string; // Nombre oficial del banco emisor
  /** Cuenta contable de pago elegida para el asiento automático. */
  paymentAccountCode?: string;
  notes?: string;
  registeredBy: string;

  // Mapeo contable y fiscal para futuro desarrollo (Libro de Compras, Libro Diario, Libro Mayor)
  taxCategory: ExpenseTaxCategory;
  taxRatePercent?: number; // ej: 16.0
  taxAmountUsd?: number;
  taxAmountBs?: number;
  accountingAccountCode?: string; // ej: 5.1.01.01 (Alquileres), 5.1.02.04 (Viáticos), 5.2.01 (Gastos Personales/Socios)
  accountingAccountName?: string;
  fiscalBookEligible: boolean; // True si califica para el Libro de Compras formal SENIAT
  /** Presente cuando el gasto se generó automáticamente al saldar un payable. */
  payableId?: string;
}

export type PayableStatus = 'pendiente' | 'parcial' | 'pagada' | 'anulada';

/** Origen derivado de la factura por pagar (no se persiste como columna). */
export type PayableOrigin = 'compra_inventario' | 'manual';

/** Factura de proveedor pendiente de pago (USD canónico, Bs derivado). */
export interface Payable {
  id: string;
  payableNumber: string; // FAP-YYYY-NNN
  supplierId?: string;
  supplierName: string;
  taxId?: string;
  invoiceNumber: string;
  controlNumber?: string;
  issueDate: string;
  dueDate: string;
  amountUsd: number;
  exchangeRateUsed: number;
  amountBs: number;
  taxAmountUsd?: number;
  category: ExpenseCategory;
  status: PayableStatus;
  notes?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  expenseId?: string;
  /** Calculado desde los movimientos de inventario vinculados. */
  origin?: PayableOrigin;
  movementId?: string;
  linkedMovementCount?: number;
}

export interface PayablePayment {
  id: string;
  payableId: string;
  bankCode: string;
  bankName: string;
  paymentMethod: Expense['paymentMethod'];
  /** Cuenta contable de salida elegida para el asiento automático. */
  accountCode?: string;
  reference: string;
  amountUsd: number;
  amountBs: number;
  exchangeRateUsed: number;
  paidAt: string;
  paidBy: string;
}

// --- CONTABILIDAD (FASE 1) ---

export type AccountType =
  | 'activo'
  | 'pasivo'
  | 'patrimonio'
  | 'ingreso'
  | 'gasto'
  | 'costo';

export type AccountNature = 'debito' | 'credito';

/** Cuenta del plan de cuentas jerárquico. */
export interface Account {
  id: string;
  code: string; // ej: 1.01.01
  name: string;
  type: AccountType;
  nature: AccountNature;
  parentCode?: string;
  level: number;
  active: boolean;
  isSystem: boolean;
  description?: string;
  /** Clasificación funcional para filtros y asientos automáticos (#13). */
  kind?: 'banco' | 'caja' | 'otra';
  bankCode?: string;
  bankName?: string;
  accountNumber?: string;
  currency?: 'USD' | 'Bs' | 'AMBAS';
  /** Saldo de referencia editable; no constituye asiento ni saldo de libros (#13). */
  referenceBalanceUsd?: number;
  referenceBalanceUpdatedAt?: string;
  referenceBalanceNote?: string;
  createdAt: string;
  updatedAt: string;
}

export type AccountingEntrySource =
  | 'manual'
  | 'venta'
  | 'cobro'
  | 'gasto'
  | 'pago_cxp'
  | 'nomina'
  | 'inventario'
  | 'nota_credito'
  | 'nota_debito'
  | 'retencion'
  | 'apertura';

export type AccountingEntryStatus = 'borrador' | 'confirmado' | 'anulado';

/** Línea de doble entrada. Uno de debit/credit debe ser mayor que cero. */
export interface AccountingEntryLine {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo?: string;
}

/** Asiento contable con balance validado (suma débitos = suma créditos). */
export interface AccountingEntry {
  id: string;
  entryNumber: string; // AS-YYYY-NNNN
  date: string; // YYYY-MM-DD
  description: string;
  sourceType: AccountingEntrySource;
  sourceId?: string;
  status: AccountingEntryStatus;
  lines: AccountingEntryLine[];
  totalDebit: number;
  totalCredit: number;
  currency: 'USD';
  exchangeRateUsed: number;
  periodKey: string; // YYYY-MM
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  annulledAt?: string;
  annulmentReason?: string;
  /** Cadena hash autorizada: enlace con el asiento anterior. */
  previousHash?: string;
  entryHash?: string;
  hashSequence?: number;
}

/** Resultado de verificar la integridad de la cadena hash de asientos. */
export interface AccountingHashVerification {
  valid: boolean;
  checkedEntries: number;
  repairedEntries: number;
  firstBrokenEntryId?: string;
  lastHash: string;
  checkedAt: string;
}

export type AccountingPeriodStatus = 'abierto' | 'cerrado';

/** Período mensual controlable para bloquear asientos y cierres. */
export interface AccountingPeriod {
  id: string; // YYYY-MM
  key: string;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatus;
  closedAt?: string;
  closedBy?: string;
}

// --- APERTURA PROVISIONAL #13 ---

/** Origen de la tasa guardada en cada línea de apertura. */
export type OpeningRateSource = 'currentUsd (referencia)' | 'Tasa capturada en apertura';

export interface OpeningAmount {
  amountUsd: number;
  amountBs: number;
  exchangeRateUsed: number;
  rateSource: OpeningRateSource;
}

export interface OpeningAmountInput {
  amountUsd?: number;
  amountBs?: number;
  exchangeRateUsed?: number;
  rateSource?: OpeningRateSource;
}

export interface OpeningLegalEntityDraft {
  currentName: string;
  convertedName: string;
  legalForm: string;
  reconversionInstrument: string;
  reconversionDate: string;
  notes: string;
}

export interface OpeningGeneralBalance extends OpeningAmount {
  id: string;
  accountCode: string;
  memo?: string;
}

export type OpeningAuxiliaryKind = 'banco' | 'clientes' | 'proveedores';

export interface OpeningAuxiliaryBalance extends OpeningAmount {
  id: string;
  kind: OpeningAuxiliaryKind;
  name: string;
  accountCode: string;
  memo?: string;
}

export interface OpeningShareholder extends OpeningAmount {
  id: string;
  name: string;
  taxId?: string;
  contributionType?: string;
  accountCode?: string;
}

export type OpeningAdjustmentDirection = 'debito' | 'credito';

export interface OpeningAdjustment extends OpeningAmount {
  id: string;
  date: string;
  accountCode: string;
  description: string;
  direction: OpeningAdjustmentDirection;
}

/**
 * Borrador editable de apertura. Nunca confirma el asiento ni alimenta libros:
 * la autorización contable expresa queda fuera de esta entrega (#13).
 */
export interface AccountingOpeningDraft {
  id: 'apertura-13';
  status: 'borrador';
  postingStatus: 'borrador_provisional';
  legalEntity: OpeningLegalEntityDraft;
  cutoffDate: string;
  shareholders: OpeningShareholder[];
  generalBalances: OpeningGeneralBalance[];
  auxiliaryBalances: OpeningAuxiliaryBalance[];
  adjustments: OpeningAdjustment[];
  openingEntryId?: string;
  notes: string;
  updatedAt: string;
  updatedBy: string;
}

export interface OpeningReconciliationLine {
  source: 'general' | 'auxiliar' | 'accionista' | 'ajuste';
  reference: string;
  accountCode: string;
  debitUsd: number;
  creditUsd: number;
  debitBs: number;
  creditBs: number;
  exchangeRateUsed: number;
  rateSource: OpeningRateSource;
}

export interface OpeningReconciliation {
  lines: OpeningReconciliationLine[];
  debitsUsd: number;
  creditsUsd: number;
  differenceUsd: number;
  debitsBs: number;
  creditsBs: number;
  differenceBs: number;
  balanced: boolean;
  /** Texto listo para mostrar el faltante de contrapartida en USD y Bs. */
  pendingMessage: string;
  entryLines: {accountCode: string; debit: number; credit: number; memo?: string}[];
}

const roundOpeningMoney = (value: number): number =>
  Number((Number.isFinite(value) ? value : 0).toFixed(2));

/** Genera un id local estable para las filas editables de la apertura. */
export function newOpeningRowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Normaliza un monto dual. Si el usuario captura Bs. sin USD, deriva el USD con
 * la tasa de esa fila; en caso contrario el USD es la fuente y el Bs se deriva.
 */
export function normalizeOpeningAmount(
  input: OpeningAmountInput,
  fallbackRate: number
): OpeningAmount {
  const rate = Number.isFinite(Number(input.exchangeRateUsed))
    ? Number(input.exchangeRateUsed)
    : Number(fallbackRate);
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 0;
  const amountUsd = Math.max(0, Number(input.amountUsd) || 0);
  const amountBs = Math.max(0, Number(input.amountBs) || 0);
  const sourceUsd = amountUsd > 0 ? amountUsd : safeRate > 0 ? amountBs / safeRate : 0;
  return {
    amountUsd: roundOpeningMoney(sourceUsd),
    amountBs: roundOpeningMoney(sourceUsd > 0 ? sourceUsd * safeRate : 0),
    exchangeRateUsed: roundOpeningMoney(safeRate),
    rateSource: input.exchangeRateUsed ? 'Tasa capturada en apertura' : 'currentUsd (referencia)',
  };
}

export function createDefaultAccountingOpening(
  fallbackRate = 48.35
): AccountingOpeningDraft {
  const zero = (accountCode: string, id: string): OpeningGeneralBalance => ({
    id,
    accountCode,
    ...normalizeOpeningAmount(
      {amountUsd: 0, exchangeRateUsed: fallbackRate},
      fallbackRate
    ),
  });
  const aux = (
    id: string,
    kind: OpeningAuxiliaryKind,
    name: string,
    accountCode: string,
    amountUsd: number
  ): OpeningAuxiliaryBalance => ({
    id,
    kind,
    name,
    accountCode,
    ...normalizeOpeningAmount(
      {amountUsd, exchangeRateUsed: fallbackRate},
      fallbackRate
    ),
  });
  return {
    id: 'apertura-13',
    status: 'borrador',
    postingStatus: 'borrador_provisional',
    legalEntity: {
      currentName: '',
      convertedName: '',
      legalForm: '',
      reconversionInstrument: '',
      reconversionDate: '',
      notes:
        'Referencia del acta: Bs. 3.000.000.000,00 (1.000 acciones nominativas por Bs. 3.000.000,00, 100 % suscritas y pagadas). Sin conversión automática; pendiente de cotejo con el contador (#13).',
    },
    cutoffDate: '',
    shareholders: [],
    generalBalances: [
      zero('1.01.01', 'ob-gen-caja'),
      zero('3.01', 'ob-gen-capital'),
      zero('3.02', 'ob-gen-utilidades'),
      zero('2.02.01', 'ob-gen-iva-por-pagar'),
    ],
    auxiliaryBalances: [
      aux('ob-aux-banco', 'banco', 'Banco principal', '1.01.02', 30000),
      aux('ob-aux-clientes', 'clientes', 'Clientes', '1.02.01', 0),
      aux('ob-aux-proveedores', 'proveedores', 'Proveedores', '2.01.01', 0),
    ],
    adjustments: [],
    notes:
      'Asiento de apertura borrador/provisional. No validado por el contador; no activa retenciones, facturación digital ni cadena hash (#13).',
    updatedAt: new Date(0).toISOString(),
    updatedBy: 'sistema',
  };
}

/** Naturaleza contable por código, con fallback seguro para cuentas nuevas. */
export function openingAccountSide(
  account: Pick<Account, 'code' | 'type' | 'nature'> | undefined
): OpeningAdjustmentDirection {
  if (!account) return 'debito';
  if (account.nature === 'credito') return 'credito';
  if (account.nature === 'debito') return 'debito';
  return ['pasivo', 'patrimonio', 'ingreso'].includes(account.type) ? 'credito' : 'debito';
}

/**
 * Cuadre en tiempo real de la apertura. Las líneas hijas (auxiliares) se suman
 * una sola vez: los saldos generales son cuentas sin auxiliar.
 */
export function summarizeOpening(
  opening: AccountingOpeningDraft,
  accounts: Pick<Account, 'code' | 'name' | 'type' | 'nature'>[]
): OpeningReconciliation {
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const lines: OpeningReconciliationLine[] = [];
  const push = (
    source: OpeningReconciliationLine['source'],
    reference: string,
    accountCode: string,
    direction: OpeningAdjustmentDirection,
    amount: OpeningAmount,
    memo?: string
  ): void => {
    const debitUsd = direction === 'debito' ? amount.amountUsd : 0;
    const creditUsd = direction === 'credito' ? amount.amountUsd : 0;
    const debitBs = direction === 'debito' ? amount.amountBs : 0;
    const creditBs = direction === 'credito' ? amount.amountBs : 0;
    if (debitUsd === 0 && creditUsd === 0) return;
    lines.push({
      source,
      reference,
      accountCode,
      debitUsd: roundOpeningMoney(debitUsd),
      creditUsd: roundOpeningMoney(creditUsd),
      debitBs: roundOpeningMoney(debitBs),
      creditBs: roundOpeningMoney(creditBs),
      exchangeRateUsed: amount.exchangeRateUsed,
      rateSource: amount.rateSource,
    });
    if (memo) {
      lines[lines.length - 1]!.reference = `${reference} · ${memo}`;
    }
  };

  for (const balance of opening.generalBalances || []) {
    push(
      'general',
      balance.accountCode,
      balance.accountCode,
      openingAccountSide(byCode.get(balance.accountCode)),
      balance,
      balance.memo
    );
  }
  for (const balance of opening.auxiliaryBalances || []) {
    push(
      'auxiliar',
      `${balance.kind}: ${balance.name}`,
      balance.accountCode,
      openingAccountSide(byCode.get(balance.accountCode)),
      balance,
      balance.memo
    );
  }
  for (const shareholder of opening.shareholders || []) {
    push(
      'accionista',
      shareholder.name,
      shareholder.accountCode || '3.01',
      'credito',
      shareholder
    );
  }
  for (const adjustment of opening.adjustments || []) {
    push(
      'ajuste',
      adjustment.description,
      adjustment.accountCode,
      adjustment.direction,
      adjustment,
      adjustment.date
    );
  }

  const debitsUsd = roundOpeningMoney(lines.reduce((sum, line) => sum + line.debitUsd, 0));
  const creditsUsd = roundOpeningMoney(lines.reduce((sum, line) => sum + line.creditUsd, 0));
  const debitsBs = roundOpeningMoney(lines.reduce((sum, line) => sum + line.debitBs, 0));
  const creditsBs = roundOpeningMoney(lines.reduce((sum, line) => sum + line.creditBs, 0));
  const differenceUsd = roundOpeningMoney(debitsUsd - creditsUsd);
  const differenceBs = roundOpeningMoney(debitsBs - creditsBs);
  const balanced = Math.abs(differenceUsd) < 0.01;

  return {
    lines,
    debitsUsd,
    creditsUsd,
    differenceUsd,
    debitsBs,
    creditsBs,
    differenceBs,
    balanced,
    pendingMessage: balanced
      ? 'Cuadre provisional alcanzado; el asiento continúa en borrador hasta autorización expresa (#13).'
      : differenceUsd > 0
        ? `Falta contrapartida en Patrimonio/Resultados: USD ${Math.abs(differenceUsd).toFixed(2)} / Bs. ${Math.abs(differenceBs).toFixed(2)} (débitos mayores).`
        : `Falta contrapartida en Patrimonio/Resultados: USD ${Math.abs(differenceUsd).toFixed(2)} / Bs. ${Math.abs(differenceBs).toFixed(2)} (créditos mayores).`,
    entryLines: lines.map((line) => ({
      accountCode: line.accountCode,
      debit: line.debitUsd,
      credit: line.creditUsd,
      memo: `${line.source} · ${line.reference} · Bs. ${(line.debitBs + line.creditBs).toFixed(2)} @ ${line.exchangeRateUsed.toFixed(2)} (${line.rateSource})`,
    })),
  };
}

export type AccountingBookType =
  | 'diario'
  | 'mayor'
  | 'balance_comprobacion'
  | 'balance_general'
  | 'inventario'
  | 'estado_resultados'
  | 'compras'
  | 'ventas'
  | 'retenciones'
  | 'caja_banco'
  | 'auxiliar_cxc'
  | 'auxiliar_cxp';

export type AccountingBookRowType =
  | 'detail'
  | 'section'
  | 'entryTotal'
  | 'total'
  | 'grandTotal'
  | 'note'
  | 'signature';

export interface AccountingBookRow {
  cells: (string | number | null)[];
  rowType: AccountingBookRowType;
}

export interface AccountingBookMetadata {
  companyName: string;
  taxId: string;
  fiscalAddress: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  currency: 'USD';
  currencyLabel: string;
  secondaryCurrency: 'BS';
  secondaryCurrencyLabel: string;
  exchangeRateUsed: number;
  exchangeRatePolicy: string;
  generatedAt: string;
  generatedBy: string;
  totalControl: number;
  hash: string;
  provisional: boolean;
  signatureLabel: string;
}

/** Libro contable generado desde los asientos y los datos operativos existentes. */
export interface AccountingBookReport {
  type: AccountingBookType;
  title: string;
  year: number;
  month: number;
  periodKey: string;
  periodStatus: AccountingPeriodStatus;
  headers: string[];
  rows: AccountingBookRow[];
  totals: { label: string; value: number; valueBs?: number }[];
  notes: string[];
  metadata: AccountingBookMetadata;
}
