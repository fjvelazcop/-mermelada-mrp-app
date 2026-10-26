import {Routes} from '@angular/router';
import {authGuard} from './core/auth.guard';

export const routes: Routes = [
  {
    path: 'admin',
    canActivate: [authGuard],
    data: { allowedRoles: ['admin', 'supervisor'] },
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  {
    path: '',
    redirectTo: '/dashboard',
    pathMatch: 'full',
  },
];
