/**
 * DatabaseExpertAgent - Specialized agent for database operations.
 * Wraps the ERP database instance to provide typed, safe queries
 * and operations used by other agents or the API layer.
 *
 * In a production system this agent would handle connection pooling,
 * migrations, and ORM mapping. For now it delegates to the existing
 * dbInstance singleton.
 */
import { dbInstance } from '../../server/erp-database';

export interface QueryOptions {
  limit?: number;
  offset?: number;
}

export class DatabaseExpertAgent {
  /** Raw materials */
  getRawMaterials(opts?: QueryOptions) {
    const all = dbInstance.getRawMaterials();
    if (!opts?.limit) return all;
    return all.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit!);
  }

  addRawMaterial(data: any) {
    return dbInstance.addRawMaterial(data);
  }

  updateRawMaterial(id: string, data: any) {
    return dbInstance.updateRawMaterial(id, data);
  }

  /** Inventory movements */
  getInventoryMovements(opts?: QueryOptions) {
    const all = dbInstance.getMovements();
    if (!opts?.limit) return all;
    return all.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit!);
  }

  addInventoryMovement(data: any) {
    return dbInstance.addInventoryMovement(data);
  }

  /** Finished goods */
  getFinishedGoods(opts?: QueryOptions) {
    const all = dbInstance.getFinishedGoods();
    if (!opts?.limit) return all;
    return all.slice(opts.offset ?? 0, (opts.offset ?? 0) + opts.limit!);
  }

  updateFinishedGood(id: string, data: any) {
    return dbInstance.updateFinishedGood(id, data);
  }

  /** Recipes / BOM */
  getRecipes() {
    return dbInstance.getRecipes();
  }

  addRecipe(data: any) {
    return dbInstance.addRecipe(data);
  }

  /** Production orders */
  getProductionOrders() {
    return dbInstance.getProductionOrders();
  }

  createProductionOrder(data: any) {
    return dbInstance.createProductionOrder(data);
  }

  processProductionOrder(id: string) {
    return dbInstance.processProductionOrder(id);
  }

  /** Customers */
  getCustomers() {
    return dbInstance.getCustomers();
  }

  addCustomer(data: any) {
    return dbInstance.addCustomer(data);
  }

  /** Sales orders */
  getSalesOrders() {
    return dbInstance.getSalesOrders();
  }

  addSalesOrder(data: any) {
    return dbInstance.addSalesOrder(data);
  }

  updateSalesOrderStatus(id: string, status: string) {
    return dbInstance.updateSalesOrderStatus(id, status);
  }

  /** Delivery notes */
  getDeliveryNotes() {
    return dbInstance.getDeliveryNotes();
  }

  createDeliveryNote(orderId: string, transporter: string) {
    return dbInstance.createDeliveryNote(orderId, transporter);
  }

  /** Payroll weeks */
  getPayrollWeeks() {
    return dbInstance.getPayrollWeeks();
  }

  addPayrollWeek(data: any) {
    return dbInstance.addPayrollWeek(data);
  }

  /** Employees */
  getEmployees() {
    return dbInstance.getEmployees();
  }

  addEmployee(data: any) {
    return dbInstance.addEmployee(data);
  }

  /** Fiscal settings */
  getFiscalSettings() {
    return dbInstance.getFiscalSettings();
  }

  updateFiscalSettings(data: any) {
    return dbInstance.updateFiscalSettings(data);
  }

  /** Exchange rates */
  getExchangeRates() {
    return dbInstance.getExchangeRates();
  }

  updateExchangeRate(data: any) {
    return dbInstance.updateExchangeRate(data);
  }

  fetchLiveExchangeRates() {
    return dbInstance.fetchLiveExchangeRates();
  }

  /** Audit logs */
  getAuditLogs(moduleFilter?: string) {
    return dbInstance.getAuditLogs(moduleFilter);
  }

  addAuditLog(data: any) {
    return dbInstance.addAuditLog(data);
  }

  /** Expenses */
  getExpenses() {
    return dbInstance.getExpenses();
  }

  addExpense(data: any) {
    return dbInstance.addExpense(data);
  }

  deleteExpense(id: string) {
    return dbInstance.deleteExpense(id);
  }

  /** Dashboard metrics */
  getDashboardMetrics() {
    return dbInstance.getDashboardMetrics();
  }

  /** Reset demo data */
  reset() {
    dbInstance.reset();
  }
}