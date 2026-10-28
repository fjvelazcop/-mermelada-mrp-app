import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import {join} from 'node:path';
import {dbInstance} from './server/erp-database.js';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

app.use(express.json());

// ==========================================
// REST API ROUTES - PULPACRAFT ERP / MRP
// ==========================================

// --- INVENTORY: RAW MATERIALS ---
app.get('/api/inventory/raw-materials', (req, res) => {
  try {
    const materials = dbInstance.getRawMaterials();
    res.json(materials);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/inventory/raw-materials', (req, res) => {
  try {
    const newMat = dbInstance.addRawMaterial(req.body);
    res.status(201).json(newMat);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar materia prima';
    res.status(400).json({ error: msg });
  }
});

app.put('/api/inventory/raw-materials/:id', (req, res) => {
  try {
    const updated = dbInstance.updateRawMaterial(req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Materia prima no encontrada' });
      return;
    }
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al actualizar materia prima';
    res.status(400).json({ error: msg });
  }
});

app.post('/api/inventory/movements', (req, res) => {
  try {
    const mov = dbInstance.addInventoryMovement(req.body);
    res.status(201).json(mov);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar movimiento';
    res.status(400).json({ error: msg });
  }
});

app.get('/api/inventory/movements', (req, res) => {
  try {
    res.json(dbInstance.getMovements());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar movimientos';
    res.status(500).json({ error: msg });
  }
});

// --- AUDIT LOGS & TRACEABILITY ---
app.get('/api/audit-logs', (req, res) => {
  try {
    const moduleFilter = req.query['module'] as string | undefined;
    res.json(dbInstance.getAuditLogs(moduleFilter));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar logs de auditoría';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/audit-logs', (req, res) => {
  try {
    const entry = dbInstance.addAuditLog(req.body);
    res.status(201).json(entry);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar log de auditoría';
    res.status(400).json({ error: msg });
  }
});

// --- INVENTORY: FINISHED GOODS ---
app.get('/api/inventory/finished-goods', (req, res) => {
  try {
    res.json(dbInstance.getFinishedGoods());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar productos terminados';
    res.status(500).json({ error: msg });
  }
});

app.put('/api/inventory/finished-goods/:id', (req, res) => {
  try {
    const updated = dbInstance.updateFinishedGood(req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Producto no encontrado' });
      return;
    }
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al actualizar producto';
    res.status(400).json({ error: msg });
  }
});

// --- RECIPES / BOM ---
app.get('/api/recipes', (req, res) => {
  try {
    res.json(dbInstance.getRecipes());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar recetas';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/recipes', (req, res) => {
  try {
    const created = dbInstance.addRecipe(req.body);
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al crear receta';
    res.status(400).json({ error: msg });
  }
});

// --- PRODUCTION ORDERS (MTO) ---
app.get('/api/production-orders', (req, res) => {
  try {
    res.json(dbInstance.getProductionOrders());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar órdenes';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/production-orders', (req, res) => {
  try {
    const result = dbInstance.createProductionOrder(req.body);
    res.status(201).json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al crear orden de producción';
    res.status(400).json({ error: msg });
  }
});

app.post('/api/production-orders/:id/process', (req, res) => {
  try {
    const result = dbInstance.processProductionOrder(req.params.id);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al procesar orden';
    res.status(400).json({ error: msg });
  }
});

// --- MODELO MANUAL MULTI-FÓRMULA ---
app.post('/api/production-orders/manual', (req, res) => {
  try {
    const result = dbInstance.createManualProductionOrder(req.body);
    res.status(201).json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al crear orden manual';
    res.status(400).json({ error: msg });
  }
});

app.put('/api/production-orders/manual/:id', (req, res) => {
  try {
    const updated = dbInstance.updateManualProductionOrder(req.params.id, req.body, req.body.user || 'Administrador');
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al actualizar orden manual';
    res.status(400).json({ error: msg });
  }
});

app.delete('/api/production-orders/manual/:id', (req, res) => {
  try {
    const success = dbInstance.deleteManualProductionOrder(req.params.id, req.body?.user || 'Administrador');
    res.json({ success });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar orden manual';
    res.status(400).json({ error: msg });
  }
});

// --- PROVEEDORES & CATÁLOGO DE PRECIOS ---
app.get('/api/suppliers', (req, res) => {
  try {
    res.json(dbInstance.getSuppliers());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar proveedores';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/suppliers', (req, res) => {
  try {
    const created = dbInstance.addSupplier(req.body);
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar proveedor';
    res.status(400).json({ error: msg });
  }
});

app.put('/api/suppliers/:id', (req, res) => {
  try {
    const updated = dbInstance.updateSupplier(req.params.id, req.body);
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al actualizar proveedor';
    res.status(400).json({ error: msg });
  }
});

app.delete('/api/suppliers/:id', (req, res) => {
  try {
    const success = dbInstance.deleteSupplier(req.params.id);
    res.json({ success });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar proveedor';
    res.status(400).json({ error: msg });
  }
});

app.post('/api/suppliers/:id/prices', (req, res) => {
  try {
    const item = dbInstance.addSupplierPriceItem(req.params.id, req.body);
    res.status(201).json(item);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar ítem en catálogo de precios';
    res.status(400).json({ error: msg });
  }
});

app.delete('/api/suppliers/:id/prices/:priceId', (req, res) => {
  try {
    const success = dbInstance.deleteSupplierPriceItem(req.params.id, req.params.priceId);
    res.json({ success });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar ítem de precio';
    res.status(400).json({ error: msg });
  }
});

// --- CUSTOMERS ---
app.get('/api/sales/customers', (req, res) => {
  try {
    res.json(dbInstance.getCustomers());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar clientes';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/sales/customers', (req, res) => {
  try {
    const created = dbInstance.addCustomer(req.body);
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al crear cliente';
    res.status(400).json({ error: msg });
  }
});

// --- SALES ORDERS ---
app.get('/api/sales/orders', (req, res) => {
  try {
    res.json(dbInstance.getSalesOrders());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar pedidos';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/sales/orders', (req, res) => {
  try {
    const created = dbInstance.addSalesOrder(req.body);
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al crear pedido de venta';
    res.status(400).json({ error: msg });
  }
});

app.put('/api/sales/orders/:id/status', (req, res) => {
  try {
    const updated = dbInstance.updateSalesOrderStatus(req.params.id, req.body.status);
    if (!updated) {
      res.status(404).json({ error: 'Pedido no encontrado' });
      return;
    }
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al actualizar estado';
    res.status(400).json({ error: msg });
  }
});

app.post('/api/sales/orders/:id/create-production-order', (req, res) => {
  try {
    const so = dbInstance.getSalesOrders().find(s => s.id === req.params.id);
    if (!so) {
      res.status(404).json({ error: 'Pedido no encontrado' });
      return;
    }

    // Determine recipe by presentation of the first item
    const item = so.items[0];
    const recipes = dbInstance.getRecipes();
    const recipe = recipes.find(r => r.presentation === item.presentation) || recipes[0];

    const batchCount = Math.max(1, Math.ceil(item.quantity / recipe.batchSizeUnits));

    const result = dbInstance.createProductionOrder({
      recipeId: recipe.id,
      batchCount,
      salesOrderId: so.id,
      lotNumber: `L-MTO-${Date.now().toString().slice(-4)}`,
      operatorNotes: `Orden MTO generada automáticamente para ${so.customerName} (${so.orderNumber})`,
    });

    res.status(201).json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al crear orden MTO';
    res.status(400).json({ error: msg });
  }
});

app.post('/api/sales/orders/:id/create-delivery-note', (req, res) => {
  try {
    const note = dbInstance.createDeliveryNote(req.params.id, req.body.transporter);
    res.status(201).json(note);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al emitir nota de entrega';
    res.status(400).json({ error: msg });
  }
});

app.get('/api/sales/delivery-notes', (req, res) => {
  try {
    res.json(dbInstance.getDeliveryNotes());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar notas de entrega';
    res.status(500).json({ error: msg });
  }
});

// --- PAYROLL & WEEKS ---
app.get('/api/payroll/weeks', (req, res) => {
  try {
    res.json(dbInstance.getPayrollWeeks());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar nómina';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/payroll/weeks', (req, res) => {
  try {
    const created = dbInstance.addPayrollWeek(req.body);
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar semana de nómina';
    res.status(400).json({ error: msg });
  }
});

app.get('/api/payroll/employees', (req, res) => {
  try {
    res.json(dbInstance.getEmployees());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar empleados';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/payroll/employees', (req, res) => {
  try {
    const created = dbInstance.addEmployee(req.body);
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar empleado';
    res.status(400).json({ error: msg });
  }
});

// --- COSTING & MARGINS ---
app.get('/api/costing/summary', (req, res) => {
  try {
    res.json(dbInstance.getCostStructure());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar estructura de costos';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/costing/simulate', (req, res) => {
  try {
    const { directMaterial, directPackaging, directLabor, utilityCost, inactiveWeeksCount, targetMarginWholesale, targetMarginRetail } = req.body;
    
    // Prorate inactive weeks fixed cost assumption ($185/wk across 48 weeks, approx $3.85 per production lot)
    const inactiveAbsorbedPerUnit = (inactiveWeeksCount * 185) / 1000; // estimated absorption factor
    const totalUnitCost = directMaterial + directPackaging + directLabor + utilityCost + inactiveAbsorbedPerUnit;
    
    const wholesaleMargin = (targetMarginWholesale || 30) / 100;
    const retailMargin = (targetMarginRetail || 45) / 100;

    const suggestedWholesale = totalUnitCost / (1 - wholesaleMargin);
    const suggestedRetail = totalUnitCost / (1 - retailMargin);

    res.json({
      totalUnitCost: Number(totalUnitCost.toFixed(2)),
      inactiveAbsorbedPerUnit: Number(inactiveAbsorbedPerUnit.toFixed(2)),
      suggestedWholesalePrice: Number(suggestedWholesale.toFixed(2)),
      suggestedRetailPrice: Number(suggestedRetail.toFixed(2)),
      wholesaleGrossProfit: Number((suggestedWholesale - totalUnitCost).toFixed(2)),
      retailGrossProfit: Number((suggestedRetail - totalUnitCost).toFixed(2)),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error en simulador de costeo';
    res.status(400).json({ error: msg });
  }
});

// --- EXPENSES (GASTOS OPERATIVOS, VIAJES, ALQUILER, RETIROS DE SOCIOS) ---
app.get('/api/expenses', (req, res) => {
  try {
    res.json(dbInstance.getExpenses());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar gastos';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/expenses', (req, res) => {
  try {
    const created = dbInstance.addExpense(req.body);
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar gasto';
    res.status(400).json({ error: msg });
  }
});

app.delete('/api/expenses/:id', (req, res) => {
  try {
    const success = dbInstance.deleteExpense(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'Gasto no encontrado' });
      return;
    }
    res.json({ success: true, message: 'Gasto eliminado exitosamente' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar gasto';
    res.status(400).json({ error: msg });
  }
});

// --- EXPENSES CATEGORIES & BUDGETS ---
app.get('/api/expenses/categories', (req, res) => {
  try {
    res.json(dbInstance.getExpenseCategories());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar categorías de gastos';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/expenses/categories', (req, res) => {
  try {
    const created = dbInstance.addExpenseCategory(req.body);
    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al crear categoría de gasto';
    res.status(400).json({ error: msg });
  }
});

app.put('/api/expenses/categories/:id', (req, res) => {
  try {
    const updated = dbInstance.updateExpenseCategory(req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Categoría no encontrada' });
      return;
    }
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al actualizar categoría de gasto';
    res.status(400).json({ error: msg });
  }
});

app.delete('/api/expenses/categories/:id', (req, res) => {
  try {
    const success = dbInstance.deleteExpenseCategory(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'Categoría no encontrada' });
      return;
    }
    res.json({ success: true, message: 'Categoría eliminada exitosamente' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al eliminar categoría de gasto';
    res.status(400).json({ error: msg });
  }
});

// --- FISCAL SETTINGS ---
app.get('/api/fiscal-settings', (req, res) => {
  try {
    res.json(dbInstance.getFiscalSettings());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar configuración fiscal';
    res.status(500).json({ error: msg });
  }
});

app.put('/api/fiscal-settings', (req, res) => {
  try {
    const updated = dbInstance.updateFiscalSettings(req.body);
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al guardar configuración fiscal';
    res.status(400).json({ error: msg });
  }
});

// --- DAILY EXCHANGE RATES (USD & USDT VENEZUELA) ---
app.get('/api/exchange-rates', (req, res) => {
  try {
    const rates = dbInstance.getExchangeRates();
    res.json(rates);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al consultar tasas del día';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/exchange-rates/update', (req, res) => {
  try {
    const { usdRate, usdtRate, source, notes } = req.body;
    if (!usdRate || !usdtRate) {
      res.status(400).json({ error: 'Las tasas USD y USDT son requeridas' });
      return;
    }
    const rates = dbInstance.updateExchangeRate({
      usdRate: Number(usdRate),
      usdtRate: Number(usdtRate),
      source,
      notes,
    });
    res.json(rates);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar tasa';
    res.status(400).json({ error: msg });
  }
});

app.post('/api/exchange-rates/refresh', async (req, res) => {
  try {
    const rates = await dbInstance.fetchLiveExchangeRates();
    res.json(rates);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al sincronizar tasas';
    res.status(500).json({ error: msg });
  }
});

// --- DASHBOARD REPORT ---
app.get('/api/reports/dashboard', (req, res) => {
  try {
    res.json(dbInstance.getDashboardMetrics());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al obtener métricas del dashboard';
    res.status(500).json({ error: msg });
  }
});

// --- RESET DEMO DATA ---
app.post('/api/system/reset', (req, res) => {
  try {
    dbInstance.reset();
    res.json({ success: true, message: 'Datos de prueba reiniciados al estado original.' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al reiniciar datos';
    res.status(500).json({ error: msg });
  }
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
