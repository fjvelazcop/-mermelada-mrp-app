import {HttpInterceptorFn} from '@angular/common/http';

/**
 * Adds the JWT and the demo-role headers to every API request.
 *
 * The demo headers are only meaningful when the server runs with
 * `AUTH_ENABLED=false`; when a real session exists the server ignores them and
 * uses the token claims instead.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api')) {
    return next(req);
  }

  const headers: Record<string, string> = {};

  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('mermelada-token');
    const demoRole = localStorage.getItem('mermelada-demo-role');
    const demoUser = localStorage.getItem('mermelada-demo-user');
    const demoUserName = localStorage.getItem('mermelada-demo-user-name');

    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (demoRole) headers['X-Demo-Role'] = demoRole;
    if (demoUser) headers['X-Demo-User'] = demoUser;
    if (demoUserName) headers['X-Demo-User-Name'] = demoUserName;
  }

  return next(req.clone({setHeaders: headers}));
};
