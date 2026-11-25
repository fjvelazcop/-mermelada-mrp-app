import {provideHttpClient} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {TestBed} from '@angular/core/testing';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
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

describe('ErpApiService — doble fecha del movimiento', () => {
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

  it('envía la fecha elegida y conserva la de registro', async () => {
    vi.spyOn(api, 'refreshAllData').mockResolvedValue(undefined);
    api.rawMaterials.set([
      {
        id: 'rm-1', code: 'MP-QUI-02', name: 'Ácido cítrico', category: 'quimico',
        currentStock: 21650, minStock: 1500, unit: 'g', costPerUnit: 0.012,
        supplier: '', lastRestockDate: '2026-09-15',
      },
    ]);
    const request = api.recordMovement({
      materialId: 'rm-1',
      type: 'entrada',
      quantity: 10,
      costPerUnit: 12,
      movementDate: '2026-11-20',
      referenceDoc: 'F-100',
    });
    const req = http.expectOne('/api/inventory/movements');
    expect(req.request.body.movementDate).toBe('2026-11-20');
    expect(req.request.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    req.flush({
      movement: {id: 'mov-1', registeredAt: '2026-11-24T12:00:00.000Z'},
      payable: null,
    });
    await Promise.resolve();
    const auditReq = http.expectOne('/api/audit-logs');
    expect(auditReq.request.body.details.movementDate).toBe('2026-11-20');
    expect(auditReq.request.body.details.registeredAt).toBe('2026-11-24T12:00:00.000Z');
    auditReq.flush({});
    await request;
  });
});
