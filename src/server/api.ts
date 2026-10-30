import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import swaggerUi from 'swagger-ui-express';
import { dbInstance } from './erp-database.js';
import { getDb, getDbPath } from './database/persistence.js';
import {
  authenticate,
  authorizeRequest,
  changePasswordHandler,
  confirmResetPasswordHandler,
  createRoleHandler,
  createUserHandler,
  deleteRoleHandler,
  deleteUserHandler,
  ensureSeedUsers,
  isAuthEnabled,
  listRolesHandler,
  listUsersHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  requireAdmin,
  resetPasswordHandler,
  updateRoleHandler,
  updateRolePermissionsHandler,
  updateUserHandler,
} from './auth.js';
import { ApiError, apiNotFoundHandler, errorHandler } from './errors.js';
import {
  createRateLimiter,
  isRateLimitExempt,
  loginRateLimitKey,
  readRateLimitConfig,
  securityHeaders,
} from './security.js';
import {
  createNotificationRecipientHandler,
  deleteNotificationRecipientHandler,
  ensureSeedNotificationRecipients,
  listNotificationLogHandler,
  listNotificationRecipientsHandler,
  resendTunnelNotificationHandler,
  updateNotificationRecipientHandler,
} from './notifications.js';
import {
  getTunnelSessionsHandler,
  internalTunnelHandler,
} from './tunnel.js';
import {
  auditLogSchema,
  changePasswordSchema,
  costingSimulationSchema,
  customerSchema,
  deliveryNoteSchema,
  employeeSchema,
  exchangeRateUpdateSchema,
  expenseCategorySchema,
  expenseCategoryUpdateSchema,
  expenseSchema,
  finishedGoodUpdateSchema,
  fiscalSettingsSchema,
  idParamsSchema,
  inventoryMovementSchema,
  loginSchema,
  manualProductionOrderSchema,
  manualProductionOrderUpdateSchema,
  notificationRecipientCreateSchema,
  notificationRecipientUpdateSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  payrollWeekSchema,
  productionOrderSchema,
  rawMaterialSchema,
  rawMaterialUpdateSchema,
  recipeSchema,
  roleCreateSchema,
  rolePermissionUpdateSchema,
  roleUpdateSchema,
  salesCollectionSchema,
  salesOrderSchema,
  salesOrderStatusUpdateSchema,
  supplierPriceSchema,
  supplierSchema,
  supplierUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
  validateBody,
  validateParams,
} from './validation.js';
import { VENEZUELAN_BANKS, findBank } from '../app/core/data/venezuelan-banks.js';
import { openApiDocument } from './openapi.js';

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

function toApiError(err: unknown, status: number, code: string): ApiError {
  if (err instanceof ApiError) return err;
  const message =
    err instanceof Error ? err.message : 'Error interno del servidor';
  return new ApiError(status, message, code);
}

/** Wrap a mutating handler: business-rule failures become HTTP 400. */
function mutation(handler: Handler): RequestHandler {
  return (req, res, next) => {
    try {
      const result = handler(req, res, next);
      if (result instanceof Promise) {
        result.catch((err) => next(toApiError(err, 400, 'BAD_REQUEST')));
      }
    } catch (err) {
      next(toApiError(err, 400, 'BAD_REQUEST'));
    }
  };
}

/** Wrap a read-only handler: unexpected failures become HTTP 500. */
function query(handler: Handler): RequestHandler {
  return (req, res, next) => {
    try {
      const result = handler(req, res, next);
      if (result instanceof Promise) {
        result.catch((err) => next(toApiError(err, 500, 'INTERNAL_ERROR')));
      }
    } catch (err) {
      next(toApiError(err, 500, 'INTERNAL_ERROR'));
    }
  };
}

/** Resolve a validated `:id` path parameter as a plain string. */
function routeId(req: Request): string {
  const value = req.params['id'];
  return Array.isArray(value) ? value[0] : value;
}

interface AuditActor {
  userId: string;
  userName: string;
  userRole: string;
}

/** Resolve the acting user for audit entries (real session or demo role). */
function auditActor(req: Request): AuditActor {
  if (req.auth) {
    return {
      userId: req.auth.user.id,
      userName: req.auth.user.fullName,
      userRole: req.auth.user.roleId,
    };
  }
  return {
    userId: req.header('x-demo-user') || 'usr-admin',
    userName: req.header('x-demo-user-name') || 'Administrador (demo)',
    userRole: req.header('x-demo-role') || 'admin',
  };
}

/**
 * Build the Express application with every ERP API route.
 *
 * Kept separate from the Angular SSR entry point so the API can be started
 * (and tested) without bootstrapping the Angular renderer.
 */
export function createApiApp(): express.Express {
  const app = express();
  // Do not advertise the stack: `X-Powered-By: Express` is a fingerprinting
  // freebie for attackers.
  app.disable('x-powered-by');
  // Only the loopback reverse proxy (cloudflared/Nginx) is trusted to set
  // X-Forwarded-*, so req.ip and req.secure resolve to the real client.
  app.set('trust proxy', 'loopback');
  app.use(securityHeaders());
  app.use(express.json({ limit: '2mb' }));

  // Rate limiting. Health checks, the OpenAPI docs and the loopback tunnel
  // callback are exempt so monitoring and the tunnel supervisor never get
  // throttled. Login has its own, stricter bucket keyed by IP + username.
  const rateLimits = readRateLimitConfig();
  if (rateLimits.enabled) {
    app.use(
      '/api',
      createRateLimiter({
        windowMs: rateLimits.windowMs,
        max: rateLimits.max,
        skip: isRateLimitExempt,
      })
    );
    app.use(
      '/api/auth/login',
      createRateLimiter({
        windowMs: rateLimits.loginWindowMs,
        max: rateLimits.loginMax,
        keyGenerator: loginRateLimitKey,
        message:
          'Demasiados intentos de inicio de sesión. Espere unos minutos e intente de nuevo.',
      })
    );
  }

  // Loopback-only callback used by scripts/tunnel.mjs (PM2). It must be
  // registered before the bearer-token middleware because cloudflared has no
  // user session; it authenticates with a shared internal token instead.
  app.post('/api/internal/tunnel', internalTunnelHandler);

  // --- API INDEX (public) ---
  // Opening the API root used to return a bare "route not found" error. This
  // index tells operators where the health check, docs and login live without
  // exposing business data.
  app.get('/api', (_req, res) => {
    res.json({
      name: 'Mermelada ERP API',
      version: process.env['APP_VERSION'] || 'dev',
      status: 'ok',
      authEnabled: isAuthEnabled(),
      health: '/api/health',
      documentation: '/api/docs',
      openapi: '/api/openapi.json',
      login: '/api/auth/login',
      message:
        'Raíz de la API. Use /api/health, /api/docs o /api/openapi.json. Las rutas de negocio requieren Authorization: Bearer <token>.',
    });
  });

  // Authentication / RBAC middleware. Both are no-ops unless AUTH_ENABLED=true.
  app.use(authenticate);
  app.use(authorizeRequest);

  ensureSeedUsers();
  ensureSeedNotificationRecipients();

  // --- HEALTH CHECK ---
  app.get(
    '/api/health',
    query((req, res) => {
      const db = getDb();
      const result = db.prepare('SELECT 1 AS ok').get() as
        | { ok: number }
        | undefined;
      res.json({
        status: 'ok',
        version: process.env['APP_VERSION'] || 'dev',
        environment: process.env['NODE_ENV'] || 'development',
        uptimeSeconds: Math.round(process.uptime()),
        authEnabled: isAuthEnabled(),
        database: {
          path: getDbPath(),
          connected: result?.ok === 1,
        },
        timestamp: new Date().toISOString(),
      });
    })
  );

  // --- OPENAPI / SWAGGER DOCS (public) ---
  app.get('/api/openapi.json', (req, res) => {
    res.json(openApiDocument);
  });
  app.get(
    '/api/docs',
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'Pulpacraft ERP API',
    })
  );
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'Pulpacraft ERP API',
    })
  );

  // --- AUTHENTICATION ---
  app.post('/api/auth/login', validateBody(loginSchema), loginHandler);
  app.get('/api/auth/me', meHandler);
  app.post('/api/auth/logout', logoutHandler);
  app.post(
    '/api/auth/reset-password',
    validateBody(passwordResetRequestSchema),
    resetPasswordHandler
  );
  app.post(
    '/api/auth/reset-password/confirm',
    validateBody(passwordResetConfirmSchema),
    confirmResetPasswordHandler
  );
  app.post(
    '/api/auth/change-password',
    validateBody(changePasswordSchema),
    changePasswordHandler
  );

  // --- USERS AND ROLE PERMISSIONS (DB-BACKED RBAC) ---
  app.get('/api/auth/roles', query(listRolesHandler));
  app.post(
    '/api/auth/roles',
    requireAdmin,
    validateBody(roleCreateSchema),
    mutation(createRoleHandler)
  );
  app.put(
    '/api/auth/roles/:id/permissions',
    requireAdmin,
    validateParams(idParamsSchema),
    validateBody(rolePermissionUpdateSchema),
    mutation(updateRolePermissionsHandler)
  );
  app.put(
    '/api/auth/roles/:id',
    requireAdmin,
    validateParams(idParamsSchema),
    validateBody(roleUpdateSchema),
    mutation(updateRoleHandler)
  );
  app.delete(
    '/api/auth/roles/:id',
    requireAdmin,
    validateParams(idParamsSchema),
    mutation(deleteRoleHandler)
  );

  app.get('/api/auth/users', requireAdmin, query(listUsersHandler));
  app.post(
    '/api/auth/users',
    requireAdmin,
    validateBody(userCreateSchema),
    mutation(createUserHandler)
  );
  app.put(
    '/api/auth/users/:id',
    requireAdmin,
    validateParams(idParamsSchema),
    validateBody(userUpdateSchema),
    mutation(updateUserHandler)
  );
  app.delete(
    '/api/auth/users/:id',
    requireAdmin,
    validateParams(idParamsSchema),
    mutation(deleteUserHandler)
  );

  // --- TUNNEL URL REGISTRY AND EMAIL NOTIFICATIONS ---
  app.get(
    '/api/system/tunnel',
    requireAdmin,
    query(getTunnelSessionsHandler)
  );

  app.get(
    '/api/notifications/recipients',
    requireAdmin,
    query(listNotificationRecipientsHandler)
  );
  app.post(
    '/api/notifications/recipients',
    requireAdmin,
    validateBody(notificationRecipientCreateSchema),
    mutation(createNotificationRecipientHandler)
  );
  app.put(
    '/api/notifications/recipients/:id',
    requireAdmin,
    validateParams(idParamsSchema),
    validateBody(notificationRecipientUpdateSchema),
    mutation(updateNotificationRecipientHandler)
  );
  app.delete(
    '/api/notifications/recipients/:id',
    requireAdmin,
    validateParams(idParamsSchema),
    mutation(deleteNotificationRecipientHandler)
  );
  app.get(
    '/api/notifications/log',
    requireAdmin,
    query(listNotificationLogHandler)
  );
  app.post(
    '/api/notifications/tunnel/resend',
    requireAdmin,
    mutation(resendTunnelNotificationHandler)
  );

  // --- VENEZUELAN BANK CATALOG (SUDEBAN) ---
  app.get(
    '/api/banks',
    query((req, res) => {
      const term = String(req.query['q'] || '').trim().toLowerCase();
      if (!term) {
        res.json(VENEZUELAN_BANKS);
        return;
      }
      res.json(
        VENEZUELAN_BANKS.filter(
          (bank) =>
            bank.code.includes(term) ||
            bank.name.toLowerCase().includes(term)
        )
      );
    })
  );

  // ==========================================
  // REST API ROUTES - PULPACRAFT ERP / MRP
  // ==========================================

  // --- INVENTORY: RAW MATERIALS ---
  app.get(
    '/api/inventory/raw-materials',
    query((req, res) => {
      res.json(dbInstance.getRawMaterials());
    })
  );

  app.post(
    '/api/inventory/raw-materials',
    validateBody(rawMaterialSchema),
    mutation((req, res) => {
      const newMat = dbInstance.addRawMaterial(req.body);
      res.status(201).json(newMat);
    })
  );

  app.put(
    '/api/inventory/raw-materials/:id',
    validateParams(idParamsSchema),
    validateBody(rawMaterialUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateRawMaterial(routeId(req), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Materia prima no encontrada', code: 'NOT_FOUND' });
        return;
      }
      res.json(updated);
    })
  );

  app.post(
    '/api/inventory/movements',
    validateBody(inventoryMovementSchema),
    mutation((req, res) => {
      const mov = dbInstance.addInventoryMovement(req.body);
      res.status(201).json(mov);
    })
  );

  app.get(
    '/api/inventory/movements',
    query((req, res) => {
      res.json(dbInstance.getMovements());
    })
  );

  // --- AUDIT LOGS & TRACEABILITY ---
  app.get(
    '/api/audit-logs',
    query((req, res) => {
      const moduleFilter = req.query['module'] as string | undefined;
      res.json(dbInstance.getAuditLogs(moduleFilter));
    })
  );

  app.post(
    '/api/audit-logs',
    validateBody(auditLogSchema),
    mutation((req, res) => {
      const entry = dbInstance.addAuditLog(req.body);
      res.status(201).json(entry);
    })
  );

  // --- INVENTORY: FINISHED GOODS ---
  app.get(
    '/api/inventory/finished-goods',
    query((req, res) => {
      res.json(dbInstance.getFinishedGoods());
    })
  );

  app.put(
    '/api/inventory/finished-goods/:id',
    validateParams(idParamsSchema),
    validateBody(finishedGoodUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateFinishedGood(routeId(req), req.body);
      if (!updated) {
        res.status(404).json({ error: 'Producto no encontrado', code: 'NOT_FOUND' });
        return;
      }
      res.json(updated);
    })
  );

  // --- RECIPES / BOM ---
  app.get(
    '/api/recipes',
    query((req, res) => {
      res.json(dbInstance.getRecipes());
    })
  );

  app.post(
    '/api/recipes',
    validateBody(recipeSchema),
    mutation((req, res) => {
      const created = dbInstance.addRecipe(req.body);
      res.status(201).json(created);
    })
  );

  // --- PRODUCTION ORDERS (MTO) ---
  app.get(
    '/api/production-orders',
    query((req, res) => {
      res.json(dbInstance.getProductionOrders());
    })
  );

  app.post(
    '/api/production-orders',
    validateBody(productionOrderSchema),
    mutation((req, res) => {
      const result = dbInstance.createProductionOrder(req.body);
      res.status(201).json(result);
    })
  );

  app.post(
    '/api/production-orders/:id/process',
    validateParams(idParamsSchema),
    mutation((req, res) => {
      const result = dbInstance.processProductionOrder(routeId(req));
      res.json(result);
    })
  );

  // --- MANUAL PRODUCTION ORDERS (ADMIN ONLY) ---
  app.get(
    '/api/production-orders/manual',
    query((req, res) => {
      res.json(
        dbInstance
          .getProductionOrders()
          .filter((order) => order.mode === 'manual')
      );
    })
  );

  app.post(
    '/api/production-orders/manual',
    requireAdmin,
    validateBody(manualProductionOrderSchema),
    mutation((req, res) => {
      const created = dbInstance.createManualProductionOrder(
        req.body,
        auditActor(req)
      );
      res.status(201).json(created);
    })
  );

  app.put(
    '/api/production-orders/manual/:id',
    requireAdmin,
    validateParams(idParamsSchema),
    validateBody(manualProductionOrderUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateManualProductionOrder(
        routeId(req),
        req.body,
        auditActor(req)
      );
      res.json(updated);
    })
  );

  app.delete(
    '/api/production-orders/manual/:id',
    requireAdmin,
    validateParams(idParamsSchema),
    mutation((req, res) => {
      dbInstance.deleteManualProductionOrder(routeId(req), auditActor(req));
      res.json({ success: true, message: 'Orden manual eliminada' });
    })
  );

  app.post(
    '/api/production-orders/manual/:id/process',
    requireAdmin,
    validateParams(idParamsSchema),
    mutation((req, res) => {
      const result = dbInstance.processManualProductionOrder(
        routeId(req),
        auditActor(req)
      );
      res.json(result);
    })
  );

  app.post(
    '/api/production-orders/manual/:id/annul',
    requireAdmin,
    validateParams(idParamsSchema),
    mutation((req, res) => {
      const result = dbInstance.annulManualProductionOrder(
        routeId(req),
        auditActor(req)
      );
      res.json(result);
    })
  );

  // --- CUSTOMERS ---
  app.get(
    '/api/sales/customers',
    query((req, res) => {
      res.json(dbInstance.getCustomers());
    })
  );

  app.post(
    '/api/sales/customers',
    validateBody(customerSchema),
    mutation((req, res) => {
      const created = dbInstance.addCustomer(req.body);
      res.status(201).json(created);
    })
  );

  // --- SUPPLIER MASTER DIRECTORY & PRICE CATALOG ---
  app.get(
    '/api/suppliers',
    query((req, res) => {
      res.json(dbInstance.getSuppliers());
    })
  );

  app.post(
    '/api/suppliers',
    validateBody(supplierSchema),
    mutation((req, res) => {
      const created = dbInstance.addSupplier(req.body, auditActor(req));
      res.status(201).json(created);
    })
  );

  app.put(
    '/api/suppliers/:id',
    validateParams(idParamsSchema),
    validateBody(supplierUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateSupplier(
        routeId(req),
        req.body,
        auditActor(req)
      );
      res.json(updated);
    })
  );

  app.delete(
    '/api/suppliers/:id',
    validateParams(idParamsSchema),
    mutation((req, res) => {
      dbInstance.deleteSupplier(routeId(req), auditActor(req));
      res.json({ success: true, message: 'Proveedor eliminado' });
    })
  );

  app.get(
    '/api/suppliers/prices',
    query((req, res) => {
      res.json(dbInstance.getSupplierPrices());
    })
  );

  app.get(
    '/api/suppliers/:id/prices',
    validateParams(idParamsSchema),
    query((req, res) => {
      res.json(dbInstance.getSupplierPrices(routeId(req)));
    })
  );

  app.post(
    '/api/suppliers/:id/prices',
    validateParams(idParamsSchema),
    validateBody(supplierPriceSchema),
    mutation((req, res) => {
      const created = dbInstance.addSupplierPrice(
        routeId(req),
        req.body,
        auditActor(req)
      );
      res.status(201).json(created);
    })
  );

  // --- SALES ORDERS ---
  app.get(
    '/api/sales/orders',
    query((req, res) => {
      res.json(dbInstance.getSalesOrders());
    })
  );

  app.post(
    '/api/sales/orders',
    validateBody(salesOrderSchema),
    mutation((req, res) => {
      // Validación fiscal previa a la emisión
      const fiscalSettings = dbInstance.getFiscalSettings();
      if (!fiscalSettings.companyName || !fiscalSettings.companyTaxId) {
        throw new ApiError(
          400,
          'La configuración fiscal no está completa. Configure los datos de la empresa en Configuración → Datos Fiscales primero.'
        );
      }
      if (!fiscalSettings.taxRatePercent) {
        throw new ApiError(400, 'La alícuota de IVA no está configurada.');
      }
      if (!fiscalSettings.invoicePrefix) {
        throw new ApiError(400, 'El prefijo de factura no está configurado.');
      }
      if (!fiscalSettings.nextInvoiceNumber) {
        throw new ApiError(
          400,
          'El siguiente número de factura no está definido.'
        );
      }

      // Validar que el cliente tenga RIF
      const customer = dbInstance
        .getCustomers()
        .find(c => c.id === req.body.customerId);
      if (!customer) {
        throw new ApiError(404, 'Cliente no encontrado');
      }
      if (!customer.taxId) {
        throw new ApiError(
          400,
          'El cliente debe tener RIF (campo obligatorio para facturación)'
        );
      }

      const created = dbInstance.addSalesOrder(req.body, auditActor(req));
      res.status(201).json(created);
    })
  );

  app.put(
    '/api/sales/orders/:id/status',
    validateParams(idParamsSchema),
    validateBody(salesOrderStatusUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateSalesOrderStatus(
        routeId(req),
        req.body.status
      );
      if (!updated) {
        res.status(404).json({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
        return;
      }
      res.json(updated);
    })
  );

  app.post(
    '/api/sales/orders/:id/collect',
    validateParams(idParamsSchema),
    validateBody(salesCollectionSchema),
    mutation((req, res) => {
      const bank = findBank(req.body.bankCode);
      if (!bank) {
        res.status(422).json({
          error: 'El código de banco no existe en el catálogo SUDEBAN',
          code: 'VALIDATION_ERROR',
        });
        return;
      }
      const updated = dbInstance.collectSalesOrder(
        routeId(req),
        {
          ...req.body,
          bankCode: bank.code,
          bankName: bank.name,
        },
        auditActor(req)
      );
      res.json(updated);
    })
  );

  app.post(
    '/api/sales/orders/:id/create-production-order',
    validateParams(idParamsSchema),
    mutation((req, res) => {
      const so = dbInstance.getSalesOrders().find((s) => s.id === routeId(req));
      if (!so) {
        res.status(404).json({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
        return;
      }

      // Determine recipe by presentation of the first item
      const item = so.items[0];
      const recipes = dbInstance.getRecipes();
      const recipe =
        recipes.find((r) => r.presentation === item.presentation) || recipes[0];

      const batchCount = Math.max(
        1,
        Math.ceil(item.quantity / recipe.batchSizeUnits)
      );

      const result = dbInstance.createProductionOrder({
        recipeId: recipe.id,
        batchCount,
        salesOrderId: so.id,
        lotNumber: `L-MTO-${Date.now().toString().slice(-4)}`,
        operatorNotes: `Orden MTO generada automáticamente para ${so.customerName} (${so.orderNumber})`,
      });

      res.status(201).json(result);
    })
  );

  app.post(
    '/api/sales/orders/:id/create-delivery-note',
    validateParams(idParamsSchema),
    validateBody(deliveryNoteSchema),
    mutation((req, res) => {
      const note = dbInstance.createDeliveryNote(
        routeId(req),
        req.body.transporter
      );
      res.status(201).json(note);
    })
  );

  app.get(
    '/api/sales/delivery-notes',
    query((req, res) => {
      res.json(dbInstance.getDeliveryNotes());
    })
  );

  // --- PAYROLL & WEEKS ---
  app.get(
    '/api/payroll/weeks',
    query((req, res) => {
      res.json(dbInstance.getPayrollWeeks());
    })
  );

  app.post(
    '/api/payroll/weeks',
    validateBody(payrollWeekSchema),
    mutation((req, res) => {
      const created = dbInstance.addPayrollWeek(req.body);
      res.status(201).json(created);
    })
  );

  app.get(
    '/api/payroll/employees',
    query((req, res) => {
      res.json(dbInstance.getEmployees());
    })
  );

  app.post(
    '/api/payroll/employees',
    validateBody(employeeSchema),
    mutation((req, res) => {
      const created = dbInstance.addEmployee(req.body);
      res.status(201).json(created);
    })
  );

  // --- COSTING & MARGINS ---
  app.get(
    '/api/costing/summary',
    query((req, res) => {
      res.json(dbInstance.getCostStructure());
    })
  );

  app.post(
    '/api/costing/simulate',
    validateBody(costingSimulationSchema),
    mutation((req, res) => {
      const {
        directMaterial,
        directPackaging,
        directLabor,
        utilityCost,
        inactiveWeeksCount,
        targetMarginWholesale,
        targetMarginRetail,
      } = req.body;

      // Prorate inactive weeks fixed cost assumption ($185/wk across 48 weeks, approx $3.85 per production lot)
      const inactiveAbsorbedPerUnit = (inactiveWeeksCount * 185) / 1000;
      const totalUnitCost =
        directMaterial +
        directPackaging +
        directLabor +
        utilityCost +
        inactiveAbsorbedPerUnit;

      const wholesaleMargin = (targetMarginWholesale || 30) / 100;
      const retailMargin = (targetMarginRetail || 45) / 100;

      const suggestedWholesale = totalUnitCost / (1 - wholesaleMargin);
      const suggestedRetail = totalUnitCost / (1 - retailMargin);

      res.json({
        totalUnitCost: Number(totalUnitCost.toFixed(2)),
        inactiveAbsorbedPerUnit: Number(inactiveAbsorbedPerUnit.toFixed(2)),
        suggestedWholesalePrice: Number(suggestedWholesale.toFixed(2)),
        suggestedRetailPrice: Number(suggestedRetail.toFixed(2)),
        wholesaleGrossProfit: Number(
          (suggestedWholesale - totalUnitCost).toFixed(2)
        ),
        retailGrossProfit: Number(
          (suggestedRetail - totalUnitCost).toFixed(2)
        ),
      });
    })
  );

  // --- EXPENSES (GASTOS OPERATIVOS, VIAJES, ALQUILER, RETIROS DE SOCIOS) ---
  app.get(
    '/api/expenses',
    query((req, res) => {
      res.json(dbInstance.getExpenses());
    })
  );

  app.post(
    '/api/expenses',
    validateBody(expenseSchema),
    mutation((req, res) => {
      const bank = req.body.issuingBankCode
        ? findBank(req.body.issuingBankCode)
        : undefined;
      const created = dbInstance.addExpense({
        ...req.body,
        issuingBankCode: bank?.code,
        issuingBankName: bank?.name,
      });
      res.status(201).json(created);
    })
  );

  app.delete(
    '/api/expenses/:id',
    validateParams(idParamsSchema),
    mutation((req, res) => {
      const success = dbInstance.deleteExpense(routeId(req));
      if (!success) {
        res.status(404).json({ error: 'Gasto no encontrado', code: 'NOT_FOUND' });
        return;
      }
      res.json({ success: true, message: 'Gasto eliminado exitosamente' });
    })
  );

  // --- EXPENSES CATEGORIES & BUDGETS ---
  app.get(
    '/api/expenses/categories',
    query((req, res) => {
      res.json(dbInstance.getExpenseCategories());
    })
  );

  app.post(
    '/api/expenses/categories',
    validateBody(expenseCategorySchema),
    mutation((req, res) => {
      const created = dbInstance.addExpenseCategory(req.body);
      res.status(201).json(created);
    })
  );

  app.put(
    '/api/expenses/categories/:id',
    validateParams(idParamsSchema),
    validateBody(expenseCategoryUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateExpenseCategory(
        routeId(req),
        req.body
      );
      if (!updated) {
        res.status(404).json({ error: 'Categoría no encontrada', code: 'NOT_FOUND' });
        return;
      }
      res.json(updated);
    })
  );

  app.delete(
    '/api/expenses/categories/:id',
    validateParams(idParamsSchema),
    mutation((req, res) => {
      const success = dbInstance.deleteExpenseCategory(routeId(req));
      if (!success) {
        res.status(404).json({ error: 'Categoría no encontrada', code: 'NOT_FOUND' });
        return;
      }
      res.json({ success: true, message: 'Categoría eliminada exitosamente' });
    })
  );

  // --- FISCAL SETTINGS ---
  app.get(
    '/api/fiscal-settings',
    query((req, res) => {
      res.json(dbInstance.getFiscalSettings());
    })
  );

  app.put(
    '/api/fiscal-settings',
    validateBody(fiscalSettingsSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateFiscalSettings(req.body);
      res.json(updated);
    })
  );

  // --- DAILY EXCHANGE RATES (USD & USDT VENEZUELA) ---
  app.get(
    '/api/exchange-rates',
    query((req, res) => {
      const rates = dbInstance.getExchangeRates();
      res.json(rates);
    })
  );

  app.post(
    '/api/exchange-rates/update',
    validateBody(exchangeRateUpdateSchema),
    mutation((req, res) => {
      const rates = dbInstance.updateExchangeRate(req.body);
      res.json(rates);
    })
  );

  app.post(
    '/api/exchange-rates/refresh',
    mutation(async (req, res) => {
      const rates = await dbInstance.fetchLiveExchangeRates();
      res.json(rates);
    })
  );

  // --- DASHBOARD REPORT ---
  app.get(
    '/api/reports/dashboard',
    query((req, res) => {
      res.json(dbInstance.getDashboardMetrics());
    })
  );

  // --- RESET DEMO DATA ---
  app.post(
    '/api/system/reset',
    mutation((req, res) => {
      dbInstance.reset();
      res.json({
        success: true,
        message: 'Datos de prueba reiniciados al estado original.',
      });
    })
  );

  // --- 404 FOR UNKNOWN API ROUTES + CENTRAL ERROR HANDLER ---
  app.use('/api', apiNotFoundHandler);
  app.use(errorHandler);

  return app;
}
