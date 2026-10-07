import {inject, Injectable, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {
  RawMaterial,
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
} from '../models/erp.models';

@Injectable({
  providedIn: 'root',
})
export class ErpApiService {
  private http = inject(HttpClient);

  // User Role Signal
  public currentRole = signal<UserRole>('admin');

  // Signals for responsive application state
  public rawMaterials = signal<RawMaterial[]>([]);
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

  public isLoading = signal<boolean>(false);
  public toastMessage = signal<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

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

  // --- REFRESH ALL DATA ---
  public async refreshAllData() {
    this.isLoading.set(true);
    try {
      const [
        materials,
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
      ] = await Promise.all([
        firstValueFrom(this.http.get<RawMaterial[]>('/api/inventory/raw-materials')),
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
      ]);

      this.rawMaterials.set(materials);
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
    } catch (err: unknown) {
      console.warn('Network sync notice - ensuring local store state:', err);
    } finally {
      this.isLoading.set(false);
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
    referenceDoc?: string;
    notes?: string;
  }) {
    try {
      const mat = this.rawMaterials().find(m => m.id === data.materialId);
      const payload = {
        ...data,
        materialName: mat ? mat.name : 'Insumo',
        totalCost: Number((data.quantity * data.costPerUnit).toFixed(2)),
        date: new Date().toISOString().slice(0, 10),
        performedBy: this.currentRole() === 'admin' ? 'Administrador' : 'Operador de Planta',
      };
      await firstValueFrom(this.http.post('/api/inventory/movements', payload));
      this.showToast(`Movimiento de ${data.quantity} ${mat?.unit || 'uds'} registrado.`);
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
