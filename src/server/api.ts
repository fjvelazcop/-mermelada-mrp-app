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
  confirmResetPasswordHandler,
  ensureSeedUsers,
  isAuthEnabled,
  loginHandler,
  logoutHandler,
  meHandler,
  requireAdmin,
  resetPasswordHandler,
} from './auth.js';
import { ApiError, apiNotFoundHandler, errorHandler } from './errors.js';
import {
  auditLogSchema,
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
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  payrollWeekSchema,
  productionOrderSchema,
  rawMaterialSchema,
  rawMaterialUpdateSchema,
  recipeSchema,
  salesCollectionSchema,
  salesOrderSchema,
  salesOrderStatusUpdateSchema,
  supplierPriceSchema,
  supplierSchema,
  supplierUpdateSchema,
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
  app.use(express.json({ limit: '2mb' }));

  // Authentication / RBAC middleware. Both are no-ops unless AUTH_ENABLED=true.
  app.use(authenticate);
  app.use(authorizeRequest);

  ensureSeedUsers();

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
      const created = dbInstance.addSalesOrder(req.body);
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
