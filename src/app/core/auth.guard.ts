import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CybersecurityAgent } from './agents/cybersecurity-agent';
import { MemoryAgent } from './agents/memory-agent';
import {AuthService} from './services/auth.service';
import { ErpApiService } from './services/erp-api.service';

export const authGuard: CanActivateFn = (route) => {
  const security = inject(CybersecurityAgent);
  const memory = inject(MemoryAgent);
  const router = inject(Router);
  const api = inject(ErpApiService);
  const auth = inject(AuthService);

  if (!auth.ready()) {
    return true;
  }
  if (!auth.currentUser()) {
    return router.createUrlTree(['/login']);
  }

  const allowedRoles = route.data?.['allowedRoles'] as string[] | undefined;
  if (!allowedRoles?.length) {
    return true;
  }

  let userRole = auth.currentUser()?.roleId || memory.get<string>('userRole');
  if (!userRole) {
    userRole = api.currentRole();
    memory.set('userRole', userRole);
  }

  if (userRole && security.isAuthorized(userRole, allowedRoles)) {
    return true;
  }

  api.showToast(`Acceso restringido: El rol ${userRole} no tiene permisos para esta ruta.`, 'error');
  return router.createUrlTree(['/dashboard']);
};