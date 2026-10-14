import {ChangeDetectionStrategy, Component, inject, signal, OnInit} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from './core/services/erp-api.service';
import {DashboardComponent} from './features/dashboard/dashboard';
import {InventoryComponent} from './features/inventory/inventory';
import {ProductionComponent} from './features/production/production';
import {CostingComponent} from './features/costing/costing';
import {SalesComponent} from './features/sales/sales';
import {PayrollComponent} from './features/payroll/payroll';
import {ArchitectureDocsComponent} from './features/architecture-docs/architecture-docs';
import {VeCurrencyPipe} from './core/pipes/ve-currency.pipe';

export type MainNavigationTab =
  | 'dashboard'
  | 'inventory'
  | 'production'
  | 'costing'
  | 'sales'
  | 'payroll'
  | 'architecture';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    DashboardComponent,
    InventoryComponent,
    ProductionComponent,
    CostingComponent,
    SalesComponent,
    PayrollComponent,
    ArchitectureDocsComponent,
    VeCurrencyPipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  public api = inject(ErpApiService);

  public currentTab = signal<MainNavigationTab>('dashboard');

  public ngOnInit() {
    this.api.refreshAllData();
  }

  public setTab(tab: MainNavigationTab) {
    this.currentTab.set(tab);
  }

  public toggleUserRole() {
    this.api.toggleRole();
  }

  public resetDemoData() {
    if (confirm('¿Deseas reiniciar los datos del sistema a los valores de demostración de mermelada de guayaba?')) {
      this.api.resetDemo();
    }
  }
}
