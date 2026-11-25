import { z, ZodError, type ZodType } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { ApiError, badRequest } from './errors.js';
import { findBank } from '../app/core/data/venezuelan-banks.js';

/**
 * Request payload validation with zod.
 *
 * Validated bodies replace `req.body`, so handlers only see known and
 * correctly typed fields. Validation failures are reported as HTTP 422 with a
 * list of `{ path, message }` issues.
 */

const unitSchema = z.enum(['kg', 'g', 'l', 'ml', 'unidades', 'cajas', 'paquetes']);
const presentationSchema = z.enum([
  'pequena_250g',
  'pequena_300g',
  'grande_1000g',
  'galon_5kg',
  'balde_15kg',
  'pote_20kg',
  'caja_20kg',
  'caja_6kg',
  'otra',
]);
// Validated against the editable `material_categories` catalog in the business layer.
const materialCategorySchema = z.string().trim().min(1).max(60);
const movementTypeSchema = z.enum([
  'entrada',
  'salida_produccion',
  'ajuste_merma',
]);
const salesOrderStatusSchema = z.enum([
  'pendiente',
  'en_produccion',
  'listo_despacho',
  'despachado',
  'cobrado_parcial',
  'cobrado',
]);
const priceTierSchema = z.enum([
  'mayorista',
  'detal',
  'especial',
  'personalizado',
]);
const employeeStatusSchema = z.enum(['activo', 'vacaciones', 'inactivo']);
const inactivityReasonSchema = z.enum([
  'mantenimiento_preventivo',
  'escasez_fruta',
  'acumulacion_stock',
  'vacaciones_colectivas',
  'temporada_baja',
]);
const auditModuleSchema = z.enum([
  'inventario',
  'produccion',
  'costos',
  'ventas',
  'gastos',
  'compras',
  'contabilidad',
]);
const auditSeveritySchema = z.enum(['info', 'success', 'warning', 'critical']);
const auditActionSchema = z.enum([
  'entrada_materia_prima',
  'salida_produccion',
  'ajuste_merma',
  'ajuste_existencia',
  'insumo_actualizado',
  'reabastecimiento_alerta',
  'orden_produccion_creada',
  'orden_produccion_procesada',
  'orden_manual_creada',
  'orden_manual_actualizada',
  'orden_manual_eliminada',
  'orden_manual_procesada',
  'orden_manual_anulada',
  'receta_bom_creada',
  'presentacion_creada',
  'presentacion_actualizada',
  'presentacion_eliminada',
  'producto_terminado_creado',
  'producto_terminado_actualizado',
  'alerta_stock_critico',
  'gasto_registrado',
  'gasto_eliminado',
  'gasto_elegibilidad_actualizada',
  'categoria_gasto_creada',
  'categoria_gasto_actualizada',
  'categoria_gasto_eliminada',
  'payable_registrado',
  'payable_actualizado',
  'payable_anulado',
  'payable_pago_registrado',
  'proveedor_creado',
  'proveedor_actualizado',
  'proveedor_eliminado',
  'precio_proveedor_registrado',
  'tipo_proveedor_creado',
  'tipo_proveedor_actualizado',
  'tipo_proveedor_eliminado',
  'categoria_materia_prima_creada',
  'categoria_materia_prima_actualizada',
  'categoria_materia_prima_eliminada',
  'operacion_reseteada',
  'pedido_venta_creado',
  'cobro_registrado',
  'cobro_parcial_registrado',
  'factura_emitida',
  'factura_anulada',
  'factura_impresa',
  'factura_reimpresa',
  'configuracion_fiscal_actualizada',
  'obligacion_fiscal_actualizada',
  'nota_fiscal_creada',
  'nota_fiscal_impresa',
  'libro_fiscal_cerrado',
  'libro_fiscal_exportado',
  'valor_fiscal_referencia_creado',
  'valor_fiscal_referencia_actualizado',
  'valor_fiscal_referencia_anulado',
  'valor_fiscal_referencia_vigencia_cerrada',
  'configuracion_libros_actualizada',
  'apertura_actualizada',
  'apertura_ajuste_registrado',
]);
const documentTypeSchema = z.enum([
  'factura_fiscal',
  'recibo_pago',
  'nota_debito',
  'vale_caja',
  'otro',
]);
const paymentMethodSchema = z.enum([
  'transferencia_bancaria',
  'pago_movil',
  'efectivo_usd',
  'efectivo_bs',
  'zelle',
  'tarjeta',
]);
const taxCategorySchema = z.enum([
  'con_factura_iva',
  'exento',
  'no_sujeto',
  'retencion_aplicada',
]);
const salesTaxCategorySchema = z.enum(['gravado', 'exento', 'no_sujeto']);

const money = z.coerce.number().finite().min(0);
const positive = z.coerce.number().finite().positive();
const integer = z.coerce.number().int();
const dateLike = z.string().trim().min(1).max(40);
/** Código del plan de cuentas usado por los asientos automáticos (#13). */
const transactionAccountCode = z.string().trim().min(1).max(30).regex(/^\d+(\.\d+)*$/);

export const rawMaterialSchema = z.object({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  category: materialCategorySchema,
  currentStock: money,
  minStock: money,
  unit: unitSchema,
  costPerUnit: money,
  supplier: z.string().trim().max(200).optional(),
  supplierId: z.string().trim().max(200).optional(),
  supplierTaxId: z.string().trim().max(60).optional(),
  paymentCondition: z.enum(['contado', 'credito']).optional(),
  creditDays: z.number().int().min(0).max(365).optional(),
  paymentDueDate: z.string().trim().max(40).optional(),
  lastRestockDate: dateLike,
  notes: z.string().max(1000).optional(),
});

export const rawMaterialUpdateSchema = rawMaterialSchema.partial();

export const inventoryMovementSchema = z.object({
  materialId: z.string().trim().min(1).max(200),
  materialName: z.string().trim().min(1).max(200),
  type: movementTypeSchema,
  quantity: positive,
  costPerUnit: money,
  totalCost: money,
  exchangeRateUsed: positive.optional(),
  costPerUnitBs: money.optional(),
  totalCostBs: money.optional(),
  referenceDoc: z.string().trim().max(200).optional(),
  /** Fecha operativa elegida por el usuario; no sustituye la fecha de registro. */
  movementDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD')
    .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), 'Fecha inválida')
    .refine(
      (value) => value <= new Date().toISOString().slice(0, 10),
      'La fecha del movimiento no puede ser futura'
    )
    .optional(),
  supplierId: z.string().trim().max(200).optional(),
  supplierNameSnapshot: z.string().trim().max(200).optional(),
  supplierTaxIdSnapshot: z.string().trim().max(60).optional(),
  paymentCondition: z.enum(['contado', 'credito']).optional(),
  paymentMethod: paymentMethodSchema.optional(),
  bankCode: z.string().trim().max(10).optional(),
  paymentReference: z.string().trim().max(200).optional(),
  creditDays: z.number().int().min(0).max(365).optional(),
  dueDate: dateLike.optional(),
  date: dateLike,
  performedBy: z.string().trim().min(1).max(200),
  notes: z.string().max(1000).optional(),
  paymentAccountCode: transactionAccountCode.optional(),
});

const finishedGoodStatusSchema = z.enum(['borrador', 'activo', 'inactivo']);

export const finishedGoodCreateSchema = z.object({
  code: z.string().trim().min(1).max(60),
  flavor: z.string().trim().min(1).max(120),
  presentation: presentationSchema,
  presentationLabel: z.string().trim().min(1).max(120),
  weightGrams: z.coerce.number().finite().positive(),
  stockUnits: money.default(0),
  reservedUnits: money.default(0),
  availableUnits: money.default(0),
  baseCost: money,
  suggestedWholesalePrice: money,
  suggestedRetailPrice: money,
  suggestedSpecialPrice: money,
  minStock: money,
  status: finishedGoodStatusSchema.default('borrador'),
  notes: z.string().max(2000).optional(),
});

export const finishedGoodUpdateSchema = z
  .object({
    code: z.string().trim().min(1).max(60),
    flavor: z.string().trim().min(1).max(120),
    presentation: presentationSchema,
    presentationLabel: z.string().trim().min(1).max(120),
    weightGrams: z.coerce.number().finite().positive(),
    stockUnits: money,
    reservedUnits: money,
    availableUnits: money,
    baseCost: money,
    suggestedWholesalePrice: money,
    suggestedRetailPrice: money,
    suggestedSpecialPrice: money,
    minStock: money,
    status: finishedGoodStatusSchema,
    notes: z.string().max(2000).optional(),
  })
  .partial();

const bomItemSchema = z.object({
  materialId: z.string().trim().min(1).max(200),
  materialName: z.string().trim().min(1).max(200),
  quantity: positive,
  unit: unitSchema,
  estimatedCost: money,
});

export const recipeSchema = z.object({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  flavor: z.string().trim().min(1).max(120),
  presentation: presentationSchema,
  batchSizeUnits: integer.positive(),
  items: z.array(bomItemSchema).min(1),
  directLaborMinutes: money,
  estimatedUtilityCost: money,
  instructions: z.string().max(4000).optional(),
  presentationLabel: z.string().trim().min(1).max(120).optional(),
  weightGrams: z.coerce.number().finite().positive().max(1_000_000).optional(),
});

export const productionOrderSchema = z.object({
  recipeId: z.string().trim().min(1).max(200),
  batchCount: integer.positive().max(10_000),
  salesOrderId: z.string().trim().min(1).max(200).optional(),
  lotNumber: z.string().trim().max(80).optional(),
  operatorNotes: z.string().max(2000).optional(),
});

export const manualProductionFormulaSchema = z.object({
  recipeId: z.string().trim().min(1).max(200),
  batchCount: integer.positive().max(10_000),
});

export const manualProductionOrderSchema = z.object({
  formulas: z.array(manualProductionFormulaSchema).min(1).max(50),
  lotNumber: z.string().trim().max(80).optional(),
  commitmentReference: z.string().trim().max(200).optional(),
  operatorNotes: z.string().max(2000).optional(),
  processImmediately: z.boolean().optional(),
});

export const manualProductionOrderUpdateSchema = manualProductionOrderSchema;

const timeOfDay = z.union([
  z.literal(''),
  z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
]);

export const manualProductionSheetPresentationUnitsSchema = z.object({
  presentationId: z.string().trim().min(1).max(80),
  units: money,
});

export const manualProductionSheetPresentationSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120).optional(),
  presentation: presentationSchema,
  presentationKg: positive,
  units: money.optional(),
  unitRate: money.optional(),
  packagingUnitCost: money.optional(),
});

const sheetIngredientMaterialIdSchema = z.string().trim().min(1).max(200);
const sheetIngredientMaterialIdsSchema = z
  .object({
    starchKg: sheetIngredientMaterialIdSchema.optional(),
    chemicalG: sheetIngredientMaterialIdSchema.optional(),
    acidG: sheetIngredientMaterialIdSchema.optional(),
  })
  .optional();

export const manualProductionSheetRowSchema = z.object({
  number: z.coerce.number().int().min(1).max(6),
  basketsBase: money,
  guavaKg: money,
  sugarKg: money,
  starchKg: money,
  chemicalG: money,
  acidG: money,
  waterGasOil: money,
  finishedAt: timeOfDay,
  obtainedUnits: money,
  totalKg: money,
  reprocess: z.boolean(),
  // Manual unit distribution when the sheet handles several presentations.
  presentationUnits: z
    .array(manualProductionSheetPresentationUnitsSchema)
    .max(20)
    .optional(),
});

export const manualProductionSheetOrderSchema = z.object({
  lotNumber: z.string().trim().min(1).max(80),
  productionDate: dateLike,
  ingredientMaterialIds: sheetIngredientMaterialIdsSchema,
  marmitas: z.array(manualProductionSheetRowSchema).length(6),
  packaging: z.object({
    presentationKg: positive,
    cunetes: money,
    cajas: money,
    // Optional for backward compatibility: older clients omit it and the
    // server falls back to the BOM default.
    rendimiento: z.coerce.number().finite().gt(0).max(100).optional(),
    // Optional multi-presentation extension. Legacy clients omit it.
    presentations: z
      .array(manualProductionSheetPresentationSchema)
      .min(1)
      .max(20)
      .optional(),
  }),
  commitmentReference: z.string().trim().max(200).optional(),
  operatorNotes: z.string().max(2000).optional(),
  processImmediately: z.boolean().optional(),
});

export const manualProductionSheetOrderUpdateSchema =
  manualProductionSheetOrderSchema.partial({ processImmediately: true });

export const supplierSchema = z.object({
  code: z.string().trim().max(60).optional(),
  businessName: z.string().trim().min(1).max(200),
  taxId: z.string().trim().min(1).max(60),
  primaryContact: z.string().trim().min(1).max(200),
  primaryPhone: z.string().trim().min(1).max(60),
  secondaryPhone: z.string().trim().max(60).optional(),
  email: z.string().trim().max(200).optional(),
  fiscalAddress: z.string().trim().min(1).max(500),
  physicalAddress: z.string().trim().max(500).optional(),
  // Validated against the editable `supplier_types` catalog in the business layer.
  supplierType: z.string().trim().min(1).max(60),
  paymentTerms: z.string().trim().min(1).max(200),
  status: z.enum(['activo', 'inactivo']),
  notes: z.string().max(2000).optional(),
});

export const supplierUpdateSchema = supplierSchema.partial();

const catalogCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9_-]+$/, 'El código solo admite letras minúsculas, números, guiones y guiones bajos');

const catalogValueSchema = z.object({
  code: catalogCodeSchema,
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  color: z.string().trim().max(40).optional(),
  active: z.boolean().optional(),
});

export const supplierTypeSchema = catalogValueSchema;
export const supplierTypeUpdateSchema = catalogValueSchema.partial();
export const materialCategorySchemaInput = catalogValueSchema;
export const materialCategoryUpdateSchema = catalogValueSchema.partial();

const presentationTypeValueSchema = z.object({
  code: catalogCodeSchema,
  label: z.string().trim().min(1).max(120),
  weightGrams: z.coerce.number().finite().positive().max(1_000_000),
  packagingMaterialId: z.string().trim().min(1).max(200).optional(),
  active: z.boolean().optional(),
});
export const presentationTypeSchemaInput = presentationTypeValueSchema;
export const presentationTypeUpdateSchema = presentationTypeValueSchema.partial();

export const supplierPriceSchema = z.object({
  // The supplier is taken from the `/api/suppliers/:id/prices` route; the body
  // field is accepted only for backwards compatibility.
  supplierId: z.string().trim().min(1).max(200).optional(),
  materialId: z.string().trim().max(200).optional(),
  productName: z.string().trim().min(1).max(200),
  unit: unitSchema,
  priceUsd: positive,
  validFrom: dateLike,
  notes: z.string().max(2000).optional(),
});

export const customerSchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  taxId: z.string().trim().min(1).max(60),
  nit: z.string().trim().max(60).optional(),
  contactPerson: z.string().trim().max(200),
  phone: z.string().trim().max(60),
  email: z.string().trim().max(200),
  address: z.string().trim().max(500),
  clientType: z.enum([
    'panaderia',
    'fabricante_bocadillos',
    'pasteleria',
    'distribuidor',
    'otro',
  ]),
  creditLimit: money,
  paymentTerms: z.string().trim().min(1).max(200),
});

const salesOrderItemSchema = z.object({
  finishedGoodId: z.string().trim().min(1).max(200),
  flavor: z.string().trim().min(1).max(120),
  presentation: presentationSchema,
  presentationLabel: z.string().trim().min(1).max(120),
  quantity: positive,
  unitPrice: money,
  subtotal: money,
  unitPriceBs: money.optional(),
  subtotalBs: money.optional(),
  priceTier: priceTierSchema.optional(),
  profitMarginPercent: z.coerce.number().finite().optional(),
  baseCost: money.optional(),
  taxCategory: salesTaxCategorySchema.optional(),
  taxRatePercent: z.coerce.number().finite().min(0).max(100).optional(),
}).superRefine((item, ctx) => {
  if (
    (item.taxCategory ?? 'gravado') === 'gravado' &&
    item.taxRatePercent !== undefined &&
    item.taxRatePercent <= 0
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['taxRatePercent'],
      message: 'La alícuota debe ser mayor que cero para productos gravados.',
    });
  }
});

export const salesOrderSchema = z.object({
  customerId: z.string().trim().min(1).max(200),
  customerName: z.string().trim().min(1).max(200),
  customerTaxId: z.string().trim().min(1).max(60),
  customerNit: z.string().trim().max(60).optional(),
  saleCondition: z.enum(['contado', 'credito']).optional(),
  creditDays: z.coerce.number().int().min(0).max(365).optional(),
  paymentMethod: z.enum([
    'transferencia_bancaria',
    'pago_movil',
    'efectivo_usd',
    'efectivo_bs',
    'zelle',
    'tarjeta',
    'credito',
  ]).optional(),
  orderDate: dateLike,
  deliveryDate: dateLike,
  status: salesOrderStatusSchema,
  exchangeRateUsed: positive.optional(),
  items: z.array(salesOrderItemSchema).min(1),
  subtotal: money,
  taxAmount: money,
  total: money,
  subtotalBs: money.optional(),
  taxAmountBs: money.optional(),
  totalBs: money.optional(),
  notes: z.string().max(2000).optional(),
}).superRefine((order, ctx) => {
  if (
    order.saleCondition === 'credito' &&
    order.paymentMethod &&
    order.paymentMethod !== 'credito'
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['paymentMethod'],
      message: 'Una venta a crédito debe indicar forma de pago crédito.',
    });
  }
  if (
    order.saleCondition === 'contado' &&
    order.paymentMethod === 'credito'
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['paymentMethod'],
      message: 'Una venta de contado no puede indicar pago a crédito.',
    });
  }
});

const BANK_PAYMENT_METHODS = [
  'transferencia_bancaria',
  'pago_movil',
  'tarjeta',
  'zelle',
] as const;

export const salesCollectionSchema = z
  .object({
    bankCode: z.string().trim().min(1).max(10),
    paymentMethod: paymentMethodSchema,
    accountCode: transactionAccountCode.optional(),
    reference: z.string().trim().min(1).max(200),
    amountUsd: positive.optional(),
    exchangeRateUsed: positive.optional(),
  })
  .superRefine((data, ctx) => {
    if (
      !BANK_PAYMENT_METHODS.includes(
        data.paymentMethod as (typeof BANK_PAYMENT_METHODS)[number]
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['paymentMethod'],
        message: 'El cobro debe registrarse con un método de pago bancario',
      });
      return;
    }
    if (!findBank(data.bankCode)) {
      ctx.addIssue({
        code: 'custom',
        path: ['bankCode'],
        message: 'El código de banco no existe en el catálogo SUDEBAN',
      });
    }
  });

export const salesOrderStatusUpdateSchema = z.object({
  status: salesOrderStatusSchema,
});

export const deliveryNoteSchema = z.object({
  transporter: z.string().trim().max(200).optional(),
  receivedByName: z.string().trim().max(200).optional(),
  receivedById: z.string().trim().max(60).optional(),
  observations: z.string().max(2000).optional(),
});

const payrollPaymentSchema = z.object({
  employeeId: z.string().trim().min(1).max(200),
  employeeName: z.string().trim().min(1).max(200),
  roleTitle: z.string().trim().max(200),
  baseAmount: money,
  productionBonus: money,
  deductions: money,
  netPaid: money,
});

export const payrollWeekSchema = z.object({
  weekNumber: integer.min(1).max(53),
  year: integer.min(2000).max(2100),
  startDate: dateLike,
  endDate: dateLike,
  isActiveProduction: z.boolean(),
  inactivityReason: inactivityReasonSchema.optional(),
  payments: z.array(payrollPaymentSchema),
  totalPayrollPaid: money,
  fixedAbsorptionCost: money,
  bonusByRole: z.record(z.string().trim().min(1).max(200), money).optional(),
  notes: z.string().max(2000).optional(),
});

export const employeeSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  nationalId: z.string().trim().min(1).max(60),
  roleTitle: z.string().trim().min(1).max(200),
  weeklyBaseSalary: money,
  hourlyRate: money,
  status: employeeStatusSchema,
});

/** Alta, baja y vacaciones: los tres estados soportados por el personal de planta. */
export const employeeStatusUpdateSchema = z.object({
  status: employeeStatusSchema,
});

export const costingSimulationSchema = z.object({
  directMaterial: money,
  directPackaging: money,
  directLabor: money,
  utilityCost: money,
  inactiveWeeksCount: z.coerce.number().finite().min(0).default(0),
  targetMarginWholesale: z.coerce.number().finite().min(0).max(99).optional(),
  targetMarginRetail: z.coerce.number().finite().min(0).max(99).optional(),
});

export const expenseSchema = z
  .object({
    date: dateLike,
    concept: z.string().trim().min(1).max(300),
    category: z.string().trim().min(1).max(120),
    categoryLabel: z.string().trim().min(1).max(200),
    // Either amount may be sent; the server derives the other one. New clients
    // capture bolívares as the primary amount.
    amountUsd: positive.optional(),
    exchangeRateUsed: positive.optional(),
    amountBs: money.optional(),
    supplierOrBeneficiary: z.string().trim().min(1).max(300),
    supplierId: z.string().trim().max(200).optional(),
    taxId: z.string().trim().max(60).optional(),
    documentType: documentTypeSchema,
    documentNumber: z.string().trim().max(120).optional(),
    paymentMethod: paymentMethodSchema,
    paymentReference: z.string().trim().max(120).optional(),
    issuingBankCode: z.string().trim().max(10).optional(),
    issuingBankName: z.string().trim().max(200).optional(),
    paymentAccountCode: transactionAccountCode.optional(),
    notes: z.string().max(2000).optional(),
    registeredBy: z.string().trim().min(1).max(200),
    taxCategory: taxCategorySchema,
    taxRatePercent: z.coerce.number().finite().min(0).max(100).optional(),
    taxAmountUsd: money.optional(),
    taxAmountBs: money.optional(),
    accountingAccountCode: z.string().trim().max(60).optional(),
    accountingAccountName: z.string().trim().max(200).optional(),
    fiscalBookEligible: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const hasUsd = typeof data.amountUsd === 'number' && data.amountUsd > 0;
    const hasBs = typeof data.amountBs === 'number' && data.amountBs > 0;
    if (!hasUsd && !hasBs) {
      ctx.addIssue({
        code: 'custom',
        path: ['amountBs'],
        message: 'Registre el monto del egreso en bolívares',
      });
    }
    if (!BANK_PAYMENT_METHODS.includes(data.paymentMethod as (typeof BANK_PAYMENT_METHODS)[number])) {
      return;
    }
    if (!data.issuingBankCode) {
      ctx.addIssue({
        code: 'custom',
        path: ['issuingBankCode'],
        message: 'El banco emisor es obligatorio para pagos bancarios',
      });
      return;
    }
    if (!findBank(data.issuingBankCode)) {
      ctx.addIssue({
        code: 'custom',
        path: ['issuingBankCode'],
        message: 'El código de banco no existe en el catálogo SUDEBAN',
      });
    }
  });

export const payableStatusSchema = z.enum([
  'pendiente',
  'parcial',
  'pagada',
  'anulada',
]);

export const payableSchema = z.object({
  supplierId: z.string().trim().max(200).optional(),
  supplierName: z.string().trim().min(1).max(300),
  taxId: z.string().trim().max(60).optional(),
  invoiceNumber: z.string().trim().min(1).max(120),
  controlNumber: z.string().trim().max(120).optional(),
  issueDate: dateLike,
  dueDate: dateLike,
  amountUsd: positive,
  exchangeRateUsed: positive.optional(),
  amountBs: money.optional(),
  taxAmountUsd: money.optional(),
  category: z.string().trim().min(1).max(120),
  status: payableStatusSchema.optional(),
  notes: z.string().max(2000).optional(),
});

export const payableUpdateSchema = z.object({
  status: payableStatusSchema.optional(),
  dueDate: dateLike.optional(),
  category: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(2000).optional(),
  taxAmountUsd: money.optional(),
});

export const payablePaymentSchema = z
  .object({
    bankCode: z.string().trim().min(1).max(10),
    bankName: z.string().trim().min(1).max(200).optional(),
    paymentMethod: paymentMethodSchema,
    accountCode: transactionAccountCode.optional(),
    reference: z.string().trim().min(1).max(200),
    amountUsd: positive.optional(),
    exchangeRateUsed: positive.optional(),
  })
  .superRefine((data, ctx) => {
    if (
      !BANK_PAYMENT_METHODS.includes(
        data.paymentMethod as (typeof BANK_PAYMENT_METHODS)[number]
      )
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['paymentMethod'],
        message: 'El pago debe registrarse con un método de pago bancario',
      });
      return;
    }
    if (!findBank(data.bankCode)) {
      ctx.addIssue({
        code: 'custom',
        path: ['bankCode'],
        message: 'El código de banco no existe en el catálogo SUDEBAN',
      });
    }
  });

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  icon: z.string().trim().max(120),
  color: z.string().trim().max(120),
  monthlyBudgetUsd: money,
  accountingAccountCode: z.string().trim().max(60).optional(),
  accountingAccountName: z.string().trim().max(200).optional(),
  defaultTaxCategory: taxCategorySchema.optional(),
  description: z.string().max(2000).optional(),
});

export const expenseCategoryUpdateSchema = expenseCategorySchema.partial();

export const fiscalSettingsSchema = z
  .object({
    enabled: z.boolean(),
    companyName: z.string().trim().min(1).max(300),
    companyTaxId: z.string().trim().min(1).max(60),
    fiscalAddress: z.string().trim().max(500),
    companyPhone: z.string().trim().max(40),
    companyEmail: z.union([z.literal(''), z.string().trim().email().max(200)]),
    economicActivity: z.string().trim().max(300),
    taxRegime: z.enum(['ordinario', 'especial']),
    taxRatePercent: z.coerce.number().finite().min(0).max(100),
    invoicePrefix: z.string().trim().max(40),
    invoiceSerie: z.string().trim().max(20),
    nextInvoiceNumber: integer.min(1),
    controlPrefix: z.string().trim().max(40),
    nextControlNumber: integer.min(1),
    authorizationCode: z.string().trim().max(120),
    authorizationValidUntil: z.string().trim().max(30),
    branchName: z.string().trim().max(200),
    branchAddress: z.string().trim().max(500),
    vatWithholdingAgent: z.boolean(),
    vatWithholdingPercent: z.coerce.number().finite().min(0).max(100),
    islrWithholdingAgent: z.boolean(),
    islrWithholdingPercent: z.coerce.number().finite().min(0).max(100),
    specialTaxpayer: z.boolean(),
    booksFormat: z.enum(['xlsx', 'csv', 'pdf', 'txt']),
    historicalOrdersTreatment: z.enum([
      'no_emitir',
      'emitir_actual',
      'revisar',
    ]),
    printNotes: z.string().max(2000),
    digitalInvoicingEnabled: z.boolean(),
    digitalInvoicingProvider: z.string().trim().max(200),
    digitalInvoicingProviderTaxId: z.string().trim().max(60),
    digitalInvoicingApiUrl: z.union([
      z.literal(''),
      z.string().trim().url().max(500),
    ]),
    digitalInvoicingEnvironment: z.enum(['pruebas', 'produccion']),
    digitalInvoicingCertificateLabel: z.string().trim().max(200),
    digitalInvoicingCertificateExpiry: z.string().trim().max(30),
    digitalInvoicingStartDate: z.union([
      z.literal(''),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use la fecha YYYY-MM-DD'),
    ]),
    digitalInvoicingNotes: z.string().max(2000),
  })
  .partial()
  .superRefine((data, ctx) => {
    if (!data.digitalInvoicingEnabled) return;
    const requiredFields = [
      'digitalInvoicingProvider',
      'digitalInvoicingProviderTaxId',
      'digitalInvoicingApiUrl',
      'digitalInvoicingEnvironment',
      'digitalInvoicingStartDate',
    ] as const;
    for (const key of requiredFields) {
      const value = (data as Record<string, unknown>)[key];
      if (value === undefined || value === null || String(value).trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Complete este campo para marcar la facturación digital como preparada',
        });
      }
    }
  });

const fiscalObligationKeySchema = z.enum([
  'tax_regime',
  'special_taxpayer',
  'vat_withholding',
  'islr_withholding',
  'igtf',
  'digital_invoicing',
  'snat_2026_00093',
  'fiscal_documents',
  'fiscal_books',
  'legal_reconversion',
  'opening_cutoff',
  'accrual_criteria',
  'spe_vouchers',
  'record_retention',
]);

export const fiscalObligationParamsSchema = z.object({
  key: fiscalObligationKeySchema,
});

export const fiscalObligationUpdateSchema = z.object({
  applicability: z.enum(['pendiente', 'aplica', 'no_aplica']),
  normativeReference: z.string().trim().max(500),
  reviewedAt: z.union([
    z.literal(''),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use la fecha YYYY-MM-DD')
      .refine((value) => {
        const date = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
      }, 'Indique una fecha válida'),
  ]),
  notes: z.string().trim().max(4000),
}).superRefine((data, ctx) => {
  if (data.applicability !== 'pendiente' && !data.reviewedAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['reviewedAt'],
      message: 'Registre la fecha de la decisión del contador',
    });
  }
  if (
    data.applicability !== 'pendiente' &&
    !data.normativeReference &&
    !data.notes
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['normativeReference'],
      message: 'Registre una referencia o las observaciones que respaldan la decisión',
    });
  }
});

const fiscalReferenceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use la fecha YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'Indique una fecha válida');

const optionalFiscalReferenceDateSchema = z.union([
  z.literal(''),
  fiscalReferenceDateSchema,
]);

export const fiscalReferenceIdParamsSchema = z.object({
  id: z.string().trim().min(1).max(120),
});

export const fiscalReferenceQuerySchema = z.object({
  kind: z.enum(['iva', 'ut', 'islr']).optional(),
  date: fiscalReferenceDateSchema.optional(),
  includeAnnulled: z.enum(['true', 'false']).optional(),
});

export const fiscalReferenceSchema = z
  .object({
    kind: z.enum(['iva', 'ut', 'islr']),
    value: z.coerce.number().finite().positive(),
    valueUnit: z.enum(['percent', 'bs']),
    conceptCode: z.string().trim().max(60),
    conceptLabel: z.string().trim().max(200),
    taxpayerType: z.enum(['', 'natural', 'juridica']),
    sustraendoUt: z.coerce.number().finite().min(0).nullable(),
    effectiveFrom: fiscalReferenceDateSchema,
    effectiveTo: optionalFiscalReferenceDateSchema,
    instrumentType: z.string().trim().max(80),
    instrumentNumber: z.string().trim().max(120),
    officialGazette: z.string().trim().max(200),
    publicationDate: optionalFiscalReferenceDateSchema,
    legalBasis: z.string().trim().max(500),
    notes: z.string().trim().max(4000),
    status: z.enum(['referencia', 'confirmado', 'historico', 'anulado']),
    confirmedByAccountant: z.boolean(),
    supportDocument: z.string().trim().max(500),
  })
  .superRefine((data, ctx) => {
    if (data.kind === 'iva' && data.valueUnit !== 'percent') {
      ctx.addIssue({
        code: 'custom',
        path: ['valueUnit'],
        message: 'El IVA se expresa como porcentaje',
      });
    }
    if (data.kind === 'ut' && data.valueUnit !== 'bs') {
      ctx.addIssue({
        code: 'custom',
        path: ['valueUnit'],
        message: 'La UT se expresa en bolívares',
      });
    }
    if (data.kind === 'islr' && data.valueUnit !== 'percent') {
      ctx.addIssue({
        code: 'custom',
        path: ['valueUnit'],
        message: 'La alícuota ISLR se expresa como porcentaje',
      });
    }
    if (data.kind === 'islr' && !data.conceptCode.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['conceptCode'],
        message: 'Indique el rubro o concepto ISLR',
      });
    }
    if (data.valueUnit === 'percent' && data.value > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'La alícuota debe estar entre 0 y 100',
      });
    }
    if (data.effectiveTo && data.effectiveTo < data.effectiveFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveTo'],
        message: 'La fecha de fin no puede ser anterior al inicio de vigencia',
      });
    }
  });

export const fiscalReferenceAnnulmentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const accountingBookSettingsSchema = z.object({
  approvedFormats: z.string().trim().min(1).max(100),
  auxiliaryFormat: z.string().trim().min(1).max(50),
  pagination: z.string().trim().max(500),
  signatureText: z.string().trim().max(500),
  signatureRole: z.string().trim().max(200),
  accountantSigner: z.string().trim().max(200).optional(),
  partnerSigners: z.string().trim().max(500).optional(),
  bookPageNumbering: z.string().trim().max(500).optional(),
  ratificationInstrument: z.string().trim().max(500).optional(),
  exchangeRatePolicy: z.literal('documento_con_fallback'),
  notes: z.string().trim().max(4000),
  approvedAt: optionalFiscalReferenceDateSchema,
});

export const fiscalInvoiceAnnulmentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const fiscalAdjustmentLineSchema = z.object({
  description: z.string().trim().min(1).max(300),
  subtotal: positive,
  taxCategory: salesTaxCategorySchema,
  taxRatePercent: z.coerce.number().finite().min(0).max(100),
}).superRefine((item, ctx) => {
  if (item.taxCategory === 'gravado' && item.taxRatePercent <= 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['taxRatePercent'],
      message: 'La alícuota debe ser mayor que cero para conceptos gravados.',
    });
  }
});

export const fiscalAdjustmentNoteSchema = z.object({
  type: z.enum(['nota_credito', 'nota_debito']),
  fiscalInvoiceId: z.string().trim().min(1).max(200),
  reason: z.enum([
    'devolucion',
    'descuento',
    'bonificacion',
    'error_precio',
    'anulacion_parcial',
    'otro',
  ]),
  reasonDetails: z.string().trim().max(500).optional(),
  items: z.array(fiscalAdjustmentLineSchema).min(1).max(100),
}).superRefine((note, ctx) => {
  if (note.reason === 'otro' && !note.reasonDetails) {
    ctx.addIssue({
      code: 'custom',
      path: ['reasonDetails'],
      message: 'Describa el motivo de la nota.',
    });
  }
});

export const fiscalPeriodParamsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(9999),
  month: z.coerce.number().int().min(1).max(12),
});

/** Parámetros de consulta para generar un libro contable. */
export const accountingBookQuerySchema = z.object({
  type: z.enum([
    'diario',
    'mayor',
    'balance_comprobacion',
    'balance_general',
    'inventario',
    'estado_resultados',
    'compras',
    'ventas',
    'retenciones',
    'caja_banco',
    'auxiliar_cxc',
    'auxiliar_cxp',
  ]),
  year: z.coerce.number().int().min(2000).max(9999),
  month: z.coerce.number().int().min(1).max(12),
});

export const expenseFiscalEligibilitySchema = z.object({
  fiscalBookEligible: z.boolean(),
});

export const exchangeRateUpdateSchema = z.object({
  usdRate: positive,
  usdtRate: positive,
  source: z.string().trim().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export const auditLogSchema = z.object({
  module: auditModuleSchema,
  actionType: auditActionSchema,
  title: z.string().trim().min(1).max(300),
  description: z.string().max(4000),
  userId: z.string().trim().min(1).max(200),
  userName: z.string().trim().min(1).max(200),
  userRole: z.string().trim().min(1).max(200),
  severity: auditSeveritySchema,
  timestamp: z.string().trim().max(60).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(500),
});

export const passwordResetRequestSchema = z.object({
  identifier: z.string().trim().min(1).max(200),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(16).max(500),
  newPassword: z.string().min(8).max(200),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(500),
    newPassword: z.string().min(8).max(200),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ['newPassword'],
    message: 'La nueva contraseña debe ser diferente a la actual',
  });

export const authModuleSchema = z.enum([
  'dashboard',
  'inventory',
  'production',
  'costing',
  'sales',
  'payroll',
  'expenses',
  'suppliers',
  'supplier_types',
  'material_categories',
  'settings',
  'architecture',
  'activation',
]);

export const rolePermissionFlagsSchema = z
  .object({
    canView: z.boolean(),
    canCreate: z.boolean(),
    canEdit: z.boolean(),
    canDelete: z.boolean(),
    canExport: z.boolean(),
  })
  .partial();

export const roleCreateSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(500),
  color: z.string().trim().min(1).max(40).default('amber'),
  permissions: z
    .partialRecord(authModuleSchema, rolePermissionFlagsSchema)
    .optional(),
});

export const roleUpdateSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    description: z.string().trim().min(3).max(500),
    color: z.string().trim().min(1).max(40),
  })
  .partial();

export const rolePermissionUpdateSchema = z.object({
  moduleId: authModuleSchema,
  permissions: rolePermissionFlagsSchema,
});

export const authUserStatusSchema = z.enum(['activo', 'inactivo']);

export const userCreateSchema = z.object({
  fullName: z.string().trim().min(3).max(200),
  username: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Solo se permiten letras, números, punto, guion y guion bajo'),
  email: z.string().trim().email().max(200),
  nationalId: z.string().trim().max(60).optional(),
  roleId: z.string().trim().min(1).max(120),
  department: z.string().trim().max(200).optional(),
  status: authUserStatusSchema.optional(),
  avatarBg: z.string().trim().max(60).optional(),
  password: z.string().min(8).max(200).optional(),
});

export const userUpdateSchema = userCreateSchema.partial();

export const notificationRecipientCreateSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(200).optional(),
  active: z.boolean().optional(),
});

export const notificationRecipientUpdateSchema =
  notificationRecipientCreateSchema.partial();

export const idParamsSchema = z.object({
  id: z.string().trim().min(1).max(200),
});

// --- CONTABILIDAD (FASE 1) ---
const accountCodeLike = z.string().trim().min(1).max(30).regex(/^\d+(\.\d+)*$/);

export const accountTypeSchema = z.enum([
  'activo',
  'pasivo',
  'patrimonio',
  'ingreso',
  'gasto',
  'costo',
]);

export const accountKindSchema = z.enum(['banco', 'caja', 'otra']);
export const accountCurrencySchema = z.enum(['USD', 'Bs', 'AMBAS']);

export const accountSchema = z.object({
  code: accountCodeLike,
  name: z.string().trim().min(1).max(200),
  type: accountTypeSchema,
  nature: z.enum(['debito', 'credito']),
  parentCode: accountCodeLike.optional(),
  description: z.string().max(1000).optional(),
  active: z.boolean().optional(),
  kind: accountKindSchema.optional(),
  bankCode: z.string().trim().max(10).optional(),
  bankName: z.string().trim().max(200).optional(),
  accountNumber: z.string().trim().max(60).optional(),
  currency: accountCurrencySchema.optional(),
  referenceBalanceUsd: money.optional(),
  referenceBalanceNote: z.string().max(500).optional(),
});

export const accountUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    active: z.boolean().optional(),
    kind: accountKindSchema.optional(),
    bankCode: z.string().trim().max(10).optional(),
    bankName: z.string().trim().max(200).optional(),
    accountNumber: z.string().trim().max(60).optional(),
    currency: accountCurrencySchema.optional(),
    referenceBalanceUsd: money.optional(),
    referenceBalanceNote: z.string().max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar',
  });

// --- APERTURA PROVISIONAL #13 (USD + Bs con tasa por línea) ---
const openingDateLike = z
  .string()
  .trim()
  .refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: 'Use el formato YYYY-MM-DD o deje el campo vacío',
  });

const openingAmountSchema = z.object({
  amountUsd: money.optional(),
  amountBs: money.optional(),
  exchangeRateUsed: positive.optional(),
  rateSource: z.enum(['currentUsd (referencia)', 'Tasa capturada en apertura']).optional(),
});

export const accountingOpeningUpdateSchema = z.object({
  legalEntity: z.object({
    currentName: z.string().trim().max(200),
    convertedName: z.string().trim().max(200),
    legalForm: z.string().trim().max(120),
    reconversionInstrument: z.string().trim().max(300),
    reconversionDate: openingDateLike,
    notes: z.string().max(2000),
  }),
  cutoffDate: openingDateLike,
  generalBalances: z
    .array(
      openingAmountSchema.extend({
        id: z.string().trim().max(80).optional(),
        accountCode: accountCodeLike,
        memo: z.string().trim().max(300).optional(),
      })
    )
    .max(200),
  auxiliaryBalances: z
    .array(
      openingAmountSchema.extend({
        id: z.string().trim().max(80).optional(),
        kind: z.enum(['banco', 'clientes', 'proveedores']),
        name: z.string().trim().min(1).max(200),
        accountCode: accountCodeLike,
        memo: z.string().trim().max(300).optional(),
      })
    )
    .max(200),
  shareholders: z
    .array(
      openingAmountSchema.extend({
        id: z.string().trim().max(80).optional(),
        name: z.string().trim().min(1).max(200),
        taxId: z.string().trim().max(40).optional(),
        contributionType: z.string().trim().max(120).optional(),
        accountCode: accountCodeLike.optional(),
      })
    )
    .max(200),
  notes: z.string().max(2000),
});

export const accountingOpeningAdjustmentSchema = openingAmountSchema.extend({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD'),
  accountCode: accountCodeLike,
  description: z.string().trim().min(1).max(500),
  direction: z.enum(['debito', 'credito']),
});

const accountingEntrySourceSchema = z.enum([
  'manual',
  'venta',
  'cobro',
  'gasto',
  'pago_cxp',
  'nomina',
  'inventario',
  'nota_credito',
  'nota_debito',
  'retencion',
  'apertura',
]);

export const accountingEntryLineSchema = z.object({
  accountCode: accountCodeLike,
  debit: money.optional(),
  credit: money.optional(),
  memo: z.string().max(500).optional(),
});

export const accountingEntrySchema = z
  .object({
    date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD'),
    description: z.string().trim().min(1).max(500),
    sourceType: accountingEntrySourceSchema.optional(),
    sourceId: z.string().trim().max(200).optional(),
    exchangeRateUsed: positive.optional(),
    status: z.enum(['borrador', 'confirmado']).optional(),
    lines: z.array(accountingEntryLineSchema).min(2).max(50),
  })
  .superRefine((data, ctx) => {
    let debit = 0;
    let credit = 0;
    data.lines.forEach((line, index) => {
      const d = line.debit ?? 0;
      const c = line.credit ?? 0;
      if ((d > 0) === (c > 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index],
          message: 'Cada línea debe ser débito o crédito, no ambos ni ninguno',
        });
      }
      debit += d;
      credit += c;
    });
    if (Math.abs(debit - credit) > 0.01) {
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'El asiento debe estar balanceado (débitos = créditos)',
      });
    }
  });

export const accountingEntryAnnulmentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const accountingPeriodKeySchema = z.object({
  key: z.string().trim().regex(/^\d{4}-\d{2}$/, 'Formato YYYY-MM'),
});

const activationCurrencySchema = z.enum(['USD', 'Bs']);
const activationStatusSchema = z.enum([
  'activo',
  'pendiente',
  'vencido',
  'suspendido',
]);

export const activationCreateSchema = z.object({
  clientName: z.string().trim().min(2).max(200),
  clientDocument: z.string().trim().max(60).optional(),
  concept: z.string().trim().min(2).max(300),
  amount: z.number().positive().max(1_000_000_000),
  currency: activationCurrencySchema.optional(),
  paymentMethod: z.string().trim().min(2).max(80),
  reference: z.string().trim().max(120).optional(),
  paymentDate: z.string().trim().min(4).max(40),
  periodStart: z.string().trim().max(40).optional(),
  periodEnd: z.string().trim().max(40).optional(),
  status: activationStatusSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const activationUpdateSchema = activationCreateSchema.partial();

/** Signed license token pasted by the master user. */
export const licenseApplySchema = z.object({
  token: z.string().trim().min(20).max(4000),
});

/** Optional reason recorded when suspending the system license. */
export const licenseSuspendSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

function toApiError(error: ZodError): ApiError {
  return new ApiError(422, 'Datos de entrada inválidos', 'VALIDATION_ERROR', {
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

function runValidation(
  schema: ZodType,
  value: unknown,
  res: Response,
  next: NextFunction,
  onSuccess: (parsed: unknown) => void
): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    next(toApiError(result.error));
    return;
  }
  onSuccess(result.data);
  next();
}

/** Middleware factory that validates and replaces `req.body`. */
export function validateBody(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    runValidation(schema, req.body ?? {}, res, next, (parsed) => {
      req.body = parsed;
    });
  };
}

/** Middleware factory that validates and replaces `req.params`. */
export function validateParams(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    runValidation(schema, req.params, res, next, (parsed) => {
      req.params = parsed as Request['params'];
    });
  };
}

/**
 * Parse a payload outside Express (used by handlers that need a value before
 * invoking business logic). Throws a 422 `ApiError` on failure.
 */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw toApiError(result.error);
  }
  return result.data;
}

export { badRequest };
