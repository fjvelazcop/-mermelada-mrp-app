export type UserRole = 'admin' | 'operator';

export type UnitOfMeasure = 'kg' | 'g' | 'l' | 'ml' | 'unidades' | 'cajas' | 'paquetes';

export type MaterialCategory = 'fruta' | 'aditivo' | 'empaque' | 'quimico';

export type PresentationType = 'pequena_250g' | 'grande_1000g' | 'otra';

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
  referenceDoc?: string; // ej: Lote L-2026-10, Factura F-442
  date: string;
  performedBy: string;
}

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
  suggestedWholesalePrice: number; // Precio mayorista (panaderías, etc.)
  suggestedRetailPrice: number; // Precio al por menor
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

export type ProductionOrderStatus = 'planificada' | 'en_proceso' | 'completada' | 'cancelada';

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
  salesOrderId?: string; // MTO: pedido de cliente asociado
  customerName?: string;
  startDate: string;
  completionDate?: string;
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
  unitCost: number;
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

export type SalesOrderStatus = 'pendiente' | 'en_produccion' | 'listo_despacho' | 'despachado' | 'cobrado';

export interface SalesOrderItem {
  finishedGoodId: string;
  flavor: string;
  presentation: PresentationType;
  presentationLabel: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
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
  items: SalesOrderItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  hasDeliveryNote: boolean;
  deliveryNoteNumber?: string;
  productionOrderId?: string;
  notes?: string;
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
  items: {
    description: string;
    presentationLabel: string;
    quantity: number;
    lotNumber?: string;
    unitPrice: number;
    subtotal: number;
  }[];
  subtotal: number;
  taxIncluded: boolean;
  taxAmount: number;
  total: number;
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
