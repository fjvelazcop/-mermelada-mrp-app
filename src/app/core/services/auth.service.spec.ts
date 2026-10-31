import {provideHttpClient} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
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
        AuthService,
        {
          provide: ErpApiService,
          useValue: {refreshSecurityData: () => Promise.resolve()},
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    localStorage.removeItem('mermelada-token');
  });

  afterEach(() => {
    http.verify();
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
});
