import {ChangeDetectionStrategy, Component, inject, computed} from '@angular/core';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from '../../core/services/erp-api.service';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule],
  templateUrl: './dashboard.html',
})
export class DashboardComponent {
  public api = inject(ErpApiService);
  public readonly Math = Math;

  public metrics = computed(() => this.api.dashboardData());
  public costData = computed(() => this.api.costStructure());
  public rawMaterials = computed(() => this.api.rawMaterials());
  public salesOrders = computed(() => this.api.salesOrders());
  public productionOrders = computed(() => this.api.productionOrders());

  public lowStockCount = computed(() => {
    return this.rawMaterials().filter(m => m.currentStock <= m.minStock).length;
  });

  public pendingDeliveriesCount = computed(() => {
    return this.salesOrders().filter(s => s.status === 'listo_despacho' || s.status === 'en_produccion').length;
  });

  public activeBatchesCount = computed(() => {
    return this.productionOrders().filter(p => p.status === 'en_proceso' || p.status === 'planificada').length;
  });
}
