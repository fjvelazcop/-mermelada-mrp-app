/**
 * DatabaseExpertAgent - Specialized agent for database operations.
 * Client-bundle compatible: provides typed access to ERP state and queries.
 */
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
  DailyExchangeRates,
  AuditLogEntry,
  Expense,
} from '../models/erp.models';

import { Injectable } from '@angular/core';

export interface QueryOptions {
  limit?: number;
  offset?: number;
}

@Injectable({ providedIn: 'root' })
export class DatabaseExpertAgent {
  private rawMaterials: RawMaterial[] = [
    {
      id: 'rm-1',
      code: 'MP-FRU-01',
      name: 'Guayaba Roja Criolla (Pulpa fresca)',
      category: 'fruta',
      currentStock: 850,
      minStock: 60,
      unit: 'kg',
      costPerUnit: 1.25,
      supplier: 'Asociación de Fruticultores del Valle',
      lastRestockDate: '2026-10-02',
      notes: 'Calibre seleccionado, maduración óptima Brix 10-12',
    },
    {
      id: 'rm-2',
      code: 'MP-ADI-01',
      name: 'Azúcar Blanca Refinada Estandarizada',
      category: 'aditivo',
      currentStock: 1200,
      minStock: 100,
      unit: 'kg',
      costPerUnit: 0.95,
      supplier: 'Central Azucarero Portuguesa',
      lastRestockDate: '2026-10-01',
    },
    {
      id: 'rm-3',
      code: 'MP-ADI-02',
      name: 'Pectina Cítrica de Alto Metoxilo (HM-105)',
      category: 'aditivo',
      currentStock: 14,
      minStock: 15,
      unit: 'kg',
      costPerUnit: 18.5,
      supplier: 'Ingredientes Industriales Andinos C.A.',
      lastRestockDate: '2026-09-25',
    },
  ];

  private exchangeRates: DailyExchangeRates = {
    currentUsd: 48.35,
    currentUsdt: 53.1,
    lastUpdated: new Date().toISOString(),
    isInActiveWindow: true,
    activeWindowName: 'Mesas Cambiarias & BCV',
    nextScheduledCheck: new Date(Date.now() + 3600000).toISOString(),
    history: [],
  };

  /** Raw materials */
  getRawMaterials(opts?: QueryOptions): RawMaterial[] {
    if (!opts?.limit) return [...this.rawMaterials];
    return this.rawMaterials.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit);
  }

  addRawMaterial(data: any): RawMaterial {
    const mat: RawMaterial = { ...data, id: 'rm-' + Date.now() };
    this.rawMaterials.push(mat);
    return mat;
  }

  updateRawMaterial(id: string, data: any): RawMaterial | null {
    const idx = this.rawMaterials.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    this.rawMaterials[idx] = { ...this.rawMaterials[idx], ...data };
    return this.rawMaterials[idx];
  }

  /** Inventory movements */
  getInventoryMovements(opts?: QueryOptions): InventoryMovement[] {
    void opts;
    return [];
  }

  addInventoryMovement(data: any): any {
    return { ...data, id: 'mov-' + Date.now() };
  }

  /** Finished goods */
  getFinishedGoods(opts?: QueryOptions): FinishedGood[] {
    void opts;
    return [];
  }

  updateFinishedGood(id: string, data: any): any {
    return data;
  }

  /** Recipes / BOM */
  getRecipes(): RecipeBOM[] {
    return [];
  }

  addRecipe(data: any): any {
    return data;
  }

  /** Production orders */
  getProductionOrders(): ProductionOrder[] {
    return [];
  }

  createProductionOrder(data: any): any {
    return data;
  }

  processProductionOrder(id: string): any {
    return { id, status: 'completada' };
  }

  /** Customers */
  getCustomers(): Customer[] {
    return [];
  }

  addCustomer(data: any): any {
    return data;
  }

  /** Sales orders */
  getSalesOrders(): SalesOrder[] {
    return [];
  }

  addSalesOrder(data: any): any {
    return data;
  }

  updateSalesOrderStatus(id: string, status: string): any {
    return { id, status };
  }

  /** Delivery notes */
  getDeliveryNotes(): DeliveryNote[] {
    return [];
  }

  createDeliveryNote(orderId: string, transporter: string): any {
    return { orderId, transporter };
  }

  /** Payroll weeks */
  getPayrollWeeks(): PayrollWeek[] {
    return [];
  }

  addPayrollWeek(data: any): any {
    return data;
  }

  /** Employees */
  getEmployees(): Employee[] {
    return [];
  }

  addEmployee(data: any): any {
    return data;
  }

  /** Fiscal settings */
  getFiscalSettings(): FiscalSettings {
    return {
      enabled: true,
      companyName: 'PulpaCraft C.A.',
      companyTaxId: 'J-50123984-2',
      fiscalAddress: 'Zona Industrial La Hamaca, Galpón 4, Maracay, Aragua',
      companyPhone: '+58 412-0000000',
      companyEmail: 'administracion@pulpacraft.com',
      economicActivity: 'Fabricación de conservas de frutas',
      taxRegime: 'ordinario',
      taxRatePercent: 16.0,
      invoicePrefix: 'FACT-',
      invoiceSerie: 'A',
      nextInvoiceNumber: 104,
      controlPrefix: 'CTRL-',
      nextControlNumber: 104,
      authorizationCode: 'SENIAT-PROV-2026-00918',
      authorizationValidUntil: '',
      branchName: 'Sede principal',
      branchAddress: 'Zona Industrial La Hamaca, Galpón 4, Maracay, Aragua',
      vatWithholdingAgent: false,
      vatWithholdingPercent: 75,
      islrWithholdingAgent: false,
      islrWithholdingPercent: 0,
      specialTaxpayer: false,
      booksFormat: 'xlsx',
      historicalOrdersTreatment: 'revisar',
      printNotes: 'Contribuyente Ordinario del IVA.',
    };
  }

  updateFiscalSettings(data: any): any {
    return data;
  }

  /** Exchange rates */
  getExchangeRates(): DailyExchangeRates {
    return { ...this.exchangeRates };
  }

  updateExchangeRate(data: any): DailyExchangeRates {
    if (data.usdRate) this.exchangeRates.currentUsd = data.usdRate;
    if (data.usdtRate) this.exchangeRates.currentUsdt = data.usdtRate;
    this.exchangeRates.lastUpdated = new Date().toISOString();
    return { ...this.exchangeRates };
  }

  async fetchLiveExchangeRates(): Promise<DailyExchangeRates> {
    return this.getExchangeRates();
  }

  /** Audit logs */
  getAuditLogs(moduleFilter?: string): AuditLogEntry[] {
    void moduleFilter;
    return [];
  }

  addAuditLog(data: any): any {
    return { ...data, id: 'aud-' + Date.now() };
  }

  /** Expenses */
  getExpenses(): Expense[] {
    return [];
  }

  addExpense(data: any): any {
    return { ...data, id: 'gto-' + Date.now() };
  }

  deleteExpense(id: string): boolean {
    void id;
    return true;
  }

  /** Dashboard metrics */
  getDashboardMetrics(): any {
    return {};
  }

  /** Reset demo data */
  reset(): void {
    // Reset state to initial demo data
    this.rawMaterials = [];
  }
}