import {inject, Injectable, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {
  RawMaterial,
  InventoryMovement,
  FinishedGood,
  RecipeBOM,
  ProductionOrder,
  Customer,
  SalesOrder,
  DeliveryNote,
  Employee,
  PayrollWeek,
  FiscalSettings,
  CostStructureAnalysis,
  UserRole,
  DailyExchangeRates,
  WeeklySalesStat,
  InventoryTurnoverStat,
  InventoryTurnoverCategory,
  ProductionStockAlert,
  RecipeFeasibilityResult,
  AppModuleId,
  ModulePermissions,
  SystemRole,
  SystemUser,
  AuditLogEntry,
  Expense,
} from '../models/erp.models';
import {formatVeCurrency} from '../pipes/ve-currency.pipe';
import {computed} from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ErpApiService {
  private http = inject(HttpClient);

  // --- RBAC & ROLE-BASED ACCESS CONTROL STATE ---
  public systemRoles = signal<SystemRole[]>([
    {
      id: 'admin',
      name: 'Administrador General',
      description: 'Acceso total y sin restricciones a todos los módulos y operaciones del sistema',
      isSystem: true,
      color: 'stone',
      permissions: {
        dashboard: { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
        inventory: { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
        production: { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
        costing: { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
        sales: { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
        payroll: { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
        expenses: { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
        settings: { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
        architecture: { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true },
      },
    },
    {
      id: 'supervisor_planta',
      name: 'Supervisor de Planta & BOM',
      description: 'Supervisa formulaciones, órdenes de cocción en marmitas y control de stock',
      isSystem: false,
      color: 'amber',
      permissions: {
        dashboard: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
        inventory: { canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
        production: { canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
        costing: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        sales: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        payroll: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        expenses: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        settings: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        architecture: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
      },
    },
    {
      id: 'operator',
      name: 'Operador de Producción',
      description: 'Operario de planta para cocción de tandas en marmitas y generación de órdenes OP (sin acceso a precios ni datos financieros)',
      isSystem: true,
      color: 'blue',
      permissions: {
        dashboard: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        inventory: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        production: { canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false },
        costing: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        sales: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        payroll: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        expenses: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        settings: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        architecture: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
      },
    },
    {
      id: 'analista_costos',
      name: 'Analista de Costos & Precios',
      description: 'Gestiona la hoja de costos, cálculo de insumos, márgenes comerciales y cotizaciones',
      isSystem: false,
      color: 'emerald',
      permissions: {
        dashboard: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
        inventory: { canView: true, canCreate: false, canEdit: true, canDelete: false, canExport: true },
        production: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        costing: { canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
        sales: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
        payroll: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        expenses: { canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
        settings: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        architecture: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
      },
    },
    {
      id: 'almacenista',
      name: 'Almacén & Despachos',
      description: 'Control de inventario físico, entradas de materia prima y emisión de notas de entrega',
      isSystem: false,
      color: 'purple',
      permissions: {
        dashboard: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        inventory: { canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: true },
        production: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        costing: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        sales: { canView: true, canCreate: true, canEdit: false, canDelete: false, canExport: true },
        payroll: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        expenses: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        settings: { canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false },
        architecture: { canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false },
      },
    },
  ]);

  public systemUsers = signal<SystemUser[]>([
    {
      id: 'usr-admin',
      fullName: 'Felipe Velazco',
      username: 'fvelazco',
      email: 'fvelazco@pulpacraft.com',
      nationalId: 'V-18.490.231',
      roleId: 'admin',
      roleName: 'Administrador General',
      department: 'Dirección General',
      status: 'activo',
      avatarBg: 'bg-stone-900',
      createdAt: '2026-01-15',
    },
    {
      id: 'usr-hermes',
      fullName: 'Hermes Rodríguez',
      username: 'hrodriguez',
      email: 'hrodriguez@pulpacraft.com',
      nationalId: 'V-14.882.102',
      roleId: 'supervisor_planta',
      roleName: 'Supervisor de Planta & BOM',
      department: 'Producción & Cocción',
      status: 'activo',
      avatarBg: 'bg-amber-600',
      createdAt: '2026-02-01',
    },
    {
      id: 'usr-denis',
      fullName: 'Denis Briceño',
      username: 'dbriceno',
      email: 'dbriceno@pulpacraft.com',
      nationalId: 'V-20.119.456',
      roleId: 'operator',
      roleName: 'Operador de Producción',
      department: 'Planta de Elaboración & Cocción',
      status: 'activo',
      avatarBg: 'bg-blue-600',
      createdAt: '2026-02-15',
    },
    {
      id: 'usr-daniela',
      fullName: 'Daniela Silva',
      username: 'dsilva',
      email: 'dsilva@pulpacraft.com',
      nationalId: 'V-22.340.890',
      roleId: 'analista_costos',
      roleName: 'Analista de Costos & Precios',
      department: 'Finanzas & Costos',
      status: 'activo',
      avatarBg: 'bg-emerald-600',
      createdAt: '2026-03-01',
    },
    {
      id: 'usr-luis',
      fullName: 'Luis Morales',
      username: 'lmorales',
      email: 'lmorales@pulpacraft.com',
      nationalId: 'V-16.789.234',
      roleId: 'almacenista',
      roleName: 'Almacén & Despachos',
      department: 'Logística & Almacén',
      status: 'activo',
      avatarBg: 'bg-purple-600',
      createdAt: '2026-03-10',
    },
  ]);

  public activeUserId = signal<string>('usr-admin');

  public currentUser = computed<SystemUser>(() => {
    const list = this.systemUsers();
    return list.find(u => u.id === this.activeUserId()) || list[0];
  });

  public currentRoleObject = computed<SystemRole>(() => {
    const user = this.currentUser();
    const roles = this.systemRoles();
    return roles.find(r => r.id === user.roleId) || roles[0];
  });

  // User Role Signal (kept for backward compatibility, automatically synced with currentUser)
  public currentRole = signal<UserRole>('admin');

  // Helper to detect if active user is a production operator
  public isProductionOperator = computed<boolean>(() => {
    const role = this.currentRoleObject();
    const rId = role?.id || this.currentRole();
    return rId === 'operator' || rId === 'operador_produccion';
  });

  // Controls whether financial prices, costs, and exchange rate tickers are visible
  public canViewPrices = computed<boolean>(() => {
    return !this.isProductionOperator();
  });

  // Cross-component tab navigation request signal
  public requestedTab = signal<AppModuleId | null>(null);

  public navigateToTab(tab: AppModuleId) {
    this.requestedTab.set(tab);
  }

  public toggleRole() {
    if (this.currentRole() === 'admin') {
      const opUser = this.systemUsers().find(u => u.roleId === 'operator');
      if (opUser) {
        this.setActiveUser(opUser.id);
      } else {
        this.currentRole.set('operator');
      }
    } else {
      this.setActiveUser('usr-admin');
    }
  }

  public hasPermission(moduleId: AppModuleId, action: 'canView' | 'canCreate' | 'canEdit' | 'canDelete' | 'canExport' = 'canView'): boolean {
    const role = this.currentRoleObject();
    if (!role) return true;
    if (role.id === 'admin') return true;
    const modPerm = role.permissions[moduleId];
    if (!modPerm) return false;
    return !!modPerm[action];
  }

  public canViewModule(moduleId: AppModuleId): boolean {
    return this.hasPermission(moduleId, 'canView');
  }

  public setActiveUser(userId: string) {
    const user = this.systemUsers().find(u => u.id === userId);
    if (user) {
      this.activeUserId.set(user.id);
      this.currentRole.set(user.roleId as UserRole);
      this.showToast(`Usuario activo simulado: ${user.fullName} (${user.roleName})`, 'info');
    }
  }

  public addUser(userData: Omit<SystemUser, 'id' | 'createdAt'>) {
    const id = 'usr-' + Date.now().toString(36);
    const role = this.systemRoles().find(r => r.id === userData.roleId);
    const newUser: SystemUser = {
      ...userData,
      id,
      roleName: role ? role.name : 'Usuario',
      createdAt: new Date().toISOString().slice(0, 10),
    };
    this.systemUsers.update(list => [...list, newUser]);
    this.showToast(`Usuario "${newUser.fullName}" creado exitosamente.`);
    return newUser;
  }

  public updateUser(userId: string, data: Partial<SystemUser>) {
    this.systemUsers.update(list =>
      list.map(u => {
        if (u.id !== userId) return u;
        const role = data.roleId ? this.systemRoles().find(r => r.id === data.roleId) : null;
        return {
          ...u,
          ...data,
          roleName: role ? role.name : u.roleName,
        };
      })
    );
    this.showToast('Usuario actualizado con éxito.');
  }

  public deleteUser(userId: string) {
    if (userId === 'usr-admin') {
      this.showToast('No se puede eliminar el usuario Administrador principal.', 'error');
      return;
    }
    this.systemUsers.update(list => list.filter(u => u.id !== userId));
    if (this.activeUserId() === userId) {
      this.setActiveUser('usr-admin');
    }
    this.showToast('Usuario eliminado del sistema.');
  }

  public addRole(roleData: Omit<SystemRole, 'id'>) {
    const id = 'role-' + Date.now().toString(36);
    const newRole: SystemRole = {
      ...roleData,
      id,
      isSystem: false,
    };
    this.systemRoles.update(roles => [...roles, newRole]);
    this.showToast(`Rol "${newRole.name}" creado con éxito.`);
    return newRole;
  }

  public updateRolePermissions(roleId: string, moduleId: AppModuleId, perm: Partial<ModulePermissions>) {
    this.systemRoles.update(roles =>
      roles.map(r => {
        if (r.id !== roleId) return r;
        const currentModPerm = r.permissions[moduleId] || {
          canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false,
        };
        return {
          ...r,
          permissions: {
            ...r.permissions,
            [moduleId]: {
              ...currentModPerm,
              ...perm,
            },
          },
        };
      })
    );
    this.showToast('Permisos actualizados para el rol.');
  }

  public deleteRole(roleId: string) {
    const role = this.systemRoles().find(r => r.id === roleId);
    if (role?.isSystem) {
      this.showToast('No se pueden eliminar los roles base del sistema.', 'error');
      return;
    }
    this.systemRoles.update(roles => roles.filter(r => r.id !== roleId));
    this.showToast('Rol eliminado con éxito.');
  }

  // Signals for responsive application state
  public rawMaterials = signal<RawMaterial[]>([]);
  public inventoryMovements = signal<InventoryMovement[]>([]);
  public finishedGoods = signal<FinishedGood[]>([]);
  public recipes = signal<RecipeBOM[]>([]);
  public productionOrders = signal<ProductionOrder[]>([]);
  public customers = signal<Customer[]>([]);
  public salesOrders = signal<SalesOrder[]>([]);
  public deliveryNotes = signal<DeliveryNote[]>([]);
  public employees = signal<Employee[]>([]);
  public payrollWeeks = signal<PayrollWeek[]>([]);
  public expenses = signal<Expense[]>([]);
  public costStructure = signal<CostStructureAnalysis | null>(null);
  public fiscalSettings = signal<FiscalSettings | null>(null);
  public dashboardData = signal<any | null>(null);
  public exchangeRates = signal<DailyExchangeRates | null>(null);
  public auditLogs = signal<AuditLogEntry[]>([]);

  // Computed signals for Dashboard Analytics & Recharts visualizations
  public weeklySales = computed<WeeklySalesStat[]>(() => {
    return this.dashboardData()?.weeklySales || [];
  });

  public inventoryTurnover = computed<InventoryTurnoverStat[]>(() => {
    return this.dashboardData()?.inventoryTurnover || [];
  });

  public inventoryTurnoverCategories = computed<InventoryTurnoverCategory[]>(() => {
    return this.dashboardData()?.inventoryTurnoverCategories || [];
  });

  public getWeeklySales(): WeeklySalesStat[] {
    return this.weeklySales();
  }

  public getInventoryTurnover(): InventoryTurnoverStat[] {
    return this.inventoryTurnover();
  }

  public getInventoryTurnoverCategories(): InventoryTurnoverCategory[] {
    return this.inventoryTurnoverCategories();
  }

  // --- INVENTORY MINIMUM STOCK & PRODUCTION SUFFICIENCY ALERTS ---
  public productionStockAlerts = computed<ProductionStockAlert[]>(() => {
    const materials = this.rawMaterials();
    const activeOrders = this.productionOrders().filter(
      o => o.status === 'planificada' || o.status === 'en_proceso'
    );
    const recipes = this.recipes();
    const rate = this.exchangeRates()?.currentUsd || 48.35;

    // Aggregate required material quantities for all active/planned production orders
    const requiredByOrders = new Map<string, { totalRequired: number; orders: any[] }>();

    for (const order of activeOrders) {
      const rec = recipes.find(r => r.id === order.recipeId);
      if (rec) {
        for (const item of rec.items) {
          const reqQty = Number((item.quantity * order.batchCount).toFixed(2));
          const existing = requiredByOrders.get(item.materialId) || { totalRequired: 0, orders: [] };
          existing.totalRequired = Number((existing.totalRequired + reqQty).toFixed(2));
          existing.orders.push({
            orderId: order.id,
            orderNumber: order.orderNumber,
            recipeName: order.recipeName || rec.name,
            required: reqQty,
            batchCount: order.batchCount,
            status: order.status,
          });
          requiredByOrders.set(item.materialId, existing);
        }
      }
    }

    const alerts: ProductionStockAlert[] = [];

    for (const mat of materials) {
      const orderReq = requiredByOrders.get(mat.id);
      const reqForOrders = orderReq ? orderReq.totalRequired : 0;
      const isBelowMin = mat.currentStock <= mat.minStock;
      const isInsufficientForOrders = reqForOrders > 0 && mat.currentStock < reqForOrders;
      const isNearMin = !isBelowMin && mat.currentStock <= mat.minStock * 1.25;

      // Find all recipes that use this material to calculate production capacity
      const affectedRecipes = recipes
        .filter(r => r.items.some(it => it.materialId === mat.id))
        .map(r => {
          const item = r.items.find(it => it.materialId === mat.id)!;
          const maxBatches = item.quantity > 0 ? Math.floor(mat.currentStock / item.quantity) : 999;
          return {
            recipeId: r.id,
            recipeName: r.name,
            quantityPerBatch: item.quantity,
            maxBatchesPossible: maxBatches,
          };
        });

      // If it's insufficient for production OR below minimum stock OR near min stock with orders:
      if (isInsufficientForOrders || isBelowMin || (isNearMin && reqForOrders > 0)) {
        const shortage = Math.max(0, reqForOrders - mat.currentStock);
        const minShortage = Math.max(0, mat.minStock - mat.currentStock);
        const replenishQty = Math.max(shortage, minShortage, mat.minStock);

        const estCostUsd = Number((replenishQty * mat.costPerUnit).toFixed(2));
        const estCostBs = Number((estCostUsd * rate).toFixed(2));

        let severity: 'critical' | 'warning' | 'caution' = 'caution';
        let recommendation = '';

        if (isInsufficientForOrders) {
          severity = 'critical';
          recommendation = `¡BLOQUEO DE PRODUCCIÓN! Stock insuficiente para completar ${orderReq?.orders.map(o => o.orderNumber).join(', ')}. Faltan ${shortage.toFixed(1)} ${mat.unit} urgentemente.`;
        } else if (isBelowMin) {
          severity = 'warning';
          recommendation = `Stock por debajo del mínimo de seguridad (${mat.currentStock} ${mat.unit} <= ${mat.minStock} ${mat.unit}). Emitir orden de reposición.`;
        } else {
          severity = 'caution';
          recommendation = `Stock cercano al nivel crítico con órdenes planificadas en cola. Supervisar consumo de ${mat.name}.`;
        }

        alerts.push({
          id: `alert-${mat.id}`,
          materialId: mat.id,
          materialCode: mat.code,
          materialName: mat.name,
          category: mat.category,
          unit: mat.unit,
          currentStock: mat.currentStock,
          minStock: mat.minStock,
          isBelowMinStock: isBelowMin,
          requiredForActiveOrders: reqForOrders,
          insufficientForProduction: isInsufficientForOrders,
          productionShortage: shortage,
          severity,
          affectedOrders: orderReq ? orderReq.orders : [],
          affectedRecipes,
          estimatedReplenishCostUsd: estCostUsd,
          estimatedReplenishCostBs: estCostBs,
          recommendation,
        });
      }
    }

    // Sort: critical first, then warning, then caution
    return alerts.sort((a, b) => {
      const score = (s: string) => (s === 'critical' ? 3 : s === 'warning' ? 2 : 1);
      return score(b.severity) - score(a.severity);
    });
  });

  public checkRecipeFeasibility(recipeId: string, batchCount = 1): RecipeFeasibilityResult {
    const rec = this.recipes().find(r => r.id === recipeId);
    const materials = this.rawMaterials();
    const rate = this.exchangeRates()?.currentUsd || 48.35;

    if (!rec) {
      return {
        recipeId,
        recipeName: 'Receta no encontrada',
        batchCount,
        targetUnits: 0,
        canProduce: false,
        totalMissingCount: 0,
        missingMaterials: [],
        sufficientMaterials: [],
      };
    }

    const missingMaterials: RecipeFeasibilityResult['missingMaterials'] = [];
    const sufficientMaterials: RecipeFeasibilityResult['sufficientMaterials'] = [];

    for (const item of rec.items) {
      const mat = materials.find(m => m.id === item.materialId);
      const req = Number((item.quantity * batchCount).toFixed(2));
      const avail = mat ? mat.currentStock : 0;

      if (avail < req) {
        const deficit = Number((req - avail).toFixed(2));
        const unitCost = mat ? mat.costPerUnit : item.estimatedCost / item.quantity;
        const costUsd = Number((deficit * unitCost).toFixed(2));
        missingMaterials.push({
          materialId: item.materialId,
          materialName: item.materialName,
          category: mat ? mat.category : 'aditivo',
          unit: item.unit,
          required: req,
          available: avail,
          deficit,
          estimatedCostToCoverUsd: costUsd,
          estimatedCostToCoverBs: Number((costUsd * rate).toFixed(2)),
        });
      } else {
        sufficientMaterials.push({
          materialId: item.materialId,
          materialName: item.materialName,
          unit: item.unit,
          required: req,
          available: avail,
          remainingAfter: Number((avail - req).toFixed(2)),
        });
      }
    }

    return {
      recipeId: rec.id,
      recipeName: rec.name,
      batchCount,
      targetUnits: rec.batchSizeUnits * batchCount,
      canProduce: missingMaterials.length === 0,
      totalMissingCount: missingMaterials.length,
      missingMaterials,
      sufficientMaterials,
    };
  }

  public notifyStockAlert(alert: ProductionStockAlert) {
    if (alert.insufficientForProduction) {
      this.showToast(
        `🚨 ¡ALERTA CRÍTICA DE PRODUCCIÓN! ${alert.materialName}: disponible ${alert.currentStock} ${alert.unit}, faltan ${alert.productionShortage.toFixed(1)} ${alert.unit} para completar órdenes activas.`,
        'error'
      );
    } else if (alert.isBelowMinStock) {
      this.showToast(
        `⚠️ Alerta Stock Mínimo: ${alert.materialName} está en ${alert.currentStock} ${alert.unit} (Mínimo: ${alert.minStock} ${alert.unit}). Reposición recomendada.`,
        'info'
      );
    }
  }

  public async quickRestockMaterial(materialId: string, quantityToAdd: number) {
    const mat = this.rawMaterials().find(m => m.id === materialId);
    if (!mat) return;
    await this.recordMovement({
      materialId: mat.id,
      type: 'entrada',
      quantity: quantityToAdd,
      costPerUnit: mat.costPerUnit,
      referenceDoc: 'Entrada Rápida por Alerta de Producción',
      notes: `Reabastecimiento express desde Centro de Alertas del Dashboard`,
    });
    this.showToast(`Se agregaron ${quantityToAdd} ${mat.unit} de "${mat.name}". Stock actualizado con éxito.`, 'success');
  }

  // Rate Polling Timer Handle
  private ratePollInterval: any = null;

  public isLoading = signal<boolean>(false);
  public isRefreshingRates = signal<boolean>(false);
  public toastMessage = signal<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  constructor() {
    this.startExchangeRatePoller();
  }

  public showToast(text: string, type: 'success' | 'error' | 'info' = 'success') {
    this.toastMessage.set({ text, type });
    setTimeout(() => {
      this.toastMessage.set(null);
    }, 4500);
  }

  /**
   * Poller for Venezuela exchange rate active windows:
   * Window 1: 08:00 AM - 10:00 AM
   * Window 2: 12:30 PM - 03:00 PM
   */
  private startExchangeRatePoller() {
    if (typeof window === 'undefined') return;

    // Check every 60 seconds
    this.ratePollInterval = setInterval(async () => {
      const rates = this.exchangeRates();
      // If in active window or null, fetch updates
      if (!rates || rates.isInActiveWindow) {
        await this.refreshExchangeRates(false);
      }
    }, 60000);
  }

  // --- REFRESH ALL DATA ---
  public async refreshAllData() {
    this.isLoading.set(true);
    try {
      const [
        materials,
        movements,
        fGoods,
        recs,
        pOrders,
        custs,
        sOrders,
        dNotes,
        staff,
        weeks,
        expensesList,
        costing,
        fiscal,
        dash,
        rates,
        audit,
      ] = await Promise.all([
        firstValueFrom(this.http.get<RawMaterial[]>('/api/inventory/raw-materials')),
        firstValueFrom(this.http.get<InventoryMovement[]>('/api/inventory/movements')),
        firstValueFrom(this.http.get<FinishedGood[]>('/api/inventory/finished-goods')),
        firstValueFrom(this.http.get<RecipeBOM[]>('/api/recipes')),
        firstValueFrom(this.http.get<ProductionOrder[]>('/api/production-orders')),
        firstValueFrom(this.http.get<Customer[]>('/api/sales/customers')),
        firstValueFrom(this.http.get<SalesOrder[]>('/api/sales/orders')),
        firstValueFrom(this.http.get<DeliveryNote[]>('/api/sales/delivery-notes')),
        firstValueFrom(this.http.get<Employee[]>('/api/payroll/employees')),
        firstValueFrom(this.http.get<PayrollWeek[]>('/api/payroll/weeks')),
        firstValueFrom(this.http.get<Expense[]>('/api/expenses')).catch(() => []),
        firstValueFrom(this.http.get<CostStructureAnalysis>('/api/costing/summary')),
        firstValueFrom(this.http.get<FiscalSettings>('/api/fiscal-settings')),
        firstValueFrom(this.http.get<any>('/api/reports/dashboard')),
        firstValueFrom(this.http.get<DailyExchangeRates>('/api/exchange-rates')).catch(() => null),
        firstValueFrom(this.http.get<AuditLogEntry[]>('/api/audit-logs')).catch(() => []),
      ]);

      this.rawMaterials.set(materials);
      this.inventoryMovements.set(movements);
      this.finishedGoods.set(fGoods);
      this.recipes.set(recs);
      this.productionOrders.set(pOrders);
      this.customers.set(custs);
      this.salesOrders.set(sOrders);
      this.deliveryNotes.set(dNotes);
      this.employees.set(staff);
      this.payrollWeeks.set(weeks);
      this.expenses.set(expensesList || []);
      this.costStructure.set(costing);
      this.fiscalSettings.set(fiscal);
      this.dashboardData.set(dash);
      if (rates) {
        this.exchangeRates.set(rates);
      }
      if (audit && Array.isArray(audit)) {
        this.auditLogs.set(audit);
      }
    } catch (err: unknown) {
      console.warn('Network sync notice - ensuring local store state:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  // --- EXCHANGE RATES METHODS ---
  public async refreshExchangeRates(userTriggered = true) {
    if (this.isRefreshingRates()) return;
    this.isRefreshingRates.set(true);
    try {
      const res = await firstValueFrom(this.http.post<DailyExchangeRates>('/api/exchange-rates/refresh', {}));
      this.exchangeRates.set(res);
      if (userTriggered) {
        this.showToast(
          `Tasas actualizadas: USD ${formatVeCurrency(res.currentUsd, 'Bs.')} · USDT ${formatVeCurrency(res.currentUsdt, 'Bs.')}`,
          'success'
        );
      }
    } catch {
      if (userTriggered) {
        this.showToast('No se pudo sincronizar automáticamente. Puedes ingresar la tasa manual.', 'error');
      }
    } finally {
      this.isRefreshingRates.set(false);
    }
  }

  public async updateExchangeRateManual(usdRate: number, usdtRate: number, notes?: string) {
    try {
      const res = await firstValueFrom(
        this.http.post<DailyExchangeRates>('/api/exchange-rates/update', {
          usdRate,
          usdtRate,
          source: 'Ajuste Manual en Planta',
          notes: notes || 'Ajuste manual por operador',
        })
      );
      this.exchangeRates.set(res);
      this.showToast(
        `Tasa registrada con éxito: USD ${formatVeCurrency(usdRate, 'Bs.')} · USDT ${formatVeCurrency(usdtRate, 'Bs.')}`,
        'success'
      );
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar tasa';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  // --- RAW MATERIALS ---
  public async addRawMaterial(mat: Omit<RawMaterial, 'id'>) {
    try {
      const res = await firstValueFrom(this.http.post<RawMaterial>('/api/inventory/raw-materials', mat));
      this.rawMaterials.update(m => [...m, res]);
      this.showToast(`Materia prima "${res.name}" registrada con éxito.`);
      await this.refreshAllData();
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar insumo';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  public async recordMovement(data: {
    materialId: string;
    type: 'entrada' | 'salida_produccion' | 'ajuste_merma';
    quantity: number;
    costPerUnit: number;
    exchangeRateUsed?: number;
    referenceDoc?: string;
    notes?: string;
  }) {
    try {
      const mat = this.rawMaterials().find(m => m.id === data.materialId);
      const rate = data.exchangeRateUsed || this.exchangeRates()?.currentUsd || 48.35;
      const totalCost = Number((data.quantity * data.costPerUnit).toFixed(2));
      const payload = {
        ...data,
        materialName: mat ? mat.name : 'Insumo',
        totalCost,
        exchangeRateUsed: rate,
        costPerUnitBs: Number((data.costPerUnit * rate).toFixed(2)),
        totalCostBs: Number((totalCost * rate).toFixed(2)),
        date: new Date().toISOString().slice(0, 10),
        performedBy: this.currentRole() === 'admin' ? 'Administrador' : 'Operador de Planta',
      };
      await firstValueFrom(this.http.post('/api/inventory/movements', payload));

      // Record Audit Log for Inventory Movement
      const actionTitle = data.type === 'entrada'
        ? `Entrada de Materia Prima: ${mat ? mat.name : 'Insumo'}`
        : (data.type === 'salida_produccion'
          ? `Salida a Pailas de Producción: ${mat ? mat.name : 'Insumo'}`
          : `Ajuste / Merma de Inventario: ${mat ? mat.name : 'Insumo'}`);

      await this.recordAuditLog({
        module: 'inventario',
        actionType: data.type === 'entrada'
          ? 'entrada_materia_prima'
          : (data.type === 'salida_produccion' ? 'salida_produccion' : 'ajuste_merma'),
        title: actionTitle,
        description: `${data.quantity} ${mat?.unit || 'uds'} (${data.type === 'entrada' ? 'Recepción' : 'Consumo'}). Ref: ${data.referenceDoc || 'S/N'}. ${data.notes || ''}`.trim(),
        severity: data.type === 'ajuste_merma' ? 'warning' : 'info',
        details: {
          targetId: data.materialId,
          itemName: mat ? mat.name : undefined,
          quantity: data.quantity,
          unit: mat ? mat.unit : undefined,
          costUsd: totalCost,
          referenceDoc: data.referenceDoc,
          operatorNotes: data.notes,
        },
      });

      this.showToast(`Movimiento de ${data.quantity} ${mat?.unit || 'uds'} registrado (Tasa: Bs. ${rate.toFixed(2).replace('.', ',')}).`);
      await this.refreshAllData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar movimiento';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  // --- AUDIT LOGGING ---
  public async recordAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'userId' | 'userName' | 'userRole'>) {
    const user = this.currentUser();
    const payload: Omit<AuditLogEntry, 'id'> = {
      ...entry,
      timestamp: new Date().toISOString(),
      userId: user.id,
      userName: user.fullName,
      userRole: user.roleName,
    };
    try {
      const res = await firstValueFrom(this.http.post<AuditLogEntry>('/api/audit-logs', payload));
      this.auditLogs.update(logs => [res, ...logs]);
      return res;
    } catch {
      const fallback: AuditLogEntry = {
        ...payload,
        id: 'aud-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      };
      this.auditLogs.update(logs => [fallback, ...logs]);
      return fallback;
    }
  }

  // --- RECIPES ---
  public async addRecipe(recipe: Omit<RecipeBOM, 'id'>) {
    try {
      const res = await firstValueFrom(this.http.post<RecipeBOM>('/api/recipes', recipe));
      this.recipes.update(r => [...r, res]);

      // Record Audit Log for BOM Recipe
      await this.recordAuditLog({
        module: 'produccion',
        actionType: 'receta_bom_creada',
        title: `Nueva Formulación BOM: ${res.name}`,
        description: `Registrada receta para sabor "${res.flavor}" (${res.batchSizeUnits} unidades por tanda estándar).`,
        severity: 'info',
        details: {
          targetId: res.id,
          targetCode: res.code,
          itemName: res.name,
          quantity: res.batchSizeUnits,
        },
      });

      this.showToast(`Receta "${res.name}" guardada con éxito.`);
      await this.refreshAllData();
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar receta';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  // --- PRODUCTION ORDERS (MTO) ---
  public async createProductionOrder(data: {
    recipeId: string;
    batchCount: number;
    salesOrderId?: string;
    lotNumber?: string;
    operatorNotes?: string;
  }) {
    try {
      const res = await firstValueFrom<{ order: ProductionOrder; missingMaterials: any[] }>(
        this.http.post<{ order: ProductionOrder; missingMaterials: any[] }>('/api/production-orders', data)
      );

      // Record Audit Log for Production Order Created
      await this.recordAuditLog({
        module: 'produccion',
        actionType: 'orden_produccion_creada',
        title: `Nueva Orden de Fabricación: ${res.order.orderNumber}`,
        description: `Lanzamiento de producción de ${res.order.targetUnits} unidades de ${res.order.recipeName}. Lote asignado: ${res.order.lotNumber}.`,
        severity: res.missingMaterials && res.missingMaterials.length > 0 ? 'warning' : 'info',
        details: {
          targetId: res.order.id,
          targetCode: res.order.orderNumber,
          itemName: res.order.recipeName,
          quantity: res.order.targetUnits,
          lotNumber: res.order.lotNumber,
          salesOrderId: data.salesOrderId,
          operatorNotes: data.operatorNotes,
        },
      });

      if (res.missingMaterials && res.missingMaterials.length > 0) {
        const missingNames = res.missingMaterials.map(m => `${m.name} (faltan ${(m.required - m.available).toFixed(1)} ${m.unit})`).join(', ');
        this.showToast(`¡Atención! Insumos insuficientes: ${missingNames}`, 'error');
      } else {
        this.showToast(`Orden ${res.order.orderNumber} creada con lote ${res.order.lotNumber}.`);
      }
      await this.refreshAllData();
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear orden de producción';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  public async processProductionOrder(orderId: string) {
    try {
      const res = await firstValueFrom<{ success: boolean; message: string; order: ProductionOrder }>(
        this.http.post<{ success: boolean; message: string; order: ProductionOrder }>(
          `/api/production-orders/${orderId}/process`,
          {}
        )
      );

      // Record Audit Log for Processed Batch
      await this.recordAuditLog({
        module: 'produccion',
        actionType: 'orden_produccion_procesada',
        title: `Cocción Finalizada & Lote Liberado: ${res.order.orderNumber}`,
        description: `Proceso térmico en marmitas finalizado para ${res.order.targetUnits} unidades. Lote ${res.order.lotNumber} verificado conforme a parámetros HACCP.`,
        severity: 'success',
        details: {
          targetId: res.order.id,
          targetCode: res.order.orderNumber,
          itemName: res.order.recipeName,
          quantity: res.order.targetUnits,
          lotNumber: res.order.lotNumber,
          brix: 65.5,
          wasteKg: 1.2,
          operatorNotes: 'Brix y sellado al vacío verificados. Listo para etiquetado.',
        },
      });

      this.showToast(res.message, 'success');
      await this.refreshAllData();
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al procesar orden';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  // --- SALES ORDERS & MTO TRIGGER ---
  public async addCustomer(cust: Omit<Customer, 'id'>) {
    try {
      const res = await firstValueFrom(this.http.post<Customer>('/api/sales/customers', cust));
      this.customers.update(c => [...c, res]);
      this.showToast(`Cliente "${res.businessName}" registrado.`);
      await this.refreshAllData();
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear cliente';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  public async addSalesOrder(data: any) {
    try {
      const res = await firstValueFrom(this.http.post<SalesOrder>('/api/sales/orders', data));
      this.showToast(`Pedido ${res.orderNumber} creado para ${res.customerName}.`);
      await this.refreshAllData();
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar pedido';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  public async triggerMTOProduction(salesOrderId: string) {
    try {
      const res = await firstValueFrom<{ order: ProductionOrder; missingMaterials: any[] }>(
        this.http.post<{ order: ProductionOrder; missingMaterials: any[] }>(
          `/api/sales/orders/${salesOrderId}/create-production-order`,
          {}
        )
      );
      this.showToast(`Orden de Producción Make-to-Order ${res.order.orderNumber} generada.`);
      await this.refreshAllData();
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al generar OP desde pedido';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  public async generateDeliveryNote(salesOrderId: string, transporter = 'Camión de Distribución Planta') {
    try {
      const res = await firstValueFrom<DeliveryNote>(
        this.http.post<DeliveryNote>(`/api/sales/orders/${salesOrderId}/create-delivery-note`, { transporter })
      );
      this.showToast(`Nota de Entrega ${res.noteNumber} emitida exitosamente.`);
      await this.refreshAllData();
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al emitir nota de entrega';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  // --- PAYROLL & INACTIVE WEEKS ---
  public async addPayrollWeek(weekData: Omit<PayrollWeek, 'id'>) {
    try {
      const res = await firstValueFrom<PayrollWeek>(this.http.post<PayrollWeek>('/api/payroll/weeks', weekData));
      if (!res.isActiveProduction) {
        this.showToast(
          `Semana Inactiva #${res.weekNumber} registrada: $${res.fixedAbsorptionCost} computados como costo fijo no absorbido.`,
          'info'
        );
      } else {
        this.showToast(`Nómina Semana #${res.weekNumber} registrada ($${res.totalPayrollPaid}).`);
      }
      await this.refreshAllData();
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar nómina';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  public async addEmployee(emp: Omit<Employee, 'id'>) {
    try {
      const res = await firstValueFrom<Employee>(this.http.post<Employee>('/api/payroll/employees', emp));
      this.showToast(`Personal "${res.fullName}" registrado.`);
      await this.refreshAllData();
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar personal';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  // --- EXPENSES & OPERATING OUTFLOWS ---
  public async addExpense(data: Omit<Expense, 'id' | 'expenseNumber'>) {
    try {
      const res = await firstValueFrom<Expense>(this.http.post<Expense>('/api/expenses', data));
      this.expenses.update(list => [res, ...list]);

      await this.recordAuditLog({
        module: 'gastos',
        actionType: 'gasto_registrado',
        title: `Gasto Registrado: ${res.expenseNumber}`,
        description: `${res.concept} — $${res.amountUsd.toFixed(2)} (${res.categoryLabel}). Beneficiario: ${res.supplierOrBeneficiary}`,
        severity: res.category === 'gastos_personales_socios' ? 'warning' : 'info',
        details: {
          targetId: res.id,
          targetCode: res.expenseNumber,
          itemName: res.concept,
          costUsd: res.amountUsd,
          referenceDoc: res.documentNumber || res.paymentReference,
          operatorNotes: res.notes,
        },
      });

      this.showToast(`Gasto ${res.expenseNumber} registrado exitosamente ($${res.amountUsd.toFixed(2)}).`);
      await this.refreshAllData();
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar gasto';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  public async deleteExpense(id: string) {
    try {
      const exp = this.expenses().find(e => e.id === id);
      await firstValueFrom(this.http.delete(`/api/expenses/${id}`));
      this.expenses.update(list => list.filter(e => e.id !== id));

      await this.recordAuditLog({
        module: 'gastos',
        actionType: 'gasto_eliminado',
        title: `Gasto Eliminado: ${exp ? exp.expenseNumber : id}`,
        description: `Eliminado comprobante de egreso por $${exp ? exp.amountUsd.toFixed(2) : '0.00'} (${exp ? exp.concept : ''})`,
        severity: 'warning',
        details: {
          targetId: id,
          targetCode: exp ? exp.expenseNumber : undefined,
          costUsd: exp ? exp.amountUsd : undefined,
        },
      });

      this.showToast('Gasto eliminado del registro.');
      await this.refreshAllData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al eliminar gasto';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  // --- COSTING SIMULATOR ---
  public async simulateCost(params: {
    directMaterial: number;
    directPackaging: number;
    directLabor: number;
    utilityCost: number;
    inactiveWeeksCount: number;
    targetMarginWholesale: number;
    targetMarginRetail: number;
  }) {
    return firstValueFrom(this.http.post<any>('/api/costing/simulate', params));
  }

  // --- FISCAL CONFIG ---
  public async saveFiscalSettings(settings: Partial<FiscalSettings>) {
    try {
      const res = await firstValueFrom<FiscalSettings>(this.http.put<FiscalSettings>('/api/fiscal-settings', settings));
      this.fiscalSettings.set(res);
      this.showToast('Configuración de Facturación Fiscal guardada.');
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar configuración fiscal';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  // --- RESET DEMO ---
  public async resetDemo() {
    try {
      await firstValueFrom(this.http.post('/api/system/reset', {}));
      this.showToast('Datos del sistema restaurados a los valores de demostración.');
      await this.refreshAllData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al reiniciar datos';
      this.showToast(msg, 'error');
    }
  }
}
