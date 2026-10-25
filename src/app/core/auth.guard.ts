import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CybersecurityAgent } from './agents/cybersecurity-agent';
import { MemoryAgent } from './agents/memory-agent';

export const authGuard: CanActivateFn = (route, state) => {
  const security = inject(CybersecurityAgent);
  const memory = inject(MemoryAgent);
  const router = inject(Router);

  // Read allowed roles from route data; default to ['admin']
  const allowedRoles: string[] = route.data?.['allowedRoles'] as string[] || ['admin'];

  // Retrieve the current user role from memory (in a real app this would come from auth store)
  const userRole: string | undefined = memory.get<string>('userRole');

  if (!userRole) {
    // No role set – deny access and navigate to login
    router.navigate(['/login']);
    return false;
  }

  if (security.isAuthorized(userRole, allowedRoles)) {
    return true;
  }

  // Unauthorized – navigate to access‑denied page
  router.navigate(['/access-denied']);
  return false;
};