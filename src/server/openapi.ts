/**
 * OpenAPI 3.0 description of the ERP REST API.
 *
 * Served at `/api/openapi.json` and rendered with Swagger UI at `/api/docs`.
 * Both routes are public even when authentication is enabled.
 */

type JsonObject = Record<string, unknown>;

const ref = (name: string): JsonObject => ({
  $ref: `#/components/schemas/${name}`,
});

const jsonResponse = (description: string, schema?: JsonObject): JsonObject => ({
  description,
  ...(schema
    ? { content: { 'application/json': { schema } } }
    : {}),
});

const errorResponses: JsonObject = {
  400: jsonResponse('Solicitud inválida', ref('Error')),
  401: jsonResponse('Token requerido o inválido (solo con AUTH_ENABLED=true)', ref('Error')),
  403: jsonResponse('El rol no tiene permisos sobre el módulo', ref('Error')),
  404: jsonResponse('Recurso no encontrado', ref('Error')),
  422: jsonResponse('Payload inválido', ref('ValidationError')),
  500: jsonResponse('Error interno', ref('Error')),
};

const requestBody = (schema: JsonObject, required = true): JsonObject => ({
  required,
  content: { 'application/json': { schema } },
});

const idParameter: JsonObject = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
};

const arrayOf = (name: string): JsonObject => ({
  type: 'array',
  items: ref(name),
});

const paths: Record<string, JsonObject> = {
  '/api/health': {
    get: {
      tags: ['Sistema'],
      summary: 'Estado del servicio y de la base de datos',
      security: [],
      responses: {
        200: jsonResponse('Servicio operativo', ref('Health')),
        500: jsonResponse('Base de datos no disponible', ref('Error')),
      },
    },
  },
  '/api/openapi.json': {
    get: {
      tags: ['Sistema'],
      summary: 'Documento OpenAPI en formato JSON',
      security: [],
      responses: { 200: jsonResponse('Documento OpenAPI') },
    },
  },
  '/api/docs': {
    get: {
      tags: ['Sistema'],
      summary: 'Documentación interactiva (Swagger UI)',
      security: [],
      responses: { 200: jsonResponse('Interfaz HTML de Swagger UI') },
    },
  },
  '/api/auth/login': {
    post: {
      tags: ['Autenticación'],
      summary: 'Iniciar sesión y obtener un token Bearer',
      security: [],
      requestBody: requestBody(ref('LoginRequest')),
      responses: {
        200: jsonResponse('Token emitido', ref('LoginResponse')),
        400: jsonResponse('Solicitud inválida', ref('Error')),
        401: jsonResponse('Credenciales incorrectas', ref('Error')),
        422: jsonResponse('Payload inválido', ref('ValidationError')),
      },
    },
  },
  '/api/auth/me': {
    get: {
      tags: ['Autenticación'],
      summary: 'Perfil del usuario autenticado',
      responses: {
        200: jsonResponse('Usuario autenticado', ref('AuthUser')),
        401: jsonResponse('Autenticación requerida', ref('Error')),
      },
    },
  },
  '/api/inventory/raw-materials': {
    get: {
      tags: ['Inventario'],
      summary: 'Listar materias primas',
      responses: {
        200: jsonResponse('Listado de materias primas', arrayOf('RawMaterial')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
    post: {
      tags: ['Inventario'],
      summary: 'Registrar materia prima',
      requestBody: requestBody(ref('RawMaterialInput')),
      responses: {
        201: jsonResponse('Materia prima creada', ref('RawMaterial')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/inventory/raw-materials/{id}': {
    put: {
      tags: ['Inventario'],
      summary: 'Actualizar materia prima',
      parameters: [idParameter],
      requestBody: requestBody(ref('RawMaterialUpdate')),
      responses: {
        200: jsonResponse('Materia prima actualizada', ref('RawMaterial')),
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
        422: errorResponses[422],
      },
    },
  },
  '/api/inventory/movements': {
    get: {
      tags: ['Inventario'],
      summary: 'Listar movimientos de inventario',
      responses: {
        200: jsonResponse('Movimientos', arrayOf('InventoryMovement')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
    post: {
      tags: ['Inventario'],
      summary: 'Registrar entrada, salida o merma',
      requestBody: requestBody(ref('InventoryMovementInput')),
      responses: {
        201: jsonResponse('Movimiento registrado', ref('InventoryMovement')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/inventory/finished-goods': {
    get: {
      tags: ['Inventario'],
      summary: 'Listar producto terminado',
      responses: {
        200: jsonResponse('Producto terminado', arrayOf('FinishedGood')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
  },
  '/api/inventory/finished-goods/{id}': {
    put: {
      tags: ['Inventario'],
      summary: 'Actualizar producto terminado',
      parameters: [idParameter],
      requestBody: requestBody(ref('FinishedGoodUpdate')),
      responses: {
        200: jsonResponse('Producto actualizado', ref('FinishedGood')),
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
        422: errorResponses[422],
      },
    },
  },
  '/api/audit-logs': {
    get: {
      tags: ['Auditoría'],
      summary: 'Listar registros de auditoría',
      parameters: [
        {
          name: 'module',
          in: 'query',
          required: false,
          schema: {
            type: 'string',
            enum: ['inventario', 'produccion', 'costos', 'ventas', 'gastos', 'all'],
          },
        },
      ],
      responses: {
        200: jsonResponse('Registros de auditoría', arrayOf('AuditLog')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
    post: {
      tags: ['Auditoría'],
      summary: 'Registrar una entrada de auditoría',
      requestBody: requestBody(ref('AuditLogInput')),
      responses: {
        201: jsonResponse('Entrada registrada', ref('AuditLog')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/recipes': {
    get: {
      tags: ['Producción'],
      summary: 'Listar recetas / BOM',
      responses: {
        200: jsonResponse('Recetas', arrayOf('Recipe')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
    post: {
      tags: ['Producción'],
      summary: 'Crear receta / BOM',
      requestBody: requestBody(ref('RecipeInput')),
      responses: {
        201: jsonResponse('Receta creada', ref('Recipe')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/production-orders': {
    get: {
      tags: ['Producción'],
      summary: 'Listar órdenes de producción',
      responses: {
        200: jsonResponse('Órdenes', arrayOf('ProductionOrder')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
    post: {
      tags: ['Producción'],
      summary: 'Crear orden de producción',
      requestBody: requestBody(ref('ProductionOrderInput')),
      responses: {
        201: jsonResponse('Orden creada', ref('ProductionOrderResult')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/production-orders/{id}/process': {
    post: {
      tags: ['Producción'],
      summary: 'Procesar una orden (consumir insumos y liberar lote)',
      parameters: [idParameter],
      responses: {
        200: jsonResponse('Orden procesada', ref('ProductionOrderResult')),
        400: errorResponses[400],
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
  },
  '/api/sales/customers': {
    get: {
      tags: ['Ventas'],
      summary: 'Listar clientes',
      responses: {
        200: jsonResponse('Clientes', arrayOf('Customer')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
    post: {
      tags: ['Ventas'],
      summary: 'Registrar cliente',
      requestBody: requestBody(ref('CustomerInput')),
      responses: {
        201: jsonResponse('Cliente creado', ref('Customer')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/sales/orders': {
    get: {
      tags: ['Ventas'],
      summary: 'Listar pedidos de venta',
      responses: {
        200: jsonResponse('Pedidos', arrayOf('SalesOrder')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
    post: {
      tags: ['Ventas'],
      summary: 'Crear pedido de venta',
      requestBody: requestBody(ref('SalesOrderInput')),
      responses: {
        201: jsonResponse('Pedido creado', ref('SalesOrder')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/sales/orders/{id}/status': {
    put: {
      tags: ['Ventas'],
      summary: 'Actualizar estado de un pedido',
      parameters: [idParameter],
      requestBody: requestBody({
        type: 'object',
        required: ['status'],
        properties: {
          status: {
            type: 'string',
            enum: ['pendiente', 'en_produccion', 'listo_despacho', 'despachado', 'cobrado'],
          },
        },
      }),
      responses: {
        200: jsonResponse('Pedido actualizado', ref('SalesOrder')),
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
        422: errorResponses[422],
      },
    },
  },
  '/api/sales/orders/{id}/create-production-order': {
    post: {
      tags: ['Ventas'],
      summary: 'Generar orden de producción Make-to-Order',
      parameters: [idParameter],
      responses: {
        201: jsonResponse('Orden generada', ref('ProductionOrderResult')),
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
      },
    },
  },
  '/api/sales/orders/{id}/create-delivery-note': {
    post: {
      tags: ['Ventas'],
      summary: 'Emitir nota de entrega',
      parameters: [idParameter],
      requestBody: requestBody(ref('DeliveryNoteInput'), false),
      responses: {
        201: jsonResponse('Nota emitida', ref('DeliveryNote')),
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
        422: errorResponses[422],
      },
    },
  },
  '/api/sales/delivery-notes': {
    get: {
      tags: ['Ventas'],
      summary: 'Listar notas de entrega',
      responses: {
        200: jsonResponse('Notas de entrega', arrayOf('DeliveryNote')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
  },
  '/api/payroll/weeks': {
    get: {
      tags: ['Nómina'],
      summary: 'Listar semanas de nómina',
      responses: {
        200: jsonResponse('Semanas', arrayOf('PayrollWeek')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
    post: {
      tags: ['Nómina'],
      summary: 'Registrar semana de nómina',
      requestBody: requestBody(ref('PayrollWeekInput')),
      responses: {
        201: jsonResponse('Semana registrada', ref('PayrollWeek')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/payroll/employees': {
    get: {
      tags: ['Nómina'],
      summary: 'Listar empleados',
      responses: {
        200: jsonResponse('Empleados', arrayOf('Employee')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
    post: {
      tags: ['Nómina'],
      summary: 'Registrar empleado',
      requestBody: requestBody(ref('EmployeeInput')),
      responses: {
        201: jsonResponse('Empleado creado', ref('Employee')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/costing/summary': {
    get: {
      tags: ['Costos'],
      summary: 'Estructura de costos y márgenes',
      responses: {
        200: jsonResponse('Estructura de costos'),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
  },
  '/api/costing/simulate': {
    post: {
      tags: ['Costos'],
      summary: 'Simular costo unitario y precios sugeridos',
      requestBody: requestBody(ref('CostingSimulationInput')),
      responses: {
        200: jsonResponse('Resultado de la simulación'),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/expenses': {
    get: {
      tags: ['Gastos'],
      summary: 'Listar gastos operativos',
      responses: {
        200: jsonResponse('Gastos', arrayOf('Expense')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
    post: {
      tags: ['Gastos'],
      summary: 'Registrar gasto operativo',
      requestBody: requestBody(ref('ExpenseInput')),
      responses: {
        201: jsonResponse('Gasto registrado', ref('Expense')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/expenses/{id}': {
    delete: {
      tags: ['Gastos'],
      summary: 'Eliminar gasto',
      parameters: [idParameter],
      responses: {
        200: jsonResponse('Gasto eliminado'),
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
      },
    },
  },
  '/api/expenses/categories': {
    get: {
      tags: ['Gastos'],
      summary: 'Listar categorías de gasto',
      responses: {
        200: jsonResponse('Categorías', arrayOf('ExpenseCategory')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
    post: {
      tags: ['Gastos'],
      summary: 'Crear categoría de gasto',
      requestBody: requestBody(ref('ExpenseCategoryInput')),
      responses: {
        201: jsonResponse('Categoría creada', ref('ExpenseCategory')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/expenses/categories/{id}': {
    put: {
      tags: ['Gastos'],
      summary: 'Actualizar categoría de gasto',
      parameters: [idParameter],
      requestBody: requestBody(ref('ExpenseCategoryUpdate')),
      responses: {
        200: jsonResponse('Categoría actualizada', ref('ExpenseCategory')),
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
        422: errorResponses[422],
      },
    },
    delete: {
      tags: ['Gastos'],
      summary: 'Eliminar categoría de gasto',
      parameters: [idParameter],
      responses: {
        200: jsonResponse('Categoría eliminada'),
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
      },
    },
  },
  '/api/fiscal-settings': {
    get: {
      tags: ['Configuración'],
      summary: 'Consultar configuración fiscal',
      responses: {
        200: jsonResponse('Configuración fiscal', ref('FiscalSettings')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
    put: {
      tags: ['Configuración'],
      summary: 'Actualizar configuración fiscal',
      requestBody: requestBody(ref('FiscalSettingsUpdate')),
      responses: {
        200: jsonResponse('Configuración actualizada', ref('FiscalSettings')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/exchange-rates': {
    get: {
      tags: ['Configuración'],
      summary: 'Consultar tasas USD/USDT del día',
      responses: {
        200: jsonResponse('Tasas', ref('ExchangeRates')),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
  },
  '/api/exchange-rates/update': {
    post: {
      tags: ['Configuración'],
      summary: 'Registrar una nueva tasa manual',
      requestBody: requestBody(ref('ExchangeRateInput')),
      responses: {
        200: jsonResponse('Tasas actualizadas', ref('ExchangeRates')),
        401: errorResponses[401],
        403: errorResponses[403],
        422: errorResponses[422],
      },
    },
  },
  '/api/exchange-rates/refresh': {
    post: {
      tags: ['Configuración'],
      summary: 'Sincronizar tasas desde la fuente externa',
      responses: {
        200: jsonResponse('Tasas sincronizadas', ref('ExchangeRates')),
        401: errorResponses[401],
        403: errorResponses[403],
        500: errorResponses[500],
      },
    },
  },
  '/api/reports/dashboard': {
    get: {
      tags: ['Reportes'],
      summary: 'Métricas del dashboard',
      responses: {
        200: jsonResponse('Métricas'),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
  },
  '/api/system/reset': {
    post: {
      tags: ['Sistema'],
      summary: 'Reiniciar los datos de demostración (solo admin)',
      responses: {
        200: jsonResponse('Datos reiniciados'),
        401: errorResponses[401],
        403: errorResponses[403],
      },
    },
  },
};

const string: JsonObject = { type: 'string' };
const number: JsonObject = { type: 'number' };
const integer: JsonObject = { type: 'integer' };
const boolean: JsonObject = { type: 'boolean' };
const dateTime: JsonObject = { type: 'string', format: 'date-time' };
const date: JsonObject = { type: 'string', format: 'date' };

const presentationEnum = [
  'pequena_250g',
  'grande_1000g',
  'galon_5kg',
  'balde_15kg',
  'pote_20kg',
  'caja_20kg',
  'otra',
];
const unitEnum = ['kg', 'g', 'l', 'ml', 'unidades', 'cajas', 'paquetes'];

const schemas: Record<string, JsonObject> = {
  Error: {
    type: 'object',
    required: ['error', 'code'],
    properties: {
      error: string,
      code: string,
      details: { type: 'object', additionalProperties: true },
    },
  },
  ValidationError: {
    type: 'object',
    required: ['error', 'code', 'details'],
    properties: {
      error: string,
      code: { type: 'string', example: 'VALIDATION_ERROR' },
      details: {
        type: 'object',
        properties: {
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: { path: string, message: string },
            },
          },
        },
      },
    },
  },
  Health: {
    type: 'object',
    properties: {
      status: { type: 'string', example: 'ok' },
      version: { type: 'string', example: '1.2.0' },
      environment: { type: 'string', example: 'production' },
      uptimeSeconds: { type: 'integer', example: 3600 },
      authEnabled: { type: 'boolean', example: true },
      database: {
        type: 'object',
        properties: { path: string, connected: boolean },
      },
      timestamp: dateTime,
    },
  },
  LoginRequest: {
    type: 'object',
    required: ['username', 'password'],
    properties: {
      username: { type: 'string', example: 'admin' },
      password: { type: 'string', example: 'mermelada123' },
    },
  },
  LoginResponse: {
    type: 'object',
    properties: {
      token: string,
      tokenType: { type: 'string', example: 'Bearer' },
      expiresIn: { type: 'integer', example: 28800 },
      user: ref('AuthUser'),
    },
  },
  AuthUser: {
    type: 'object',
    properties: {
      id: string,
      username: string,
      email: string,
      fullName: string,
      nationalId: string,
      roleId: {
        type: 'string',
        enum: ['admin', 'supervisor_planta', 'operator', 'analista_costos', 'almacenista'],
      },
      department: string,
      status: { type: 'string', example: 'activo' },
      createdAt: dateTime,
    },
  },
  RawMaterialInput: {
    type: 'object',
    required: [
      'code',
      'name',
      'category',
      'currentStock',
      'minStock',
      'unit',
      'costPerUnit',
      'lastRestockDate',
    ],
    properties: {
      code: string,
      name: string,
      category: { type: 'string', enum: ['fruta', 'aditivo', 'empaque', 'quimico'] },
      currentStock: number,
      minStock: number,
      unit: { type: 'string', enum: unitEnum },
      costPerUnit: number,
      supplier: string,
      lastRestockDate: date,
      notes: string,
    },
  },
  RawMaterialUpdate: {
    type: 'object',
    description: 'Cualquier subconjunto de los campos de RawMaterialInput',
  },
  RawMaterial: {
    allOf: [
      ref('RawMaterialInput'),
      {
        type: 'object',
        required: ['id'],
        properties: { id: string },
      },
    ],
  },
  InventoryMovementInput: {
    type: 'object',
    required: [
      'materialId',
      'materialName',
      'type',
      'quantity',
      'costPerUnit',
      'totalCost',
      'date',
      'performedBy',
    ],
    properties: {
      materialId: string,
      materialName: string,
      type: {
        type: 'string',
        enum: ['entrada', 'salida_produccion', 'ajuste_merma'],
      },
      quantity: number,
      costPerUnit: number,
      totalCost: number,
      exchangeRateUsed: number,
      costPerUnitBs: number,
      totalCostBs: number,
      referenceDoc: string,
      date: date,
      performedBy: string,
      notes: string,
    },
  },
  InventoryMovement: {
    allOf: [
      ref('InventoryMovementInput'),
      { type: 'object', required: ['id'], properties: { id: string } },
    ],
  },
  FinishedGood: {
    type: 'object',
    properties: {
      id: string,
      code: string,
      flavor: string,
      presentation: { type: 'string', enum: presentationEnum },
      presentationLabel: string,
      weightGrams: number,
      stockUnits: number,
      reservedUnits: number,
      availableUnits: number,
      baseCost: number,
      suggestedWholesalePrice: number,
      suggestedRetailPrice: number,
      suggestedSpecialPrice: number,
      minStock: number,
    },
  },
  FinishedGoodUpdate: {
    type: 'object',
    description: 'Cualquier subconjunto de los campos de FinishedGood',
  },
  RecipeInput: {
    type: 'object',
    required: [
      'code',
      'name',
      'flavor',
      'presentation',
      'batchSizeUnits',
      'items',
      'directLaborMinutes',
      'estimatedUtilityCost',
    ],
    properties: {
      code: string,
      name: string,
      flavor: string,
      presentation: { type: 'string', enum: presentationEnum },
      batchSizeUnits: integer,
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['materialId', 'materialName', 'quantity', 'unit', 'estimatedCost'],
          properties: {
            materialId: string,
            materialName: string,
            quantity: number,
            unit: { type: 'string', enum: unitEnum },
            estimatedCost: number,
          },
        },
      },
      directLaborMinutes: number,
      estimatedUtilityCost: number,
      instructions: string,
    },
  },
  Recipe: {
    allOf: [
      ref('RecipeInput'),
      { type: 'object', required: ['id'], properties: { id: string } },
    ],
  },
  ProductionOrderInput: {
    type: 'object',
    required: ['recipeId', 'batchCount'],
    properties: {
      recipeId: string,
      batchCount: integer,
      salesOrderId: string,
      lotNumber: string,
      operatorNotes: string,
    },
  },
  ProductionOrder: {
    type: 'object',
    properties: {
      id: string,
      orderNumber: string,
      recipeId: string,
      recipeName: string,
      flavor: string,
      presentation: { type: 'string', enum: presentationEnum },
      targetUnits: number,
      batchCount: integer,
      lotNumber: string,
      status: {
        type: 'string',
        enum: ['planificada', 'en_proceso', 'completada', 'cancelada'],
      },
      salesOrderId: string,
      customerName: string,
      startDate: date,
      completionDate: date,
      totalProductionCost: number,
      unitCost: number,
      operatorNotes: string,
    },
  },
  ProductionOrderResult: {
    type: 'object',
    properties: {
      order: ref('ProductionOrder'),
      success: boolean,
      message: string,
      missingMaterials: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: string,
            required: number,
            available: number,
            unit: string,
          },
        },
      },
    },
  },
  CustomerInput: {
    type: 'object',
    required: [
      'businessName',
      'taxId',
      'contactPerson',
      'phone',
      'email',
      'address',
      'clientType',
      'creditLimit',
      'paymentTerms',
    ],
    properties: {
      businessName: string,
      taxId: string,
      contactPerson: string,
      phone: string,
      email: string,
      address: string,
      clientType: {
        type: 'string',
        enum: [
          'panaderia',
          'fabricante_bocadillos',
          'pasteleria',
          'distribuidor',
          'otro',
        ],
      },
      creditLimit: number,
      paymentTerms: string,
    },
  },
  Customer: {
    allOf: [
      ref('CustomerInput'),
      { type: 'object', required: ['id'], properties: { id: string } },
    ],
  },
  SalesOrderInput: {
    type: 'object',
    required: [
      'customerId',
      'customerName',
      'customerTaxId',
      'orderDate',
      'deliveryDate',
      'status',
      'items',
      'subtotal',
      'taxAmount',
      'total',
    ],
    properties: {
      customerId: string,
      customerName: string,
      customerTaxId: string,
      orderDate: date,
      deliveryDate: date,
      status: {
        type: 'string',
        enum: ['pendiente', 'en_produccion', 'listo_despacho', 'despachado', 'cobrado'],
      },
      exchangeRateUsed: number,
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'finishedGoodId',
            'flavor',
            'presentation',
            'presentationLabel',
            'quantity',
            'unitPrice',
            'subtotal',
          ],
          properties: {
            finishedGoodId: string,
            flavor: string,
            presentation: { type: 'string', enum: presentationEnum },
            presentationLabel: string,
            quantity: number,
            unitPrice: number,
            subtotal: number,
            unitPriceBs: number,
            subtotalBs: number,
            priceTier: {
              type: 'string',
              enum: ['mayorista', 'detal', 'especial', 'personalizado'],
            },
            profitMarginPercent: number,
            baseCost: number,
          },
        },
      },
      subtotal: number,
      taxAmount: number,
      total: number,
      subtotalBs: number,
      taxAmountBs: number,
      totalBs: number,
      notes: string,
    },
  },
  SalesOrder: {
    type: 'object',
    properties: {
      id: string,
      orderNumber: string,
      customerId: string,
      customerName: string,
      customerTaxId: string,
      orderDate: date,
      deliveryDate: date,
      status: string,
      exchangeRateUsed: number,
      items: { type: 'array', items: { type: 'object', additionalProperties: true } },
      subtotal: number,
      taxAmount: number,
      total: number,
      subtotalBs: number,
      taxAmountBs: number,
      totalBs: number,
      hasDeliveryNote: boolean,
      deliveryNoteNumber: string,
      productionOrderId: string,
      notes: string,
    },
  },
  DeliveryNoteInput: {
    type: 'object',
    properties: {
      transporter: string,
      receivedByName: string,
      receivedById: string,
      observations: string,
    },
  },
  DeliveryNote: {
    type: 'object',
    properties: {
      id: string,
      noteNumber: string,
      salesOrderId: string,
      salesOrderNumber: string,
      customerName: string,
      dispatchDate: string,
      exchangeRateUsed: number,
      total: number,
      totalBs: number,
      transporter: string,
      status: { type: 'string', enum: ['emitida', 'entregada', 'anulada'] },
    },
  },
  PayrollWeekInput: {
    type: 'object',
    required: [
      'weekNumber',
      'year',
      'startDate',
      'endDate',
      'isActiveProduction',
      'payments',
      'totalPayrollPaid',
      'fixedAbsorptionCost',
    ],
    properties: {
      weekNumber: integer,
      year: integer,
      startDate: date,
      endDate: date,
      isActiveProduction: boolean,
      inactivityReason: {
        type: 'string',
        enum: [
          'mantenimiento_preventivo',
          'escasez_fruta',
          'acumulacion_stock',
          'vacaciones_colectivas',
          'temporada_baja',
        ],
      },
      payments: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'employeeId',
            'employeeName',
            'roleTitle',
            'baseAmount',
            'productionBonus',
            'deductions',
            'netPaid',
          ],
          properties: {
            employeeId: string,
            employeeName: string,
            roleTitle: string,
            baseAmount: number,
            productionBonus: number,
            deductions: number,
            netPaid: number,
          },
        },
      },
      totalPayrollPaid: number,
      fixedAbsorptionCost: number,
      notes: string,
    },
  },
  PayrollWeek: {
    allOf: [
      ref('PayrollWeekInput'),
      { type: 'object', required: ['id'], properties: { id: string } },
    ],
  },
  EmployeeInput: {
    type: 'object',
    required: [
      'fullName',
      'nationalId',
      'roleTitle',
      'weeklyBaseSalary',
      'hourlyRate',
      'status',
    ],
    properties: {
      fullName: string,
      nationalId: string,
      roleTitle: string,
      weeklyBaseSalary: number,
      hourlyRate: number,
      status: { type: 'string', enum: ['activo', 'vacaciones', 'inactivo'] },
    },
  },
  Employee: {
    allOf: [
      ref('EmployeeInput'),
      { type: 'object', required: ['id'], properties: { id: string } },
    ],
  },
  CostingSimulationInput: {
    type: 'object',
    required: ['directMaterial', 'directPackaging', 'directLabor', 'utilityCost'],
    properties: {
      directMaterial: number,
      directPackaging: number,
      directLabor: number,
      utilityCost: number,
      inactiveWeeksCount: number,
      targetMarginWholesale: number,
      targetMarginRetail: number,
    },
  },
  ExpenseInput: {
    type: 'object',
    required: [
      'date',
      'concept',
      'category',
      'categoryLabel',
      'amountUsd',
      'supplierOrBeneficiary',
      'documentType',
      'paymentMethod',
      'registeredBy',
      'taxCategory',
      'fiscalBookEligible',
    ],
    properties: {
      date: date,
      concept: string,
      category: string,
      categoryLabel: string,
      amountUsd: number,
      exchangeRateUsed: number,
      amountBs: number,
      supplierOrBeneficiary: string,
      taxId: string,
      documentType: {
        type: 'string',
        enum: [
          'factura_fiscal',
          'recibo_pago',
          'nota_debito',
          'vale_caja',
          'otro',
        ],
      },
      documentNumber: string,
      paymentMethod: {
        type: 'string',
        enum: [
          'transferencia_bancaria',
          'pago_movil',
          'efectivo_usd',
          'efectivo_bs',
          'zelle',
          'tarjeta',
        ],
      },
      paymentReference: string,
      notes: string,
      registeredBy: string,
      taxCategory: {
        type: 'string',
        enum: ['con_factura_iva', 'exento', 'no_sujeto', 'retencion_aplicada'],
      },
      taxRatePercent: number,
      taxAmountUsd: number,
      taxAmountBs: number,
      accountingAccountCode: string,
      accountingAccountName: string,
      fiscalBookEligible: boolean,
    },
  },
  Expense: {
    type: 'object',
    properties: {
      id: string,
      expenseNumber: string,
      date: date,
      concept: string,
      category: string,
      categoryLabel: string,
      amountUsd: number,
      exchangeRateUsed: number,
      amountBs: number,
      supplierOrBeneficiary: string,
      documentType: string,
      paymentMethod: string,
      registeredBy: string,
      taxCategory: string,
      fiscalBookEligible: boolean,
    },
  },
  ExpenseCategoryInput: {
    type: 'object',
    required: ['name', 'icon', 'color', 'monthlyBudgetUsd'],
    properties: {
      name: string,
      icon: string,
      color: string,
      monthlyBudgetUsd: number,
      accountingAccountCode: string,
      accountingAccountName: string,
      defaultTaxCategory: {
        type: 'string',
        enum: ['con_factura_iva', 'exento', 'no_sujeto', 'retencion_aplicada'],
      },
      description: string,
    },
  },
  ExpenseCategoryUpdate: {
    type: 'object',
    description: 'Cualquier subconjunto de los campos de ExpenseCategoryInput',
  },
  ExpenseCategory: {
    allOf: [
      ref('ExpenseCategoryInput'),
      { type: 'object', required: ['id'], properties: { id: string } },
    ],
  },
  FiscalSettings: {
    type: 'object',
    properties: {
      enabled: boolean,
      companyName: string,
      companyTaxId: string,
      fiscalAddress: string,
      taxRatePercent: number,
      invoicePrefix: string,
      nextInvoiceNumber: integer,
      authorizationCode: string,
      printNotes: string,
    },
  },
  FiscalSettingsUpdate: {
    type: 'object',
    description: 'Cualquier subconjunto de los campos de FiscalSettings',
  },
  ExchangeRateInput: {
    type: 'object',
    required: ['usdRate', 'usdtRate'],
    properties: {
      usdRate: number,
      usdtRate: number,
      source: string,
      notes: string,
    },
  },
  ExchangeRates: {
    type: 'object',
    properties: {
      currentUsd: number,
      currentUsdt: number,
      lastUpdated: string,
      isInActiveWindow: boolean,
      activeWindowName: string,
      nextScheduledCheck: string,
      history: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: string,
            date: date,
            time: string,
            usdRate: number,
            usdtRate: number,
            source: string,
            window: string,
            notes: string,
          },
        },
      },
    },
  },
  AuditLogInput: {
    type: 'object',
    required: [
      'module',
      'actionType',
      'title',
      'description',
      'userId',
      'userName',
      'userRole',
      'severity',
    ],
    properties: {
      module: {
        type: 'string',
        enum: ['inventario', 'produccion', 'costos', 'ventas', 'gastos'],
      },
      actionType: string,
      title: string,
      description: string,
      userId: string,
      userName: string,
      userRole: string,
      severity: { type: 'string', enum: ['info', 'success', 'warning', 'critical'] },
      timestamp: dateTime,
      details: { type: 'object', additionalProperties: true },
    },
  },
  AuditLog: {
    allOf: [
      ref('AuditLogInput'),
      { type: 'object', required: ['id'], properties: { id: string } },
    ],
  },
};

export const openApiDocument: JsonObject = {
  openapi: '3.0.3',
  info: {
    title: 'Pulpacraft ERP / MRP API',
    version: '1.0.0',
    description:
      'API REST del ERP de mermeladas artesanales: inventario, producción MTO, ventas, nómina, costos, gastos y auditoría. ' +
      'La autenticación Bearer es opcional en desarrollo (`AUTH_ENABLED=false`) y obligatoria en producción.',
    license: { name: 'Privado' },
  },
  servers: [{ url: '/', description: 'Servidor actual' }],
  tags: [
    { name: 'Sistema', description: 'Salud, documentación y reinicio de datos' },
    { name: 'Autenticación', description: 'Login y perfil del usuario' },
    { name: 'Inventario', description: 'Materias primas, movimientos y producto terminado' },
    { name: 'Producción', description: 'Recetas BOM y órdenes de fabricación' },
    { name: 'Ventas', description: 'Clientes, pedidos y notas de entrega' },
    { name: 'Nómina', description: 'Empleados y semanas de nómina' },
    { name: 'Costos', description: 'Estructura de costos y simulaciones' },
    { name: 'Gastos', description: 'Egresos operativos y presupuestos' },
    { name: 'Configuración', description: 'Datos fiscales y tasas de cambio' },
    { name: 'Reportes', description: 'Métricas agregadas' },
    { name: 'Auditoría', description: 'Trazabilidad de operaciones' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'HMAC-SHA256',
      },
    },
    schemas,
  },
  security: [{ bearerAuth: [] }],
  paths,
};

export default openApiDocument;
