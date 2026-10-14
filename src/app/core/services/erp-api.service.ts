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
} from '../models/erp.models';
import {formatVeCurrency} from '../pipes/ve-currency.pipe';

@Injectable({
  providedIn: 'root',
})
export class ErpApiService {
  private http = inject(HttpClient);

  // User Role Signal
  public currentRole = signal<UserRole>('admin');

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
  public costStructure = signal<CostStructureAnalysis | null>(null);
  public fiscalSettings = signal<FiscalSettings | null>(null);
  public dashboardData = signal<any | null>(null);
  public exchangeRates = signal<DailyExchangeRates | null>(null);

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

  public toggleRole() {
    this.currentRole.update(r => (r === 'admin' ? 'operator' : 'admin'));
    this.showToast(
      `Rol cambiado a: ${this.currentRole() === 'admin' ? 'Administrador General' : 'Operador de Planta'}`,
      'info'
    );
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
        costing,
        fiscal,
        dash,
        rates,
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
        firstValueFrom(this.http.get<CostStructureAnalysis>('/api/costing/summary')),
        firstValueFrom(this.http.get<FiscalSettings>('/api/fiscal-settings')),
        firstValueFrom(this.http.get<any>('/api/reports/dashboard')),
        firstValueFrom(this.http.get<DailyExchangeRates>('/api/exchange-rates')).catch(() => null),
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
      this.costStructure.set(costing);
      this.fiscalSettings.set(fiscal);
      this.dashboardData.set(dash);
      if (rates) {
        this.exchangeRates.set(rates);
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
      this.showToast(`Movimiento de ${data.quantity} ${mat?.unit || 'uds'} registrado (Tasa: Bs. ${rate.toFixed(2).replace('.', ',')}).`);
      await this.refreshAllData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar movimiento';
      this.showToast(msg, 'error');
      throw err;
    }
  }

  // --- RECIPES ---
  public async addRecipe(recipe: Omit<RecipeBOM, 'id'>) {
    try {
      const res = await firstValueFrom(this.http.post<RecipeBOM>('/api/recipes', recipe));
      this.recipes.update(r => [...r, res]);
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
