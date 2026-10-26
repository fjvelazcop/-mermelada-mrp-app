import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CybersecurityAgent } from './agents/cybersecurity-agent';
import { MemoryAgent } from './agents/memory-agent';
import { ErpApiService } from './services/erp-api.service';

export const authGuard: CanActivateFn = (route) => {
  const security = inject(CybersecurityAgent);
  const memory = inject(MemoryAgent);
  const router = inject(Router);
  const api = inject(ErpApiService);

  // Read allowed roles from route data; default to ['admin']
  const allowedRoles: string[] = (route.data?.['allowedRoles'] as string[]) || ['admin'];

  // Retrieve the current user role from memory or fallback to ERP active user role
  let userRole = memory.get<string>('userRole');
  if (!userRole) {
    userRole = api.currentRole();
    memory.set('userRole', userRole);
  }

  if (userRole && security.isAuthorized(userRole, allowedRoles)) {
    return true;
  }

  // Unauthorized – notify and navigate to dashboard
  api.showToast(`Acceso restringido: El rol ${userRole} no tiene permisos para esta ruta.`, 'error');
  router.navigate(['/dashboard']);
  return false;
};