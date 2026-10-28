import {ChangeDetectionStrategy, Component, inject, signal, OnInit, effect} from '@angular/core';
import {NavigationEnd, Router} from '@angular/router';
import {filter} from 'rxjs';
import {FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {ErpApiService} from './core/services/erp-api.service';
import {DashboardComponent} from './features/dashboard/dashboard';
import {InventoryComponent} from './features/inventory/inventory';
import {ProductionComponent} from './features/production/production';
import {CostingComponent} from './features/costing/costing';
import {SalesComponent} from './features/sales/sales';
import {PayrollComponent} from './features/payroll/payroll';
import {ExpensesComponent} from './features/expenses/expenses';
import {Settings} from './features/settings/settings';
import {SuppliersComponent} from './features/suppliers/suppliers';
import {ArchitectureDocsComponent} from './features/architecture-docs/architecture-docs';
import {LoginComponent} from './features/auth/login';
import {AuthService} from './core/services/auth.service';
import {VeCurrencyPipe} from './core/pipes/ve-currency.pipe';

export type MainNavigationTab =
  | 'dashboard'
  | 'inventory'
  | 'production'
  | 'costing'
  | 'sales'
  | 'payroll'
  | 'expenses'
  | 'suppliers'
  | 'settings'
  | 'architecture';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    ReactiveFormsModule,
    DashboardComponent,
    InventoryComponent,
    ProductionComponent,
    CostingComponent,
    SalesComponent,
    PayrollComponent,
    ExpensesComponent,
    SuppliersComponent,
    Settings,
    ArchitectureDocsComponent,
    LoginComponent,
    VeCurrencyPipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  public api = inject(ErpApiService);
  public auth = inject(AuthService);
  private router = inject(Router);

  public currentTab = signal<MainNavigationTab>('dashboard');
  public mobileMenuOpen = signal<boolean>(false);

  // Change-password dialog state (real sessions only)
  public showPasswordModal = signal<boolean>(false);
  public changingPassword = signal<boolean>(false);
  public passwordError = signal<string>('');
  public passwordForm = new FormGroup({
    currentPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    newPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
    confirmPassword: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  private readonly validTabs: ReadonlySet<string> = new Set<string>([
    'dashboard',
    'inventory',
    'production',
    'costing',
    'sales',
    'payroll',
    'expenses',
    'suppliers',
    'settings',
    'architecture',
  ]);

  constructor() {
    // Check for existing auth token on startup (client-side only;
    // localStorage is not available during SSR)
    if (typeof window !== 'undefined') {
      localStorage.getItem('mermelada-token');
      // Token stored in localStorage; auth guard and backend middleware will pick it up
      // No need to set on API service; the backend AUTH_ENABLED flow handles it
    }

    effect(() => {
      const requested = this.api.requestedTab();
      if (requested) {
        this.setTab(requested as MainNavigationTab);
        this.api.requestedTab.set(null);
      }
    });

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const seg = e.urlAfterRedirects.replace(/^\//, '').split('?')[0].split('/')[0];
        const targetTab = seg === 'admin' ? 'settings' : seg;
        if (this.validTabs.has(targetTab) && targetTab !== this.currentTab()) {
          if (this.api.canViewModule(targetTab as MainNavigationTab)) {
            this.currentTab.set(targetTab as MainNavigationTab);
          }
        }
      });
  }

  public async ngOnInit() {
    await this.auth.initialize();
    if (!this.auth.requiresLogin()) {
      await this.api.refreshAllData();
    }
    const initialSeg = this.router.url.replace(/^\//, '').split('?')[0].split('/')[0];
    const targetTab = initialSeg === 'admin' ? 'settings' : initialSeg;
    if (this.validTabs.has(targetTab) && targetTab !== this.currentTab()) {
      if (this.api.canViewModule(targetTab as MainNavigationTab)) {
        this.currentTab.set(targetTab as MainNavigationTab);
      }
    }
  }

  public async logout() {
    await this.auth.logout();
    this.currentTab.set('dashboard');
  }

  public openPasswordModal() {
    this.passwordForm.reset({
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    });
    this.passwordError.set('');
    this.showPasswordModal.set(true);
  }

  public closePasswordModal() {
    if (this.changingPassword()) return;
    this.showPasswordModal.set(false);
    this.passwordError.set('');
  }

  public async submitPasswordChange() {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    const value = this.passwordForm.getRawValue();
    if (value.newPassword !== value.confirmPassword) {
      this.passwordError.set('La confirmación no coincide con la nueva contraseña');
      return;
    }

    this.changingPassword.set(true);
    this.passwordError.set('');
    try {
      const result = await this.auth.changePassword(
        value.currentPassword,
        value.newPassword
      );
      this.showPasswordModal.set(false);
      this.api.showToast(result.message, 'success');
    } catch (err) {
      const failure = err as {error?: {error?: string; message?: string}};
      this.passwordError.set(
        failure?.error?.error ||
          failure?.error?.message ||
          'No se pudo cambiar la contraseña'
      );
    } finally {
      this.changingPassword.set(false);
    }
  }

  public setTab(tab: MainNavigationTab) {
    if (!this.api.canViewModule(tab)) {
      this.api.showToast(`Acceso restringido: Tu rol actual no tiene permisos para el módulo de ${tab}.`, 'error');
      return;
    }
    this.currentTab.set(tab);
    this.mobileMenuOpen.set(false);
    this.router.navigate([tab], { replaceUrl: true });
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
