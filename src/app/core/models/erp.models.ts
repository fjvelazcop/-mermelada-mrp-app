export type UserRole = 'admin' | 'operator' | 'operador_produccion' | string;

export type AppModuleId =
  | 'dashboard'
  | 'inventory'
  | 'production'
  | 'costing'
  | 'sales'
  | 'payroll'
  | 'expenses'
  | 'suppliers'
  | 'settings'
  | 'architecture';

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

export type UnitOfMeasure = 'kg' | 'g' | 'l' | 'ml' | 'unidades' | 'cajas' | 'paquetes';

export type MaterialCategory = 'fruta' | 'aditivo' | 'empaque' | 'quimico';

export type PresentationType =
  | 'pequena_250g'
  | 'grande_1000g'
  | 'galon_5kg'
  | 'balde_15kg'
  | 'pote_20kg'
  | 'caja_20kg'
  | 'otra';

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
  date: string;
  performedBy: string;
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
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  clientType: 'panaderia' | 'fabricante_bocadillos' | 'pasteleria' | 'distribuidor' | 'otro';
  creditLimit: number;
  paymentTerms: string; // Contado, 7 días, 15 días
}

export type SupplierType =
  | 'fruta'
  | 'aditivo'
  | 'empaque'
  | 'quimico'
  | 'servicios'
  | 'otro';

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

export type SalesOrderStatus = 'pendiente' | 'en_produccion' | 'listo_despacho' | 'despachado' | 'cobrado';

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
}

export interface SalesOrder {
  id: string;
  orderNumber: string; // ej: PED-2026-042
  customerId: string;
  customerName: string;
  customerTaxId: string;
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
  collection?: {
    bankCode: string;
    bankName: string;
    paymentMethod: 'transferencia_bancaria' | 'pago_movil' | 'efectivo_usd' | 'efectivo_bs' | 'zelle' | 'tarjeta';
    reference: string;
    amountUsd: number;
    amountBs?: number;
    exchangeRateUsed: number;
    collectedAt: string;
    collectedBy: string;
  };
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

export interface FiscalSettings {
  enabled: boolean;
  companyName: string;
  companyTaxId: string; // RIF/NIT/RFC
  fiscalAddress: string;
  taxRatePercent: number; // ej: 16% IVA
  invoicePrefix: string; // ej: FACT-
  nextInvoiceNumber: number;
  authorizationCode: string;
  printNotes: string;
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

export type AuditModule = 'inventario' | 'produccion' | 'costos' | 'ventas' | 'gastos' | 'compras';
export type AuditSeverity = 'info' | 'success' | 'warning' | 'critical';

export interface AuditLogDetails {
  targetId?: string;
  targetCode?: string;
  itemName?: string;
  quantity?: number;
  unit?: string;
  costUsd?: number;
  lotNumber?: string;
  brix?: number;
  wasteKg?: number;
  previousStock?: number;
  newStock?: number;
  referenceDoc?: string;
  salesOrderId?: string;
  operatorNotes?: string;
  formulas?: string[];
  changes?: string[];
  bankCode?: string;
  bankName?: string;
  totalUnits?: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string; // ISO-8601
  module: AuditModule;
  actionType:
    | 'entrada_materia_prima'
    | 'salida_produccion'
    | 'ajuste_merma'
    | 'reabastecimiento_alerta'
    | 'orden_produccion_creada'
    | 'orden_produccion_procesada'
    | 'orden_manual_creada'
    | 'orden_manual_actualizada'
    | 'orden_manual_eliminada'
    | 'orden_manual_procesada'
    | 'orden_manual_anulada'
    | 'receta_bom_creada'
    | 'alerta_stock_critico'
    | 'gasto_registrado'
    | 'gasto_eliminado'
    | 'proveedor_creado'
    | 'proveedor_actualizado'
    | 'proveedor_eliminado'
    | 'precio_proveedor_registrado'
    | 'pedido_venta_creado'
    | 'cobro_registrado';
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
  taxId?: string; // RIF o Cédula (J-..., V-...)
  documentType: 'factura_fiscal' | 'recibo_pago' | 'nota_debito' | 'vale_caja' | 'otro';
  documentNumber?: string; // Nro. de Factura / Control / Recibo
  paymentMethod: 'transferencia_bancaria' | 'pago_movil' | 'efectivo_usd' | 'efectivo_bs' | 'zelle' | 'tarjeta';
  paymentReference?: string;
  issuingBankCode?: string; // Código SUDEBAN del banco emisor (obligatorio para pagos bancarios)
  issuingBankName?: string; // Nombre oficial del banco emisor
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
}

