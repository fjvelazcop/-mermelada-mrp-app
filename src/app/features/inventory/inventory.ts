import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {RawMaterial, MaterialCategory, UnitOfMeasure} from '../../core/models/erp.models';
import {VeCurrencyPipe, VeNumberPipe, formatVeNumber} from '../../core/pipes/ve-currency.pipe';
import {exportToCsv, exportToExcel, exportToPdf} from '../../core/utils/export.utils';

@Component({
  selector: 'app-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ReactiveFormsModule, VeCurrencyPipe, VeNumberPipe],
  templateUrl: './inventory.html',
})
export class InventoryComponent {
  public api = inject(ErpApiService);

  public selectedCategory = signal<string>('all');
  public isMovementModalOpen = signal<boolean>(false);
  public isNewMaterialModalOpen = signal<boolean>(false);
  public selectedMaterialForMovement = signal<RawMaterial | null>(null);

  // Currency view toggle: 'USD' ($) or 'Bs' (Bolívares)
  public currencyMode = signal<'USD' | 'Bs'>('USD');

  // Form for recording Movement (Entrada de compra, merma, salida)
  public movementForm = new FormGroup({
    materialId: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    type: new FormControl<'entrada' | 'salida_produccion' | 'ajuste_merma'>('entrada', {nonNullable: true, validators: [Validators.required]}),
    quantity: new FormControl<number>(10, {nonNullable: true, validators: [Validators.required, Validators.min(0.01)]}),
    costPerUnit: new FormControl<number>(1.25, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    exchangeRateUsed: new FormControl<number>(48.35, {nonNullable: true, validators: [Validators.required, Validators.min(1)]}),
    referenceDoc: new FormControl<string>('', {nonNullable: true}),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  // Form for New Raw Material
  public newMaterialForm = new FormGroup({
    code: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    name: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    category: new FormControl<MaterialCategory>('fruta', {nonNullable: true, validators: [Validators.required]}),
    currentStock: new FormControl<number>(50, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    minStock: new FormControl<number>(20, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    unit: new FormControl<UnitOfMeasure>('kg', {nonNullable: true, validators: [Validators.required]}),
    costPerUnit: new FormControl<number>(1.00, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
    supplier: new FormControl<string>('', {nonNullable: true}),
    notes: new FormControl<string>('', {nonNullable: true}),
  });

  public filteredMaterials = computed(() => {
    const all = this.api.rawMaterials();
    const cat = this.selectedCategory();
    if (cat === 'all') return all;
    if (cat === 'alertas') return all.filter(m => m.currentStock <= m.minStock);
    return all.filter(m => m.category === cat);
  });

  public finishedGoods = computed(() => this.api.finishedGoods());
  public movements = computed(() => this.api.inventoryMovements());

  public openMovementModal(mat?: RawMaterial) {
    const activeRate = this.api.exchangeRates()?.currentUsd || 48.35;
    if (mat) {
      this.selectedMaterialForMovement.set(mat);
      this.movementForm.patchValue({
        materialId: mat.id,
        costPerUnit: mat.costPerUnit,
        exchangeRateUsed: activeRate,
        quantity: mat.unit === 'g' ? 100 : 10,
        type: 'entrada',
        referenceDoc: 'Factura Compra Insumos #' + Math.floor(Math.random() * 900 + 100),
      });
    } else {
      this.movementForm.patchValue({
        exchangeRateUsed: activeRate,
      });
    }
    this.isMovementModalOpen.set(true);
  }

  public closeMovementModal() {
    this.isMovementModalOpen.set(false);
    this.selectedMaterialForMovement.set(null);
  }

  public async submitMovement() {
    if (this.movementForm.invalid) return;
    const v = this.movementForm.getRawValue();
    await this.api.recordMovement({
      materialId: v.materialId,
      type: v.type,
      quantity: Number(v.quantity),
      costPerUnit: Number(v.costPerUnit),
      exchangeRateUsed: Number(v.exchangeRateUsed),
      referenceDoc: v.referenceDoc,
      notes: v.notes,
    });
    this.closeMovementModal();
  }

  public openNewMaterialModal() {
    this.newMaterialForm.reset({
      code: 'MP-' + Math.floor(Math.random() * 900 + 100),
      category: 'fruta',
      currentStock: 50,
      minStock: 20,
      unit: 'kg',
      costPerUnit: 1.0,
      name: '',
      supplier: '',
      notes: '',
    });
    this.isNewMaterialModalOpen.set(true);
  }

  public closeNewMaterialModal() {
    this.isNewMaterialModalOpen.set(false);
  }

  public async submitNewMaterial() {
    if (this.newMaterialForm.invalid) return;
    const v = this.newMaterialForm.getRawValue();
    await this.api.addRawMaterial({
      code: v.code,
      name: v.name,
      category: v.category,
      currentStock: Number(v.currentStock),
      minStock: Number(v.minStock),
      unit: v.unit,
      costPerUnit: Number(v.costPerUnit),
      supplier: v.supplier,
      lastRestockDate: new Date().toISOString().slice(0, 10),
      notes: v.notes,
    });
    this.closeNewMaterialModal();
  }

  // --- EXPORT FUNCTIONALITY: INVENTORY & RAW MATERIALS ---

  public exportStockCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Código',
      'Insumo / Materia Prima',
      'Categoría',
      'Stock Actual',
      'Stock Mínimo',
      'Unidad',
      `Costo Unitario (${isBs ? 'Bs.' : 'USD'})`,
      `Valoración Total (${isBs ? 'Bs.' : 'USD'})`,
      'Tasa del Día Ref. (Bs./USD)',
      'Proveedor',
    ];

    const rows = this.filteredMaterials().map(m => {
      const unitCost = isBs ? m.costPerUnit * rate : m.costPerUnit;
      const totalVal = unitCost * m.currentStock;
      return [
        m.code,
        m.name,
        m.category,
        formatVeNumber(m.currentStock, m.unit === 'unidades' ? 0 : 2),
        formatVeNumber(m.minStock, m.unit === 'unidades' ? 0 : 2),
        m.unit,
        formatVeNumber(unitCost, 2),
        formatVeNumber(totalVal, 2),
        formatVeNumber(rate, 2),
        m.supplier || 'N/A',
      ];
    });

    exportToCsv(`Inventario_Materia_Prima_${this.currencyMode()}_${new Date().toISOString().slice(0, 10)}`, headers, rows);
  }

  public exportStockExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Código',
      'Insumo / Materia Prima',
      'Categoría',
      'Stock Actual',
      'Stock Mínimo',
      'Unidad',
      `Costo Unitario (${isBs ? 'Bs.' : 'USD'})`,
      `Valoración Total (${isBs ? 'Bs.' : 'USD'})`,
      'Tasa Ref. (Bs.)',
      'Proveedor',
    ];

    const rows = this.filteredMaterials().map(m => {
      const unitCost = isBs ? m.costPerUnit * rate : m.costPerUnit;
      const totalVal = unitCost * m.currentStock;
      return [
        m.code,
        m.name,
        m.category,
        formatVeNumber(m.currentStock, m.unit === 'unidades' ? 0 : 2),
        formatVeNumber(m.minStock, m.unit === 'unidades' ? 0 : 2),
        m.unit,
        formatVeNumber(unitCost, 2),
        formatVeNumber(totalVal, 2),
        formatVeNumber(rate, 2),
        m.supplier || 'N/A',
      ];
    });

    exportToExcel(
      `Inventario_Materia_Prima_${this.currencyMode()}_${new Date().toISOString().slice(0, 10)}`,
      'Inventario Insumos',
      headers,
      rows,
      {
        tasaCambio: `Bs. ${formatVeNumber(rate, 2)} por USD`,
        moneda: isBs ? 'Bolívares (Bs.)' : 'Dólares Estadounidenses (USD)',
      }
    );
  }

  public exportStockPdf() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Código',
      'Insumo',
      'Cat.',
      'Stock',
      'Mín.',
      'Unidad',
      `Costo (${isBs ? 'Bs.' : '$'})`,
      `Total (${isBs ? 'Bs.' : '$'})`,
    ];

    let grandTotal = 0;
    const rows = this.filteredMaterials().map(m => {
      const unitCost = isBs ? m.costPerUnit * rate : m.costPerUnit;
      const totalVal = unitCost * m.currentStock;
      grandTotal += totalVal;
      return [
        m.code,
        m.name,
        m.category,
        formatVeNumber(m.currentStock, m.unit === 'unidades' ? 0 : 2),
        formatVeNumber(m.minStock, m.unit === 'unidades' ? 0 : 2),
        m.unit,
        `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(unitCost, 2)}`,
        `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(totalVal, 2)}`,
      ];
    });

    exportToPdf({
      title: 'Reporte Oficial de Inventario y Materia Prima',
      subtitle: `Valoración consolidada en ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'}`,
      exchangeRateUsed: rate,
      currencyLabel: isBs ? 'Bolívares (Bs.)' : 'Dólares Americanos (USD)',
      headers,
      rows,
      totals: [
        {
          label: `Valoración Total de Insumos (${isBs ? 'Bs.' : 'USD'})`,
          value: `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(grandTotal, 2)}`,
        },
      ],
      notes: `Reporte emitido conforme a la tasa oficial del día de Bs. ${formatVeNumber(rate, 2)}. Separador decimal con coma (,) y miles con punto (.).`,
    });
  }

  // --- EXPORT MOVEMENTS & PURCHASES ---

  public exportMovementsCsv() {
    const isBs = this.currencyMode() === 'Bs';
    const headers = [
      'Fecha',
      'Insumo',
      'Tipo de Operación',
      'Cantidad',
      `Costo Unitario (${isBs ? 'Bs.' : 'USD'})`,
      `Monto Total (${isBs ? 'Bs.' : 'USD'})`,
      'Tasa del Día Aplicada (Bs./USD)',
      'Documento / Referencia',
      'Responsable',
    ];

    const rows = this.movements().map(m => {
      const rate = m.exchangeRateUsed || this.api.exchangeRates()?.currentUsd || 48.35;
      const unitCost = isBs ? (m.costPerUnitBs || m.costPerUnit * rate) : m.costPerUnit;
      const totalCost = isBs ? (m.totalCostBs || m.totalCost * rate) : m.totalCost;
      return [
        m.date,
        m.materialName,
        m.type === 'entrada' ? 'Compra / Entrada' : m.type === 'salida_produccion' ? 'Consumo Cocción' : 'Ajuste / Merma',
        formatVeNumber(m.quantity, 2),
        formatVeNumber(unitCost, 2),
        formatVeNumber(totalCost, 2),
        formatVeNumber(rate, 2),
        m.referenceDoc || 'S/R',
        m.performedBy,
      ];
    });

    exportToCsv(`Compras_Movimientos_${this.currencyMode()}_${new Date().toISOString().slice(0, 10)}`, headers, rows);
  }

  public exportMovementsExcel() {
    const isBs = this.currencyMode() === 'Bs';
    const headers = [
      'Fecha',
      'Insumo / Materia Prima',
      'Tipo de Operación',
      'Cantidad',
      `Costo Unitario (${isBs ? 'Bs.' : 'USD'})`,
      `Monto Total (${isBs ? 'Bs.' : 'USD'})`,
      'Tasa del Día (Bs./USD)',
      'Documento de Referencia',
      'Responsable',
    ];

    const rows = this.movements().map(m => {
      const rate = m.exchangeRateUsed || this.api.exchangeRates()?.currentUsd || 48.35;
      const unitCost = isBs ? (m.costPerUnitBs || m.costPerUnit * rate) : m.costPerUnit;
      const totalCost = isBs ? (m.totalCostBs || m.totalCost * rate) : m.totalCost;
      return [
        m.date,
        m.materialName,
        m.type === 'entrada' ? 'Compra / Entrada' : m.type === 'salida_produccion' ? 'Consumo Cocción' : 'Ajuste / Merma',
        formatVeNumber(m.quantity, 2),
        formatVeNumber(unitCost, 2),
        formatVeNumber(totalCost, 2),
        formatVeNumber(rate, 2),
        m.referenceDoc || 'S/R',
        m.performedBy,
      ];
    });

    exportToExcel(
      `Compras_Movimientos_${this.currencyMode()}_${new Date().toISOString().slice(0, 10)}`,
      'Historial de Movimientos',
      headers,
      rows,
      {
        moneda: isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)',
        tasaCambio: `Tasa media: Bs. ${formatVeNumber(this.api.exchangeRates()?.currentUsd || 48.35, 2)}`,
      }
    );
  }

  public exportMovementsPdf() {
    const isBs = this.currencyMode() === 'Bs';
    const rate = this.api.exchangeRates()?.currentUsd || 48.35;
    const headers = [
      'Fecha',
      'Insumo',
      'Tipo',
      'Cantidad',
      `Unitario (${isBs ? 'Bs.' : '$'})`,
      `Total (${isBs ? 'Bs.' : '$'})`,
      'Tasa (Bs.)',
      'Documento',
    ];

    let totalDesembolsos = 0;
    const rows = this.movements().map(m => {
      const itemRate = m.exchangeRateUsed || rate;
      const unitCost = isBs ? (m.costPerUnitBs || m.costPerUnit * itemRate) : m.costPerUnit;
      const totalCost = isBs ? (m.totalCostBs || m.totalCost * itemRate) : m.totalCost;
      if (m.type === 'entrada') {
        totalDesembolsos += totalCost;
      }
      return [
        m.date,
        m.materialName,
        m.type === 'entrada' ? 'Compra' : m.type === 'salida_produccion' ? 'Cocción' : 'Merma',
        formatVeNumber(m.quantity, 2),
        `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(unitCost, 2)}`,
        `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(totalCost, 2)}`,
        formatVeNumber(itemRate, 2),
        m.referenceDoc || '-',
      ];
    });

    exportToPdf({
      title: 'Reporte de Compras y Movimientos de Inventario',
      subtitle: `Registro histórico de compras y consumos expresado en ${isBs ? 'Bolívares (Bs.)' : 'Dólares (USD)'}`,
      exchangeRateUsed: rate,
      currencyLabel: isBs ? 'Bolívares (Bs.)' : 'Dólares Americanos (USD)',
      headers,
      rows,
      totals: [
        {
          label: `Total en Compras de Insumos (${isBs ? 'Bs.' : 'USD'})`,
          value: `${isBs ? 'Bs. ' : '$ '}${formatVeNumber(totalDesembolsos, 2)}`,
        },
      ],
      notes: 'Cada operación registra fielmente la tasa de cambio del día en que se ejecutó la compra o despacho de almacén.',
    });
  }
}
