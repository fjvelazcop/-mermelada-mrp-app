import {Routes} from '@angular/router';
import {authGuard} from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    children: [],
  },
  {
    path: '',
    canActivateChild: [authGuard],
    children: [
      {path: 'dashboard', children: []},
      {path: 'inventory', children: []},
      {path: 'production', children: []},
      {path: 'costing', children: []},
      {path: 'sales', children: []},
      {path: 'payroll', children: []},
      {path: 'expenses', children: []},
      {path: 'suppliers', children: []},
      {path: 'settings', children: []},
      {
        path: 'admin',
        canActivate: [authGuard],
        data: {allowedRoles: ['admin', 'supervisor']},
        children: [],
      },
      {path: 'architecture', children: []},
      {path: '', redirectTo: 'login', pathMatch: 'full'},
      {path: '**', redirectTo: 'dashboard'},
    ],
  },
];
