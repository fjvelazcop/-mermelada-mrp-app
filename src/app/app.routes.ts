import {Routes} from '@angular/router';
import {authGuard} from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'dashboard',
    children: [],
  },
  {
    path: 'inventory',
    children: [],
  },
  {
    path: 'production',
    children: [],
  },
  {
    path: 'costing',
    children: [],
  },
  {
    path: 'sales',
    children: [],
  },
  {
    path: 'payroll',
    children: [],
  },
  {
    path: 'expenses',
    children: [],
  },
  {
    path: 'settings',
    children: [],
  },
  {
    path: 'admin',
    canActivate: [authGuard],
    data: { allowedRoles: ['admin', 'supervisor'] },
    children: [],
  },
  {
    path: 'architecture',
    children: [],
  },
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
