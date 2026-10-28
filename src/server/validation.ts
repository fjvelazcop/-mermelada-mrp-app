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
  'grande_1000g',
  'galon_5kg',
  'balde_15kg',
  'pote_20kg',
  'caja_20kg',
  'otra',
]);
const materialCategorySchema = z.enum(['fruta', 'aditivo', 'empaque', 'quimico']);
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
]);
const auditSeveritySchema = z.enum(['info', 'success', 'warning', 'critical']);
const auditActionSchema = z.enum([
  'entrada_materia_prima',
  'salida_produccion',
  'ajuste_merma',
  'reabastecimiento_alerta',
  'orden_produccion_creada',
  'orden_produccion_procesada',
  'orden_manual_creada',
  'orden_manual_actualizada',
  'orden_manual_eliminada',
  'orden_manual_procesada',
  'orden_manual_anulada',
  'receta_bom_creada',
  'alerta_stock_critico',
  'gasto_registrado',
  'gasto_eliminado',
  'proveedor_creado',
  'proveedor_actualizado',
  'proveedor_eliminado',
  'precio_proveedor_registrado',
  'cobro_registrado',
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

const money = z.coerce.number().finite().min(0);
const positive = z.coerce.number().finite().positive();
const integer = z.coerce.number().int();
const dateLike = z.string().trim().min(1).max(40);

export const rawMaterialSchema = z.object({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  category: materialCategorySchema,
  currentStock: money,
  minStock: money,
  unit: unitSchema,
  costPerUnit: money,
  supplier: z.string().trim().max(200).optional(),
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
  date: dateLike,
  performedBy: z.string().trim().min(1).max(200),
  notes: z.string().max(1000).optional(),
});

export const finishedGoodUpdateSchema = z
  .object({
    code: z.string().trim().min(1).max(60),
    flavor: z.string().trim().min(1).max(120),
    presentation: presentationSchema,
    presentationLabel: z.string().trim().min(1).max(120),
    weightGrams: money,
    stockUnits: money,
    reservedUnits: money,
    availableUnits: money,
    baseCost: money,
    suggestedWholesalePrice: money,
    suggestedRetailPrice: money,
    suggestedSpecialPrice: money,
    minStock: money,
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
  supplierType: z.enum(['fruta', 'aditivo', 'empaque', 'quimico', 'servicios', 'otro']),
  paymentTerms: z.string().trim().min(1).max(200),
  status: z.enum(['activo', 'inactivo']),
  notes: z.string().max(2000).optional(),
});

export const supplierUpdateSchema = supplierSchema.partial();

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
});

export const salesOrderSchema = z.object({
  customerId: z.string().trim().min(1).max(200),
  customerName: z.string().trim().min(1).max(200),
  customerTaxId: z.string().trim().min(1).max(60),
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
    amountUsd: positive,
    exchangeRateUsed: positive.optional(),
    amountBs: money.optional(),
    supplierOrBeneficiary: z.string().trim().min(1).max(300),
    taxId: z.string().trim().max(60).optional(),
    documentType: documentTypeSchema,
    documentNumber: z.string().trim().max(120).optional(),
    paymentMethod: paymentMethodSchema,
    paymentReference: z.string().trim().max(120).optional(),
    issuingBankCode: z.string().trim().max(10).optional(),
    issuingBankName: z.string().trim().max(200).optional(),
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
    taxRatePercent: z.coerce.number().finite().min(0).max(100),
    invoicePrefix: z.string().trim().max(40),
    nextInvoiceNumber: integer.min(1),
    authorizationCode: z.string().trim().max(120),
    printNotes: z.string().max(2000),
  })
  .partial();

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
  'settings',
  'architecture',
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
