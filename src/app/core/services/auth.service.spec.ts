import {provideHttpClient} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {provideRouter, Router} from '@angular/router';
import {TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {AuthService} from './auth.service';
import {ErpApiService} from './erp-api.service';

describe('AuthService', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{path: 'login', children: []}]),
        AuthService,
        {
          provide: ErpApiService,
          useValue: {
            refreshSecurityData: () => Promise.resolve(),
            refreshAllData: () => Promise.resolve(),
            applyAuthenticatedUser: () => undefined,
            clearAuthenticatedUser: () => undefined,
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    localStorage.removeItem('mermelada-token');
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('keeps login enabled when the health check fails', async () => {
    const auth = TestBed.inject(AuthService);
    const initialization = auth.initialize();

    http.expectOne('/api/health').flush(
      {error: 'Servicio no disponible'},
      {status: 503, statusText: 'Service Unavailable'}
    );

    await initialization;

    expect(auth.ready()).toBe(true);
    expect(auth.authEnabled()).toBe(true);
    expect(auth.requiresLogin()).toBe(true);
    expect(auth.initializationError()).toContain(
      'No se pudo verificar el servidor'
    );
  });

  it('requires a login in demo mode too', async () => {
    const auth = TestBed.inject(AuthService);
    const initialization = auth.initialize();

    http.expectOne('/api/health').flush({authEnabled: false});

    await initialization;

    expect(auth.ready()).toBe(true);
    expect(auth.authEnabled()).toBe(false);
    expect(auth.requiresLogin()).toBe(true);
  });

  it('returns to login when the session token expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    const expiresAt = Math.floor(Date.now() / 1000) + 5;
    const payload = btoa(JSON.stringify({exp: expiresAt}))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const auth = TestBed.inject(AuthService);
    const login = auth.login('admin', 'password');

    http.expectOne('/api/auth/login').flush({
      token: `${payload}.signature`,
      tokenType: 'Bearer',
      expiresIn: 5,
      user: {
        id: 'user-1',
        username: 'admin',
        email: 'admin@example.test',
        fullName: 'Administrador',
        roleId: 'admin',
        status: 'activo',
        createdAt: '2026-10-31',
      },
    });
    await login;

    await vi.advanceTimersByTimeAsync(5_000);

    expect(auth.currentUser()).toBeNull();
    expect(auth.initializationError()).toContain('La sesión expiró');
    expect(TestBed.inject(Router).url).toBe('/login');
  });

  it('returns to login when the user logs out', async () => {
    const auth = TestBed.inject(AuthService);
    const logout = auth.logout();
    http.expectOne('/api/auth/logout').flush({success: true});

    await logout;

    expect(TestBed.inject(Router).url).toBe('/login');
  });
});
