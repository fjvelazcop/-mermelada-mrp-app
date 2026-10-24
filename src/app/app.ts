import {ChangeDetectionStrategy, Component, inject, signal, OnInit, effect} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from './core/services/erp-api.service';
import {DashboardComponent} from './features/dashboard/dashboard';
import {InventoryComponent} from './features/inventory/inventory';
import {ProductionComponent} from './features/production/production';
import {CostingComponent} from './features/costing/costing';
import {SalesComponent} from './features/sales/sales';
import {PayrollComponent} from './features/payroll/payroll';
import {Settings} from './features/settings/settings';
import {ArchitectureDocsComponent} from './features/architecture-docs/architecture-docs';
import {VeCurrencyPipe} from './core/pipes/ve-currency.pipe';

export type MainNavigationTab =
  | 'dashboard'
  | 'inventory'
  | 'production'
  | 'costing'
  | 'sales'
  | 'payroll'
  | 'settings'
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
    Settings,
    ArchitectureDocsComponent,
    VeCurrencyPipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  public api = inject(ErpApiService);

  public currentTab = signal<MainNavigationTab>('dashboard');
  public mobileMenuOpen = signal<boolean>(false);

  constructor() {
    effect(() => {
      const requested = this.api.requestedTab();
      if (requested) {
        this.setTab(requested as MainNavigationTab);
        this.api.requestedTab.set(null);
      }
    });
  }

  public ngOnInit() {
    this.api.refreshAllData();
  }

  public setTab(tab: MainNavigationTab) {
    if (!this.api.canViewModule(tab)) {
      this.api.showToast(`Acceso restringido: Tu rol actual no tiene permisos para el módulo de ${tab}.`, 'error');
      return;
    }
    this.currentTab.set(tab);
    this.mobileMenuOpen.set(false);
    if (typeof window !== 'undefined') {
      window.scrollTo({top: 0, behavior: 'smooth'});
    }
  }

  public onSimulateUser(userId: string) {
    this.api.setActiveUser(userId);
    // If the new role cannot view the active tab, fallback to production or dashboard
    if (!this.api.canViewModule(this.currentTab())) {
      this.currentTab.set(this.api.canViewModule('production') ? 'production' : 'dashboard');
    }
  }

  public toggleMobileMenu() {
    this.mobileMenuOpen.update(v => !v);
  }

  public toggleUserRole() {
    this.api.toggleRole();
    if (!this.api.canViewModule(this.currentTab())) {
      this.currentTab.set(this.api.canViewModule('production') ? 'production' : 'dashboard');
    }
  }

  public resetDemoData() {
    if (confirm('¿Deseas reiniciar los datos del sistema a los valores de demostración de mermelada de guayaba?')) {
      this.api.resetDemo();
    }
  }
}
