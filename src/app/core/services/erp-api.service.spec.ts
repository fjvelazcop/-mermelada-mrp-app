import {provideHttpClient} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {ErpApiService} from './erp-api.service';

describe('ErpApiService — mensajes del backend', () => {
  let api: ErpApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ErpApiService],
    });
    api = TestBed.inject(ErpApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    clearInterval(
      (api as unknown as {ratePollInterval: ReturnType<typeof setInterval>})
        .ratePollInterval
    );
    http.verify();
  });

  const categoryInput = {
    code: 'quimico',
    label: 'Químico',
    description: 'Pectina, ácido y químicos de proceso',
    color: 'rose',
    active: true,
  };

  it('muestra el error real del backend al crear una categoría de materia prima', async () => {
    const backendMessage =
      'Ya existe una categoría de materia prima con el código quimico';
    const request = api.addMaterialCategory(categoryInput);
    const req = http.expectOne('/api/material-categories');
    expect(req.request.method).toBe('POST');
    req.flush(
      {error: backendMessage, code: 'BAD_REQUEST'},
      {status: 400, statusText: 'Bad Request'}
    );

    await expect(request).rejects.toBeTruthy();
    expect(api.toastMessage()?.type).toBe('error');
    expect(api.toastMessage()?.text).toBe(backendMessage);
  });

  it('usa el mensaje contextual cuando el backend no devuelve detalle', async () => {
    const request = api.addMaterialCategory(categoryInput);
    http
      .expectOne('/api/material-categories')
      .flush({}, {status: 400, statusText: 'Bad Request'});

    await expect(request).rejects.toBeTruthy();
    expect(api.toastMessage()?.text).toBe(
      'Error al crear categoría de materia prima'
    );
  });

  it('aplica el mismo criterio en otros catálogos', async () => {
    const backendMessage = 'El código solo admite letras minúsculas, números, guiones y guiones bajos';
    const request = api.addSupplierType({
      code: 'quimico 2',
      label: 'Químico 2',
      description: '',
      color: 'stone',
      active: true,
    });
    http
      .expectOne('/api/supplier-types')
      .flush(
        {error: backendMessage, code: 'BAD_REQUEST'},
        {status: 400, statusText: 'Bad Request'}
      );

    await expect(request).rejects.toBeTruthy();
    expect(api.toastMessage()?.text).toBe(backendMessage);
  });
});
