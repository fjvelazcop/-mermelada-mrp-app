import {ChangeDetectionStrategy, Component, inject, signal, computed} from '@angular/core';
import {ReactiveFormsModule, FormGroup, FormControl, Validators} from '@angular/forms';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';
import {RawMaterial, MaterialCategory, UnitOfMeasure} from '../../core/models/erp.models';

@Component({
  selector: 'app-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, ReactiveFormsModule],
  templateUrl: './inventory.html',
})
export class InventoryComponent {
  public api = inject(ErpApiService);

  public selectedCategory = signal<string>('all');
  public isMovementModalOpen = signal<boolean>(false);
  public isNewMaterialModalOpen = signal<boolean>(false);
  public selectedMaterialForMovement = signal<RawMaterial | null>(null);

  // Form for recording Movement (Entrada de compra, merma, salida)
  public movementForm = new FormGroup({
    materialId: new FormControl<string>('', {nonNullable: true, validators: [Validators.required]}),
    type: new FormControl<'entrada' | 'salida_produccion' | 'ajuste_merma'>('entrada', {nonNullable: true, validators: [Validators.required]}),
    quantity: new FormControl<number>(10, {nonNullable: true, validators: [Validators.required, Validators.min(0.01)]}),
    costPerUnit: new FormControl<number>(1.25, {nonNullable: true, validators: [Validators.required, Validators.min(0)]}),
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

  public openMovementModal(mat?: RawMaterial) {
    if (mat) {
      this.selectedMaterialForMovement.set(mat);
      this.movementForm.patchValue({
        materialId: mat.id,
        costPerUnit: mat.costPerUnit,
        quantity: mat.unit === 'g' ? 100 : 10,
        type: 'entrada',
        referenceDoc: 'Factura Compra Insumos #' + Math.floor(Math.random() * 900 + 100),
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
}
