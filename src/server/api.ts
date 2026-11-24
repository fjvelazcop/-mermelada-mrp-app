import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { createRequire } from 'node:module';
import type swaggerUiType from 'swagger-ui-express';

// `swagger-ui-express` is CommonJS and relies on `__dirname`. The Angular dev
// server (Vite) bundles SSR dependencies as ESM, where `__dirname` is not
// defined, which crashes every request. Loading it through `createRequire`
// executes the real CommonJS module instead, and also keeps the production
// build's external dependency working.
const require = createRequire(import.meta.url);
const swaggerUi = require('swagger-ui-express') as typeof swaggerUiType;
import { dbInstance } from './erp-database.js';
import { getFiscalReferenceCatalog } from './fiscal-reference-catalog.js';
import { getDb, getDbPath } from './database/persistence.js';
import {
  createActivation,
  deleteActivation,
  listActivations,
  updateActivation,
} from './activation.js';
import { licenseGuard } from './license-guard.js';
import {
  applyLicenseToken,
  ensureSystemLicense,
  getLicenseSnapshot,
  listLicenseAlerts,
  listLicenseEvents,
  suspendLicense,
} from './license.js';
import {
  runLicenseAlertCheck,
  sendLicenseTestEmail,
} from './license-alerts.js';
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
  requireRole,
  resetPasswordHandler,
  updateRoleHandler,
  updateRolePermissionsHandler,
  updateUserHandler,
} from './auth.js';
import { ApiError, apiNotFoundHandler, errorHandler } from './errors.js';
import type { Payable } from '../app/core/models/erp.models.js';
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
  accountSchema,
  accountUpdateSchema,
  accountingBookQuerySchema,
  accountingBookSettingsSchema,
  accountingOpeningAdjustmentSchema,
  accountingOpeningUpdateSchema,
  accountingEntryAnnulmentSchema,
  accountingEntrySchema,
  accountingPeriodKeySchema,
  auditLogSchema,
  activationCreateSchema,
  activationUpdateSchema,
  licenseApplySchema,
  licenseSuspendSchema,
  changePasswordSchema,
  costingSimulationSchema,
  customerSchema,
  deliveryNoteSchema,
  employeeSchema,
  employeeStatusUpdateSchema,
  exchangeRateUpdateSchema,
  expenseCategorySchema,
  expenseCategoryUpdateSchema,
  expenseFiscalEligibilitySchema,
  expenseSchema,
  finishedGoodCreateSchema,
  finishedGoodUpdateSchema,
  fiscalSettingsSchema,
  fiscalObligationParamsSchema,
  fiscalObligationUpdateSchema,
  fiscalReferenceIdParamsSchema,
  fiscalReferenceQuerySchema,
  fiscalReferenceSchema,
  fiscalReferenceAnnulmentSchema,
  fiscalAdjustmentNoteSchema,
  fiscalPeriodParamsSchema,
  fiscalInvoiceAnnulmentSchema,
  idParamsSchema,
  inventoryMovementSchema,
  loginSchema,
  manualProductionOrderSchema,
  manualProductionOrderUpdateSchema,
  manualProductionSheetOrderSchema,
  notificationRecipientCreateSchema,
  notificationRecipientUpdateSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  payrollWeekSchema,
  payablePaymentSchema,
  payableSchema,
  payableUpdateSchema,
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
  materialCategorySchemaInput,
  materialCategoryUpdateSchema,
  presentationTypeSchemaInput,
  presentationTypeUpdateSchema,
  supplierTypeSchema,
  supplierTypeUpdateSchema,
  supplierPriceSchema,
  supplierSchema,
  supplierUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
  parseOrThrow,
  validateBody,
  validateParams,
} from './validation.js';
import { VENEZUELAN_BANKS, findBank } from '../app/core/data/venezuelan-banks.js';
import {
  isValidVenezuelanRif,
  normalizeVenezuelanRif,
} from '../app/core/utils/venezuela-rif.js';
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

/** Valida la cuenta elegida para un asiento automático antes de mutar. */
function rejectInvalidCashAccount(code: string | undefined, res: Response): boolean {
  if (!code) return false;
  const account = dbInstance.getAccountByCode(code);
  if (account?.active && account.type === 'activo') return false;
  res.status(422).json({
    error: 'La cuenta contable elegida no existe, está inactiva o no es de activo',
    code: 'ACCOUNT_NOT_AVAILABLE',
  });
  return true;
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
  // Global license enforcement. It runs after authentication so the master can
  // still reach the license endpoints, and it keeps the API read-only once the
  // license has fully expired.
  app.use(licenseGuard());

  ensureSeedUsers();
  ensureSeedNotificationRecipients();
  ensureSystemLicense();

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

  // --- ACTIVATION & PAYMENT CONTROL (HIDDEN MASTER ROLE ONLY) ---
  app.get(
    '/api/activations',
    requireRole('master'),
    query((_req, res) => {
      res.json(listActivations());
    })
  );
  app.post(
    '/api/activations',
    requireRole('master'),
    validateBody(activationCreateSchema),
    mutation((req, res) => {
      const actor = auditActor(req);
      res.status(201).json(createActivation(req.body, actor.userName));
    })
  );
  app.put(
    '/api/activations/:id',
    requireRole('master'),
    validateParams(idParamsSchema),
    validateBody(activationUpdateSchema),
    mutation((req, res) => {
      const updated = updateActivation(routeId(req), req.body);
      if (!updated) {
        throw new ApiError(404, 'Registro de activación no encontrado');
      }
      res.json(updated);
    })
  );
  app.delete(
    '/api/activations/:id',
    requireRole('master'),
    validateParams(idParamsSchema),
    mutation((req, res) => {
      const deleted = deleteActivation(routeId(req));
      if (!deleted) {
        throw new ApiError(404, 'Registro de activación no encontrado');
      }
      res.json({ success: true, message: 'Registro de activación eliminado' });
    })
  );

  // --- GLOBAL SYSTEM LICENSE (SIGNED TOKEN, MASTER-ONLY WRITES) ---
  app.get(
    '/api/system/license',
    query((_req, res) => {
      res.json(getLicenseSnapshot());
    })
  );

  app.get(
    '/api/system/license/events',
    requireRole('master'),
    query((req, res) => {
      const limit = Number(req.query['limit'] || 20);
      res.json(listLicenseEvents(limit));
    })
  );

  app.get(
    '/api/system/license/alerts',
    requireRole('master'),
    query((req, res) => {
      const limit = Number(req.query['limit'] || 20);
      res.json(listLicenseAlerts(limit));
    })
  );

  app.post(
    '/api/system/license/apply',
    requireRole('master'),
    validateBody(licenseApplySchema),
    mutation((req, res) => {
      const actor = auditActor(req);
      try {
        const result = applyLicenseToken(
          req.body.token,
          actor.userName,
          'api'
        );
        res.json({
          success: true,
          message: 'Licencia aplicada correctamente',
          license: result.snapshot,
          tokenId: result.tokenId,
        });
      } catch (error) {
        throw new ApiError(
          400,
          error instanceof Error ? error.message : String(error),
          'LICENSE_TOKEN_INVALID'
        );
      }
    })
  );

  app.post(
    '/api/system/license/suspend',
    requireRole('master'),
    validateBody(licenseSuspendSchema),
    mutation((req, res) => {
      const actor = auditActor(req);
      const snapshot = suspendLicense(req.body.reason, actor.userName, 'api');
      res.json({
        success: true,
        message: 'Licencia suspendida. El sistema quedó en solo lectura.',
        license: snapshot,
      });
    })
  );

  app.post(
    '/api/system/license/alerts/test',
    requireRole('master'),
    mutation(async (_req, res) => {
      const result = await sendLicenseTestEmail();
      res.json({ success: true, result });
    })
  );

  app.post(
    '/api/system/license/alerts/check',
    requireRole('master'),
    mutation(async (_req, res) => {
      const result = await runLicenseAlertCheck();
      res.json({ success: true, result });
    })
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
      if (
        req.body.supplierId &&
        !dbInstance.getSuppliers().some((s) => s.id === req.body.supplierId)
      ) {
        res.status(400).json({error: 'Proveedor no encontrado', code: 'INVALID_SUPPLIER'});
        return;
      }
      if (rejectInvalidCashAccount(req.body.paymentAccountCode, res)) return;
      const isPurchase = req.body.type === 'entrada';
      // Compatibilidad: las entradas antiguas sin condición explícita se
      // registran de contado y no generan CxP; el crédito siempre es explícito.
      const paymentCondition =
        isPurchase ? (req.body.paymentCondition || 'contado') : undefined;
      const movementInput = {
        ...req.body,
        paymentCondition,
      };
      const referenceDoc = String(req.body.referenceDoc || '').trim();

      // Las compras a crédito necesitan proveedor maestro y documento de
      // referencia para poder generar el CxP con trazabilidad.
      if (
        paymentCondition === 'credito' &&
        (!req.body.supplierId || !referenceDoc)
      ) {
        res.status(422).json({
          error: 'Las compras a crédito requieren proveedor y documento de referencia',
          code: 'MISSING_CREDIT_REFERENCE',
        });
        return;
      }

      if (paymentCondition === 'credito') {
        const existing = dbInstance.findPayableByDocument({
          supplierId: req.body.supplierId,
          supplierName: req.body.supplierNameSnapshot,
          invoiceNumber: referenceDoc,
        });
        if (existing) {
          const info = dbInstance.describePayableOrigin(existing);
          if (info.origin === 'manual') {
            res.status(409).json({
              error: `Ya existe la CxP ${existing.payableNumber} registrada manualmente para este proveedor y el documento ${referenceDoc}. No la vuelvas a cargar; usa esa factura para el pago.`,
              code: 'DUPLICATE_PAYABLE',
              payableNumber: existing.payableNumber,
              origin: 'manual',
            });
            return;
          }
          if (existing.status === 'pagada' || existing.status === 'anulada') {
            res.status(409).json({
              error: `La CxP ${existing.payableNumber} ya está ${existing.status} y no admite nuevas líneas de inventario.`,
              code: 'PAYABLE_CLOSED',
              payableNumber: existing.payableNumber,
              origin: 'compra_inventario',
            });
            return;
          }
          const repeatedLine = dbInstance.findInventoryPurchaseLine(
            existing,
            movementInput
          );
          if (repeatedLine) {
            res.status(201).json({
              movement: repeatedLine,
              payable: dbInstance.decoratePayable(existing),
              reused: true,
              updated: false,
            });
            return;
          }
        }
      }

      const mov = dbInstance.addInventoryMovement(movementInput);
      let payable: Payable | null = null;
      let reused = false;
      let updated = false;
      if (paymentCondition === 'credito') {
        const result = dbInstance.upsertPayableForInventoryPurchase(
          mov,
          auditActor(req)
        );
        if (!result.ok) {
          res.status(409).json({
            error: result.error,
            code: result.code,
            payableNumber: result.payable.payableNumber,
            origin: result.origin,
            movementId: result.movementId,
          });
          return;
        }
        payable = result.payable;
        reused = result.reused;
        updated = result.updated;
      }
      res.status(201).json({movement: mov, payable, reused, updated});
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

  app.post(
    '/api/inventory/finished-goods',
    validateBody(finishedGoodCreateSchema),
    mutation((req, res) => {
      const created = dbInstance.addFinishedGood(req.body, auditActor(req));
      res.status(201).json(created);
    })
  );

  app.put(
    '/api/inventory/finished-goods/:id',
    validateParams(idParamsSchema),
    validateBody(finishedGoodUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateFinishedGood(routeId(req), req.body, auditActor(req));
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

  app.post(
    '/api/production-orders/manual/sheet',
    requireRole('admin', 'master', 'supervisor_planta'),
    validateBody(manualProductionSheetOrderSchema),
    mutation((req, res) => {
      const created = dbInstance.createManualSheetProductionOrder(
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

  // --- EDITABLE CATALOGS: SUPPLIER TYPES ---
  app.get(
    '/api/supplier-types',
    query((req, res) => {
      res.json(dbInstance.getSupplierTypes());
    })
  );

  app.post(
    '/api/supplier-types',
    validateBody(supplierTypeSchema),
    mutation((req, res) => {
      const created = dbInstance.addSupplierType(req.body, auditActor(req));
      res.status(201).json(created);
    })
  );

  app.put(
    '/api/supplier-types/:id',
    validateParams(idParamsSchema),
    validateBody(supplierTypeUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateSupplierType(routeId(req), req.body, auditActor(req));
      res.json(updated);
    })
  );

  app.delete(
    '/api/supplier-types/:id',
    validateParams(idParamsSchema),
    mutation((req, res) => {
      dbInstance.deleteSupplierType(routeId(req), auditActor(req));
      res.json({ success: true, message: 'Tipo de proveedor eliminado' });
    })
  );

  // --- EDITABLE CATALOGS: PRESENTATIONS ---
  app.get(
    '/api/presentation-types',
    query((req, res) => {
      res.json(dbInstance.getPresentationTypes());
    })
  );

  app.post(
    '/api/presentation-types',
    validateBody(presentationTypeSchemaInput),
    mutation((req, res) => {
      const created = dbInstance.addPresentationType(req.body, auditActor(req));
      res.status(201).json(created);
    })
  );

  app.put(
    '/api/presentation-types/:id',
    validateParams(idParamsSchema),
    validateBody(presentationTypeUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updatePresentationType(routeId(req), req.body, auditActor(req));
      res.json(updated);
    })
  );

  app.delete(
    '/api/presentation-types/:id',
    validateParams(idParamsSchema),
    mutation((req, res) => {
      dbInstance.deletePresentationType(routeId(req), auditActor(req));
      res.json({ success: true, message: 'Presentación eliminada' });
    })
  );

  // --- EDITABLE CATALOGS: MATERIAL CATEGORIES ---
  app.get(
    '/api/material-categories',
    query((req, res) => {
      res.json(dbInstance.getMaterialCategories());
    })
  );

  app.post(
    '/api/material-categories',
    validateBody(materialCategorySchemaInput),
    mutation((req, res) => {
      const created = dbInstance.addMaterialCategory(req.body, auditActor(req));
      res.status(201).json(created);
    })
  );

  app.put(
    '/api/material-categories/:id',
    validateParams(idParamsSchema),
    validateBody(materialCategoryUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateMaterialCategory(routeId(req), req.body, auditActor(req));
      res.json(updated);
    })
  );

  app.delete(
    '/api/material-categories/:id',
    validateParams(idParamsSchema),
    mutation((req, res) => {
      dbInstance.deleteMaterialCategory(routeId(req), auditActor(req));
      res.json({ success: true, message: 'Categoría de materia prima eliminada' });
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
      const customer = dbInstance
        .getCustomers()
        .find((entry) => entry.id === req.body.customerId);
      if (!customer) {
        throw new ApiError(404, 'Cliente no encontrado');
      }

      const fiscalSettings = dbInstance.getFiscalSettings();
      if (fiscalSettings.enabled) {
        if (
          !fiscalSettings.companyName.trim() ||
          !isValidVenezuelanRif(fiscalSettings.companyTaxId)
        ) {
          throw new ApiError(
            400,
            'La configuración fiscal del emisor está incompleta o su RIF no es válido.'
          );
        }

        if (!isValidVenezuelanRif(customer.taxId)) {
          throw new ApiError(
            400,
            'El cliente debe tener un RIF venezolano válido antes de emitir la factura.'
          );
        }
        if (
          normalizeVenezuelanRif(req.body.customerTaxId) !==
          normalizeVenezuelanRif(customer.taxId)
        ) {
          throw new ApiError(
            400,
            'El RIF del pedido no coincide con el registrado en la ficha del cliente.'
          );
        }

        const hasTaxableItemsWithoutRate = req.body.items.some(
          (item: { taxCategory?: string; taxRatePercent?: number }) =>
            (item.taxCategory ?? 'gravado') === 'gravado' &&
            item.taxRatePercent === undefined
        );
        if (
          hasTaxableItemsWithoutRate &&
          (!Number.isFinite(fiscalSettings.taxRatePercent) ||
            fiscalSettings.taxRatePercent <= 0)
        ) {
          throw new ApiError(400, 'La alícuota de IVA no está configurada.');
        }
        if (!fiscalSettings.invoicePrefix.trim() || !fiscalSettings.invoiceSerie.trim()) {
          throw new ApiError(
            400,
            'El prefijo y la serie de factura deben estar configurados.'
          );
        }

        const exchangeRate =
          req.body.exchangeRateUsed ?? dbInstance.getExchangeRates().currentUsd;
        if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
          throw new ApiError(
            400,
            'No hay una tasa BCV válida para convertir los importes de la factura.'
          );
        }

        dbInstance.assertFiscalInvoiceSequenceAvailable(
          fiscalSettings.invoiceSerie,
          fiscalSettings.nextInvoiceNumber,
          fiscalSettings.nextControlNumber
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
      if (rejectInvalidCashAccount(req.body.accountCode, res)) return;
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

  app.get(
    '/api/sales/orders/:id/collections',
    validateParams(idParamsSchema),
    query((req, res) => {
      const order = dbInstance.getSalesOrder(routeId(req));
      if (!order) {
        res.status(404).json({ error: 'Pedido no encontrado', code: 'NOT_FOUND' });
        return;
      }
      res.json(dbInstance.getSalesOrderCollections(order.id));
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

  app.patch(
    '/api/payroll/employees/:id',
    validateParams(idParamsSchema),
    validateBody(employeeStatusUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateEmployeeStatus(
        routeId(req),
        req.body.status,
        auditActor(req)
      );
      if (!updated) throw new ApiError(404, 'Operario no encontrado');
      res.json(updated);
    })
  );

  app.delete(
    '/api/payroll/employees/:id',
    validateParams(idParamsSchema),
    mutation((req, res) => {
      const id = routeId(req);
      if (!dbInstance.getEmployees().some((employee) => employee.id === id)) {
        throw new ApiError(404, 'Operario no encontrado');
      }
      if (dbInstance.hasEmployeePayments(id)) {
        throw new ApiError(
          409,
          'El operario ya tiene pagos registrados. Desactívelo para conservar la trazabilidad.',
          'EMPLOYEE_HAS_PAYMENTS'
        );
      }
      const deleted = dbInstance.deleteEmployee(id, auditActor(req));
      if (!deleted) throw new ApiError(404, 'Operario no encontrado');
      res.json({success: true, message: 'Operario eliminado'});
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
      if (rejectInvalidCashAccount(req.body.paymentAccountCode, res)) return;
      if (
        req.body.supplierId &&
        !dbInstance.getSuppliers().some((s) => s.id === req.body.supplierId)
      ) {
        res.status(400).json({error: 'Proveedor no encontrado', code: 'INVALID_SUPPLIER'});
        return;
      }
      const bank = req.body.issuingBankCode
        ? findBank(req.body.issuingBankCode)
        : undefined;
      const created = dbInstance.addExpense(
        {
          ...req.body,
          issuingBankCode: bank?.code,
          issuingBankName: bank?.name,
        },
        auditActor(req)
      );
      res.status(201).json(created);
    })
  );

  app.patch(
    '/api/expenses/:id/fiscal-eligibility',
    validateParams(idParamsSchema),
    validateBody(expenseFiscalEligibilitySchema),
    mutation((req, res) => {
      const updated = dbInstance.setExpenseFiscalEligibility(
        routeId(req),
        req.body.fiscalBookEligible,
        auditActor(req)
      );
      if (!updated) {
        res.status(404).json({ error: 'Gasto no encontrado', code: 'NOT_FOUND' });
        return;
      }
      res.json(updated);
    })
  );

  app.delete(
    '/api/expenses/:id',
    validateParams(idParamsSchema),
    mutation((req, res) => {
      const success = dbInstance.deleteExpense(routeId(req), auditActor(req));
      if (!success) {
        res.status(404).json({ error: 'Gasto no encontrado', code: 'NOT_FOUND' });
        return;
      }
      res.json({ success: true, message: 'Gasto eliminado exitosamente' });
    })
  );

  // --- CONTABILIDAD (FASE 1): PLAN DE CUENTAS, ASIENTOS Y PERÍODOS ---
  app.get(
    '/api/accounting/books',
    query((req, res) => {
      const {type, year, month} = parseOrThrow(accountingBookQuerySchema, req.query);
      res.json(dbInstance.getAccountingBook(type, year, month, auditActor(req)));
    })
  );

  app.get(
    '/api/accounting/accounts',
    query((req, res) => res.json(dbInstance.getAccounts()))
  );

  app.post(
    '/api/accounting/accounts',
    validateBody(accountSchema),
    mutation((req, res) => {
      const created = dbInstance.addAccount(req.body, auditActor(req));
      res.status(201).json(created);
    })
  );

  app.patch(
    '/api/accounting/accounts/:id',
    validateParams(idParamsSchema),
    validateBody(accountUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateAccount(routeId(req), req.body, auditActor(req));
      if (!updated) {
        res.status(404).json({error: 'Cuenta contable no encontrada', code: 'NOT_FOUND'});
        return;
      }
      res.json(updated);
    })
  );

  // --- APERTURA PROVISIONAL #13 ---
  app.get(
    '/api/accounting/opening',
    query((req, res) => res.json(dbInstance.getAccountingOpening()))
  );

  app.patch(
    '/api/accounting/opening',
    requireRole('admin', 'master'),
    validateBody(accountingOpeningUpdateSchema),
    mutation((req, res) => {
      res.json(dbInstance.updateAccountingOpening(req.body, auditActor(req)));
    })
  );

  app.post(
    '/api/accounting/opening/adjustments',
    requireRole('admin', 'master'),
    validateBody(accountingOpeningAdjustmentSchema),
    mutation((req, res) => {
      res.status(201).json(dbInstance.recordOpeningAdjustment(req.body, auditActor(req)));
    })
  );

  app.get(
    '/api/accounting/entries',
    query((req, res) => res.json(dbInstance.getAccountingEntries()))
  );

  app.post(
    '/api/accounting/entries',
    validateBody(accountingEntrySchema),
    mutation((req, res) => {
      const created = dbInstance.createAccountingEntry(req.body, auditActor(req));
      res.status(201).json(created);
    })
  );

  app.post(
    '/api/accounting/entries/:id/confirm',
    requireRole('admin', 'master'),
    validateParams(idParamsSchema),
    mutation((req, res) => {
      res.json(dbInstance.confirmAccountingEntry(routeId(req), auditActor(req)));
    })
  );

  app.post(
    '/api/accounting/entries/:id/annul',
    requireRole('admin', 'master'),
    validateParams(idParamsSchema),
    validateBody(accountingEntryAnnulmentSchema),
    mutation((req, res) => {
      res.json(
        dbInstance.annulAccountingEntry(routeId(req), req.body.reason, auditActor(req))
      );
    })
  );

  app.get(
    '/api/accounting/hash/verify',
    query((req, res) => res.json(dbInstance.verifyAccountingHashes(false, auditActor(req))))
  );

  app.post(
    '/api/accounting/hash/rebuild',
    requireRole('admin', 'master'),
    mutation((req, res) => res.json(dbInstance.verifyAccountingHashes(true, auditActor(req))))
  );

  app.get(
    '/api/accounting/periods',
    query((req, res) => res.json(dbInstance.getAccountingPeriods()))
  );

  app.post(
    '/api/accounting/periods/:key/close',
    requireRole('admin', 'master'),
    validateParams(accountingPeriodKeySchema),
    mutation((req, res) => {
      res.json(dbInstance.closeAccountingPeriod(String(req.params['key']), auditActor(req)));
    })
  );

  app.post(
    '/api/accounting/periods/:key/open',
    requireRole('admin', 'master'),
    validateParams(accountingPeriodKeySchema),
    mutation((req, res) => {
      res.json(dbInstance.openAccountingPeriod(String(req.params['key']), auditActor(req)));
    })
  );

  // --- CUENTAS POR PAGAR (pestaña de Gastos) ---
  app.get('/api/payables', query((req, res) => res.json(dbInstance.listPayables())));

  // Static path goes before `/api/payables/:id` so it is not captured as an id.
  app.get(
    '/api/payables/payments',
    query((req, res) => res.json(dbInstance.getPayablePayments()))
  );

  app.post(
    '/api/payables',
    validateBody(payableSchema),
    mutation((req, res) => {
      const duplicate = dbInstance.findPayableByDocument({
        supplierId: req.body.supplierId,
        supplierName: req.body.supplierName,
        invoiceNumber: req.body.invoiceNumber,
      });
      if (duplicate) {
        const info = dbInstance.describePayableOrigin(duplicate);
        const originLabel =
          info.origin === 'compra_inventario' ? 'Compra de Inventario' : 'CxP Manual';
        res.status(409).json({
          error: `Ya existe la CxP ${duplicate.payableNumber} (${originLabel}) para este proveedor y el documento ${req.body.invoiceNumber}. No la registres de nuevo.`,
          code: 'DUPLICATE_PAYABLE',
          payableNumber: duplicate.payableNumber,
          origin: info.origin,
          movementId: info.movementId,
        });
        return;
      }
      const created = dbInstance.addPayable(
        {...req.body, status: req.body.status || 'pendiente'},
        auditActor(req)
      );
      res.status(201).json(dbInstance.decoratePayable(created));
    })
  );

  app.get(
    '/api/payables/:id',
    validateParams(idParamsSchema),
    query((req, res) => {
      const payable = dbInstance.getPayable(routeId(req));
      if (!payable) {
        res.status(404).json({error: 'Factura por pagar no encontrada', code: 'NOT_FOUND'});
        return;
      }
      res.json(dbInstance.decoratePayable(payable));
    })
  );

  app.patch(
    '/api/payables/:id',
    validateParams(idParamsSchema),
    validateBody(payableUpdateSchema),
    mutation((req, res) => {
      const updated = dbInstance.updatePayable(routeId(req), req.body, auditActor(req));
      if (!updated) {
        res.status(404).json({error: 'Factura por pagar no encontrada', code: 'NOT_FOUND'});
        return;
      }
      res.json(dbInstance.decoratePayable(updated));
    })
  );

  app.get(
    '/api/payables/:id/payments',
    validateParams(idParamsSchema),
    query((req, res) => {
      const payable = dbInstance.getPayable(routeId(req));
      if (!payable) {
        res.status(404).json({error: 'Factura por pagar no encontrada', code: 'NOT_FOUND'});
        return;
      }
      res.json(dbInstance.getPayablePayments(payable.id));
    })
  );

  app.post(
    '/api/payables/:id/payments',
    validateParams(idParamsSchema),
    validateBody(payablePaymentSchema),
    mutation((req, res) => {
      if (rejectInvalidCashAccount(req.body.accountCode, res)) return;
      const bank = findBank(req.body.bankCode);
      if (!bank) {
        res.status(422).json({
          error: 'El código de banco no existe en el catálogo SUDEBAN',
          code: 'VALIDATION_ERROR',
        });
        return;
      }
      const result = dbInstance.recordPayablePayment(
        routeId(req),
        {...req.body, bankCode: bank.code, bankName: req.body.bankName || bank.name},
        auditActor(req)
      );
      res.status(201).json({...result, payable: dbInstance.decoratePayable(result.payable)});
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
      const created = dbInstance.addExpenseCategory(req.body, auditActor(req));
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
        req.body,
        auditActor(req)
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
      const success = dbInstance.deleteExpenseCategory(routeId(req), auditActor(req));
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
    requireAdmin,
    validateBody(fiscalSettingsSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateFiscalSettings(
        req.body,
        auditActor(req)
      );
      res.json(updated);
    })
  );

  app.get(
    '/api/fiscal-obligations',
    requireAdmin,
    query((_req, res) => {
      res.json({
        obligations: dbInstance.getFiscalObligations(),
        history: dbInstance.getFiscalObligationHistory(),
      });
    })
  );

  app.put(
    '/api/fiscal-obligations/:key',
    requireAdmin,
    validateParams(fiscalObligationParamsSchema),
    validateBody(fiscalObligationUpdateSchema),
    mutation((req, res) => {
      const { key } = fiscalObligationParamsSchema.parse(req.params);
      const updated = dbInstance.updateFiscalObligation(
        key,
        req.body,
        auditActor(req)
      );
      if (!updated) {
        throw new ApiError(404, 'Obligación fiscal no encontrada');
      }
      res.json(updated);
    })
  );

  // --- CATÁLOGO DE REFERENCIA FASE 0 (IVA / ISLR) ---
  app.get(
    '/api/fiscal-reference-catalog',
    requireAdmin,
    query((_req, res) => {
      res.json(getFiscalReferenceCatalog());
    })
  );

  // --- VALORES FISCALES HISTÓRICOS (IVA / UT) ---
  app.get(
    '/api/fiscal-reference-values',
    requireAdmin,
    query((req, res) => {
      const params = parseOrThrow(fiscalReferenceQuerySchema, req.query);
      const values = dbInstance.getFiscalReferenceValues(
        params.kind,
        params.includeAnnulled !== 'false'
      );
      const date = params.date || new Date().toISOString().slice(0, 10);
      res.json({
        values,
        activeIva: dbInstance.getActiveFiscalReferenceValue('iva', date),
        activeUt: dbInstance.getActiveFiscalReferenceValue('ut', date),
        date,
      });
    })
  );

  app.get(
    '/api/fiscal-reference-values/active',
    requireAdmin,
    query((req, res) => {
      const params = parseOrThrow(fiscalReferenceQuerySchema, req.query);
      if (!params.kind) {
        throw new ApiError(400, 'Indique kind=iva o kind=ut');
      }
      const date = params.date || new Date().toISOString().slice(0, 10);
      const value = dbInstance.getActiveFiscalReferenceValue(params.kind, date);
      if (!value) {
        throw new ApiError(404, 'No hay valor vigente para la fecha indicada');
      }
      res.json(value);
    })
  );

  app.post(
    '/api/fiscal-reference-values',
    requireAdmin,
    validateBody(fiscalReferenceSchema),
    mutation((req, res) => {
      res.status(201).json(
        dbInstance.createFiscalReferenceValue(req.body, auditActor(req))
      );
    })
  );

  app.put(
    '/api/fiscal-reference-values/:id',
    requireAdmin,
    validateParams(fiscalReferenceIdParamsSchema),
    validateBody(fiscalReferenceSchema),
    mutation((req, res) => {
      const updated = dbInstance.updateFiscalReferenceValue(
        routeId(req),
        req.body,
        auditActor(req)
      );
      if (!updated) {
        throw new ApiError(404, 'Valor fiscal de referencia no encontrado');
      }
      res.json(updated);
    })
  );

  app.post(
    '/api/fiscal-reference-values/:id/annul',
    requireAdmin,
    validateParams(fiscalReferenceIdParamsSchema),
    validateBody(fiscalReferenceAnnulmentSchema),
    mutation((req, res) => {
      const annulled = dbInstance.annulFiscalReferenceValue(
        routeId(req),
        req.body.reason,
        auditActor(req)
      );
      if (!annulled) {
        throw new ApiError(404, 'Valor fiscal de referencia no encontrado');
      }
      res.json(annulled);
    })
  );

  app.get(
    '/api/accounting-book-settings',
    requireAdmin,
    query((_req, res) => {
      res.json(dbInstance.getAccountingBookSettings());
    })
  );

  app.put(
    '/api/accounting-book-settings',
    requireAdmin,
    validateBody(accountingBookSettingsSchema),
    mutation((req, res) => {
      res.json(dbInstance.updateAccountingBookSettings(req.body, auditActor(req)));
    })
  );

  // --- FISCAL INVOICES (SENIAT) ---
  app.get(
    '/api/fiscal-invoices',
    query((req, res) => {
      const year = req.query['year'] ? Number(req.query['year']) : undefined;
      const month = req.query['month'] ? Number(req.query['month']) : undefined;
      res.json(dbInstance.getFiscalInvoices(year, month));
    })
  );

  app.get(
    '/api/fiscal-invoices/:id',
    validateParams(idParamsSchema),
    query((req, res) => {
      const invoice = dbInstance.getFiscalInvoiceById(routeId(req));
      if (!invoice) {
        throw new ApiError(404, 'Factura fiscal no encontrada');
      }
      res.json(invoice);
    })
  );

  app.post(
    '/api/fiscal-invoices/:id/print',
    validateParams(idParamsSchema),
    mutation((req, res) => {
      const result = dbInstance.recordFiscalInvoicePrint(
        routeId(req),
        auditActor(req)
      );
      if (!result) {
        throw new ApiError(404, 'Factura fiscal no encontrada');
      }
      res.json(result);
    })
  );

  app.post(
    '/api/fiscal-invoices/:id/annul',
    requireAdmin,
    validateParams(idParamsSchema),
    validateBody(fiscalInvoiceAnnulmentSchema),
    mutation((req, res) => {
      const invoice = dbInstance.annulFiscalInvoice(
        routeId(req),
        req.body.reason,
        auditActor(req)
      );
      res.json(invoice);
    })
  );

  app.get(
    '/api/fiscal-adjustment-notes',
    query((req, res) => {
      const year = req.query['year'] ? Number(req.query['year']) : undefined;
      const month = req.query['month'] ? Number(req.query['month']) : undefined;
      res.json(dbInstance.getFiscalAdjustmentNotes(year, month));
    })
  );

  app.post(
    '/api/fiscal-adjustment-notes',
    requireAdmin,
    validateBody(fiscalAdjustmentNoteSchema),
    mutation((req, res) => {
      const note = dbInstance.createFiscalAdjustmentNote(req.body, auditActor(req));
      res.status(201).json(note);
    })
  );

  app.post(
    '/api/fiscal-adjustment-notes/:id/print',
    validateParams(idParamsSchema),
    mutation((req, res) => {
      const result = dbInstance.recordFiscalAdjustmentNotePrint(
        routeId(req),
        auditActor(req)
      );
      if (!result) throw new ApiError(404, 'Nota fiscal no encontrada.');
      res.json(result);
    })
  );

  app.get(
    '/api/fiscal-books/:year/:month',
    requireAdmin,
    validateParams(fiscalPeriodParamsSchema),
    query((req, res) => {
      res.json(
        dbInstance.getFiscalBooks(Number(req.params['year']), Number(req.params['month']))
      );
    })
  );

  app.post(
    '/api/fiscal-books/:year/:month/export',
    requireAdmin,
    validateParams(fiscalPeriodParamsSchema),
    mutation((req, res) => {
      const result = dbInstance.recordFiscalBooksExport(
        Number(req.params['year']),
        Number(req.params['month']),
        auditActor(req)
      );
      res.json(result);
    })
  );

  app.post(
    '/api/fiscal-books/:year/:month/close',
    requireAdmin,
    validateParams(fiscalPeriodParamsSchema),
    mutation((req, res) => {
      const closure = dbInstance.createFiscalPeriodClosure(
        Number(req.params['year']),
        Number(req.params['month']),
        auditActor(req)
      );
      res.status(201).json(closure);
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

  // --- OPERATIONAL RESET (admin/master only) ---
  app.post(
    '/api/system/reset-operational',
    requireAdmin,
    mutation((req, res) => {
      dbInstance.resetOperationalData(auditActor(req));
      res.json({
        success: true,
        message: 'Gastos, órdenes y movimientos eliminados; existencias en cero.',
      });
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
