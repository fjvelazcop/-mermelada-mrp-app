import {
  RawMaterial,
  InventoryMovement,
  FinishedGood,
  RecipeBOM,
  ProductionOrder,
  Customer,
  SalesOrder,
  DeliveryNote,
  Employee,
  PayrollWeek,
  FiscalSettings,
  CostStructureAnalysis,
  MonthlySalesStat,
} from '../app/core/models/erp.models.js';

export interface DatabaseState {
  rawMaterials: RawMaterial[];
  inventoryMovements: InventoryMovement[];
  finishedGoods: FinishedGood[];
  recipes: RecipeBOM[];
  productionOrders: ProductionOrder[];
  customers: Customer[];
  salesOrders: SalesOrder[];
  deliveryNotes: DeliveryNote[];
  employees: Employee[];
  payrollWeeks: PayrollWeek[];
  fiscalSettings: FiscalSettings;
}

export function createInitialDatabase(): DatabaseState {
  const rawMaterials: RawMaterial[] = [
    {
      id: 'rm-1',
      code: 'MP-FRU-01',
      name: 'Guayaba Roja Criolla (Pulpa fresca)',
      category: 'fruta',
      currentStock: 180,
      minStock: 60,
      unit: 'kg',
      costPerUnit: 1.25,
      supplier: 'Asociación de Fruticultores del Valle',
      lastRestockDate: '2026-10-02',
      notes: 'Calibre seleccionado, maduración óptima Brix 10-12',
    },
    {
      id: 'rm-2',
      code: 'MP-ADI-01',
      name: 'Azúcar Blanca Refinada Estandarizada',
      category: 'aditivo',
      currentStock: 240,
      minStock: 80,
      unit: 'kg',
      costPerUnit: 0.95,
      supplier: 'Distribuidora Central Azucarera',
      lastRestockDate: '2026-09-28',
      notes: 'Sacos de 50kg grado alimentario',
    },
    {
      id: 'rm-3',
      code: 'MP-QUI-01',
      name: 'Pectina Cítrica de Alto Metoxilo (HM)',
      category: 'quimico',
      currentStock: 8500,
      minStock: 2500,
      unit: 'g',
      costPerUnit: 0.038, // $38/kg = $0.038/g
      supplier: 'Químicos y Aditivos Andinos',
      lastRestockDate: '2026-09-15',
      notes: 'Gelificante rápido para mermeladas de pH 3.0-3.4',
    },
    {
      id: 'rm-4',
      code: 'MP-QUI-02',
      name: 'Ácido Cítrico Anhidro USP',
      category: 'quimico',
      currentStock: 4200,
      minStock: 1500,
      unit: 'g',
      costPerUnit: 0.012, // $12/kg = $0.012/g
      supplier: 'Químicos y Aditivos Andinos',
      lastRestockDate: '2026-09-15',
      notes: 'Regulador de pH para activación de pectina',
    },
    {
      id: 'rm-5',
      code: 'MP-QUI-03',
      name: 'Benzoato de Sodio (Conservante Grado Alimentario)',
      category: 'quimico',
      currentStock: 1900,
      minStock: 800,
      unit: 'g',
      costPerUnit: 0.015,
      supplier: 'Químicos y Aditivos Andinos',
      lastRestockDate: '2026-09-10',
      notes: 'Dosis máxima permitida 0.05% en peso final',
    },
    {
      id: 'rm-6',
      code: 'MP-EMP-01',
      name: 'Frasco de Vidrio Hexagonal 250g con boca twist-off',
      category: 'empaque',
      currentStock: 380,
      minStock: 150,
      unit: 'unidades',
      costPerUnit: 0.32,
      supplier: 'Cristalería Industrial Envases S.A.',
      lastRestockDate: '2026-09-29',
      notes: 'Apto para llenado en caliente (hot fill 85°C)',
    },
    {
      id: 'rm-7',
      code: 'MP-EMP-02',
      name: 'Tapa Metálica Twist-Off 58mm Dorada (con botón de seguridad)',
      category: 'empaque',
      currentStock: 410,
      minStock: 150,
      unit: 'unidades',
      costPerUnit: 0.09,
      supplier: 'Tapas y Cierres Herméticos',
      lastRestockDate: '2026-09-29',
      notes: 'Con plastisol para sello al vacío térmico',
    },
    {
      id: 'rm-8',
      code: 'MP-EMP-03',
      name: 'Frasco de Vidrio Cilíndrico 1000g (1 kg)',
      category: 'empaque',
      currentStock: 125,
      minStock: 60,
      unit: 'unidades',
      costPerUnit: 0.68,
      supplier: 'Cristalería Industrial Envases S.A.',
      lastRestockDate: '2026-09-20',
      notes: 'Formato institucional / panaderías',
    },
    {
      id: 'rm-9',
      code: 'MP-EMP-04',
      name: 'Tapa Metálica Twist-Off 82mm Dorada',
      category: 'empaque',
      currentStock: 140,
      minStock: 60,
      unit: 'unidades',
      costPerUnit: 0.16,
      supplier: 'Tapas y Cierres Herméticos',
      lastRestockDate: '2026-09-20',
      notes: 'Para frascos de 1000g',
    },
    {
      id: 'rm-10',
      code: 'MP-EMP-05',
      name: 'Etiqueta Adhesiva Laminada Mermelada Guayaba 250g',
      category: 'empaque',
      currentStock: 520,
      minStock: 200,
      unit: 'unidades',
      costPerUnit: 0.08,
      supplier: 'Litografía & Empaques Gráficos',
      lastRestockDate: '2026-09-18',
      notes: 'Resistente a humedad y refrigeración',
    },
    {
      id: 'rm-11',
      code: 'MP-EMP-06',
      name: 'Etiqueta Adhesiva Mermelada Guayaba 1000g (Institucional)',
      category: 'empaque',
      currentStock: 180,
      minStock: 80,
      unit: 'unidades',
      costPerUnit: 0.12,
      supplier: 'Litografía & Empaques Gráficos',
      lastRestockDate: '2026-09-18',
      notes: 'Formato rectangular grande con tabla nutricional',
    },
    {
      id: 'rm-12',
      code: 'MP-EMP-07',
      name: 'Caja Corrugado Kraft Máster (Capacidad 24 unidades 250g)',
      category: 'empaque',
      currentStock: 45,
      minStock: 20,
      unit: 'unidades',
      costPerUnit: 0.85,
      supplier: 'Cartones del Centro',
      lastRestockDate: '2026-09-25',
      notes: 'Con separadores internos para despacho seguro',
    },
  ];

  const finishedGoods: FinishedGood[] = [
    {
      id: 'fg-1',
      code: 'PT-GUA-250',
      flavor: 'Guayaba Criolla',
      presentation: 'pequena_250g',
      presentationLabel: 'Frasco de Vidrio 250g',
      weightGrams: 250,
      stockUnits: 110,
      reservedUnits: 48,
      availableUnits: 62,
      baseCost: 0.98,
      suggestedWholesalePrice: 1.65,
      suggestedRetailPrice: 2.20,
      minStock: 40,
    },
    {
      id: 'fg-2',
      code: 'PT-GUA-1000',
      flavor: 'Guayaba Criolla',
      presentation: 'grande_1000g',
      presentationLabel: 'Frasco Institucional 1000g (1 kg)',
      weightGrams: 1000,
      stockUnits: 34,
      reservedUnits: 15,
      availableUnits: 19,
      baseCost: 3.42,
      suggestedWholesalePrice: 5.50,
      suggestedRetailPrice: 7.20,
      minStock: 15,
    },
  ];

  const recipes: RecipeBOM[] = [
    {
      id: 'rec-1',
      code: 'BOM-GUA-250-50U',
      name: 'Fórmula Estándar: Guayaba 250g (Lote 50 unidades)',
      flavor: 'Guayaba Criolla',
      presentation: 'pequena_250g',
      batchSizeUnits: 50,
      directLaborMinutes: 120, // 2 horas operario
      estimatedUtilityCost: 4.50, // gas y agua
      instructions: '1. Despulpado y filtrado de semilla. 2. Precalentado a 60°C. 3. Adición gradual de azúcar y pectina disuelta. 4. Concentración a 65° Brix. 5. Corrección de pH con ácido cítrico a 3.2. 6. Envasado hot-fill a 85°C, cerrado inmediato y choque térmico.',
      items: [
        { materialId: 'rm-1', materialName: 'Guayaba Roja Criolla', quantity: 7.5, unit: 'kg', estimatedCost: 9.38 },
        { materialId: 'rm-2', materialName: 'Azúcar Blanca Refinada', quantity: 6.5, unit: 'kg', estimatedCost: 6.18 },
        { materialId: 'rm-3', materialName: 'Pectina Cítrica HM', quantity: 65, unit: 'g', estimatedCost: 2.47 },
        { materialId: 'rm-4', materialName: 'Ácido Cítrico Anhidro', quantity: 30, unit: 'g', estimatedCost: 0.36 },
        { materialId: 'rm-5', materialName: 'Benzoato de Sodio', quantity: 12, unit: 'g', estimatedCost: 0.18 },
        { materialId: 'rm-6', materialName: 'Frasco Hexagonal 250g', quantity: 50, unit: 'unidades', estimatedCost: 16.00 },
        { materialId: 'rm-7', materialName: 'Tapa Metálica Twist-Off 58mm', quantity: 50, unit: 'unidades', estimatedCost: 4.50 },
        { materialId: 'rm-10', materialName: 'Etiqueta Adhesiva Guayaba 250g', quantity: 50, unit: 'unidades', estimatedCost: 4.00 },
      ],
    },
    {
      id: 'rec-2',
      code: 'BOM-GUA-1000-20U',
      name: 'Fórmula Institucional: Guayaba 1000g (Lote 20 unidades)',
      flavor: 'Guayaba Criolla',
      presentation: 'grande_1000g',
      batchSizeUnits: 20,
      directLaborMinutes: 150, // 2.5 horas operario
      estimatedUtilityCost: 6.80, // gas y agua
      instructions: 'Cocción en paila abierta de 20kg. Homogeneizado para textura suave ideal para relleno de bocadillos y bollería fina. Envasado a 85°C.',
      items: [
        { materialId: 'rm-1', materialName: 'Guayaba Roja Criolla', quantity: 12.0, unit: 'kg', estimatedCost: 15.00 },
        { materialId: 'rm-2', materialName: 'Azúcar Blanca Refinada', quantity: 10.5, unit: 'kg', estimatedCost: 9.98 },
        { materialId: 'rm-3', materialName: 'Pectina Cítrica HM', quantity: 100, unit: 'g', estimatedCost: 3.80 },
        { materialId: 'rm-4', materialName: 'Ácido Cítrico Anhidro', quantity: 45, unit: 'g', estimatedCost: 0.54 },
        { materialId: 'rm-5', materialName: 'Benzoato de Sodio', quantity: 20, unit: 'g', estimatedCost: 0.30 },
        { materialId: 'rm-8', materialName: 'Frasco Cilíndrico 1000g', quantity: 20, unit: 'unidades', estimatedCost: 13.60 },
        { materialId: 'rm-9', materialName: 'Tapa Twist-Off 82mm', quantity: 20, unit: 'unidades', estimatedCost: 3.20 },
        { materialId: 'rm-11', materialName: 'Etiqueta Institucional 1000g', quantity: 20, unit: 'unidades', estimatedCost: 2.40 },
      ],
    },
  ];

  const customers: Customer[] = [
    {
      id: 'cust-1',
      businessName: 'Panadería y Pastelería El Trigal C.A.',
      taxId: 'J-30914829-1',
      contactPerson: 'Maestro Panadero Carlos Mendoza',
      phone: '+58 414-3891024',
      email: 'compras@eltrigal.com',
      address: 'Av. Las Delicias Nro. 44, Sector Centro',
      clientType: 'panaderia',
      creditLimit: 500,
      paymentTerms: 'Contado contra entrega',
    },
    {
      id: 'cust-2',
      businessName: 'Fábrica de Bocadillos La Tradición Real',
      taxId: 'J-40192837-5',
      contactPerson: 'Ing. Martha Benítez',
      phone: '+58 412-7782190',
      email: 'martha.benitez@latradicion.com',
      address: 'Zona Industrial Los Olivos, Galpón 12',
      clientType: 'fabricante_bocadillos',
      creditLimit: 1200,
      paymentTerms: 'Crédito a 7 días',
    },
    {
      id: 'cust-3',
      businessName: 'Dulcería & Cafetería Aromas Artesanales',
      taxId: 'J-50123991-8',
      contactPerson: 'Roberto Vivas',
      phone: '+58 424-9102833',
      email: 'aromasartesanales@gmail.com',
      address: 'Calle Real Nro. 18, Casco Histórico',
      clientType: 'pasteleria',
      creditLimit: 300,
      paymentTerms: 'Contado',
    },
    {
      id: 'cust-4',
      businessName: 'Distribuidora de Alimentos Gourmet Andes',
      taxId: 'J-31849201-9',
      contactPerson: 'Gonzalo Silva',
      phone: '+58 416-5542109',
      email: 'pedidos@distribuidoragourmet.com',
      address: 'Av. Intercomunal Km 4, Local Comercial 8',
      clientType: 'distribuidor',
      creditLimit: 2000,
      paymentTerms: 'Crédito a 15 días',
    },
  ];

  const salesOrders: SalesOrder[] = [
    {
      id: 'so-1',
      orderNumber: 'PED-2026-041',
      customerId: 'cust-1',
      customerName: 'Panadería y Pastelería El Trigal C.A.',
      customerTaxId: 'J-30914829-1',
      orderDate: '2026-10-04',
      deliveryDate: '2026-10-06',
      status: 'despachado',
      items: [
        {
          finishedGoodId: 'fg-1',
          flavor: 'Guayaba Criolla',
          presentation: 'pequena_250g',
          presentationLabel: 'Frasco de Vidrio 250g',
          quantity: 48,
          unitPrice: 1.65,
          subtotal: 79.20,
        },
        {
          finishedGoodId: 'fg-2',
          flavor: 'Guayaba Criolla',
          presentation: 'grande_1000g',
          presentationLabel: 'Frasco Institucional 1000g',
          quantity: 12,
          unitPrice: 5.50,
          subtotal: 66.00,
        },
      ],
      subtotal: 145.20,
      taxAmount: 23.23,
      total: 168.43,
      hasDeliveryNote: true,
      deliveryNoteNumber: 'NE-000124',
      notes: 'Despacho matutino antes de las 10:00 AM para horneado.',
    },
    {
      id: 'so-2',
      orderNumber: 'PED-2026-042',
      customerId: 'cust-2',
      customerName: 'Fábrica de Bocadillos La Tradición Real',
      customerTaxId: 'J-40192837-5',
      orderDate: '2026-10-06',
      deliveryDate: '2026-10-09',
      status: 'en_produccion',
      items: [
        {
          finishedGoodId: 'fg-2',
          flavor: 'Guayaba Criolla',
          presentation: 'grande_1000g',
          presentationLabel: 'Frasco Institucional 1000g',
          quantity: 40,
          unitPrice: 5.50,
          subtotal: 220.00,
        },
      ],
      subtotal: 220.00,
      taxAmount: 35.20,
      total: 255.20,
      hasDeliveryNote: false,
      productionOrderId: 'po-2',
      notes: 'MTO: Se generó OP-2026-089 para cubrir el pedido específico de 40 frascos grandes.',
    },
    {
      id: 'so-3',
      orderNumber: 'PED-2026-043',
      customerId: 'cust-3',
      customerName: 'Dulcería & Cafetería Aromas Artesanales',
      customerTaxId: 'J-50123991-8',
      orderDate: '2026-10-07',
      deliveryDate: '2026-10-10',
      status: 'pendiente',
      items: [
        {
          finishedGoodId: 'fg-1',
          flavor: 'Guayaba Criolla',
          presentation: 'pequena_250g',
          presentationLabel: 'Frasco de Vidrio 250g',
          quantity: 36,
          unitPrice: 1.65,
          subtotal: 59.40,
        },
      ],
      subtotal: 59.40,
      taxAmount: 9.50,
      total: 68.90,
      hasDeliveryNote: false,
      notes: 'Presentación pequeña para venta en vitrina.',
    },
  ];

  const deliveryNotes: DeliveryNote[] = [
    {
      id: 'dn-1',
      noteNumber: 'NE-000124',
      salesOrderId: 'so-1',
      salesOrderNumber: 'PED-2026-041',
      customerName: 'Panadería y Pastelería El Trigal C.A.',
      customerTaxId: 'J-30914829-1',
      customerAddress: 'Av. Las Delicias Nro. 44, Sector Centro',
      customerPhone: '+58 414-3891024',
      dispatchDate: '2026-10-06 09:30',
      items: [
        {
          description: 'Mermelada Artesanal de Guayaba Criolla',
          presentationLabel: 'Frasco de Vidrio 250g',
          quantity: 48,
          lotNumber: 'L-GUAY-2610-A',
          unitPrice: 1.65,
          subtotal: 79.20,
        },
        {
          description: 'Mermelada Institucional de Guayaba Criolla',
          presentationLabel: 'Frasco Cilíndrico 1000g (1 kg)',
          quantity: 12,
          lotNumber: 'L-GUAY-2610-B',
          unitPrice: 5.50,
          subtotal: 66.00,
        },
      ],
      subtotal: 145.20,
      taxIncluded: true,
      taxAmount: 23.23,
      total: 168.43,
      transporter: 'Transporte Interno - Camioneta de Planta',
      receivedByName: 'Carlos Mendoza (Maestro Panadero)',
      receivedById: 'V-15.429.110',
      signatureDate: '2026-10-06',
      status: 'entregada',
      observations: 'Mercancía recibida a entera conformidad con sellos de seguridad intactos.',
    },
  ];

  const productionOrders: ProductionOrder[] = [
    {
      id: 'po-1',
      orderNumber: 'OP-2026-088',
      recipeId: 'rec-1',
      recipeName: 'Fórmula Estándar: Guayaba 250g (Lote 50 unidades)',
      flavor: 'Guayaba Criolla',
      presentation: 'pequena_250g',
      targetUnits: 100, // 2 lotes
      batchCount: 2,
      lotNumber: 'L-GUAY-2610-A',
      status: 'completada',
      salesOrderId: 'so-1',
      customerName: 'Panadería El Trigal C.A.',
      startDate: '2026-10-03',
      completionDate: '2026-10-04',
      consumedMaterials: [
        { materialId: 'rm-1', materialName: 'Guayaba Roja Criolla', quantityConsumed: 15, unit: 'kg', unitCost: 1.25, totalCost: 18.75 },
        { materialId: 'rm-2', materialName: 'Azúcar Blanca Refinada', quantityConsumed: 13, unit: 'kg', unitCost: 0.95, totalCost: 12.35 },
        { materialId: 'rm-3', materialName: 'Pectina Cítrica HM', quantityConsumed: 130, unit: 'g', unitCost: 0.038, totalCost: 4.94 },
        { materialId: 'rm-4', materialName: 'Ácido Cítrico Anhidro', quantityConsumed: 60, unit: 'g', unitCost: 0.012, totalCost: 0.72 },
        { materialId: 'rm-5', materialName: 'Benzoato de Sodio', quantityConsumed: 24, unit: 'g', unitCost: 0.015, totalCost: 0.36 },
        { materialId: 'rm-6', materialName: 'Frasco Hexagonal 250g', quantityConsumed: 100, unit: 'unidades', unitCost: 0.32, totalCost: 32.00 },
        { materialId: 'rm-7', materialName: 'Tapa Twist-Off 58mm', quantityConsumed: 100, unit: 'unidades', unitCost: 0.09, totalCost: 9.00 },
        { materialId: 'rm-10', materialName: 'Etiqueta Adhesiva 250g', quantityConsumed: 100, unit: 'unidades', unitCost: 0.08, totalCost: 8.00 },
      ],
      directMaterialCost: 86.12,
      directLaborCost: 18.00, // 4 horas hombre
      indirectCost: 9.00,
      totalProductionCost: 113.12,
      unitCost: 1.13,
      operatorNotes: 'Brix final 65.5°, vacío verificado al 100%. Calidad óptima.',
    },
    {
      id: 'po-2',
      orderNumber: 'OP-2026-089',
      recipeId: 'rec-2',
      recipeName: 'Fórmula Institucional: Guayaba 1000g (Lote 20 unidades)',
      flavor: 'Guayaba Criolla',
      presentation: 'grande_1000g',
      targetUnits: 40,
      batchCount: 2,
      lotNumber: 'L-GUAY-2610-B',
      status: 'en_proceso',
      salesOrderId: 'so-2',
      customerName: 'Bocadillos La Tradición Real',
      startDate: '2026-10-06',
      consumedMaterials: [
        { materialId: 'rm-1', materialName: 'Guayaba Roja Criolla', quantityConsumed: 24, unit: 'kg', unitCost: 1.25, totalCost: 30.00 },
        { materialId: 'rm-2', materialName: 'Azúcar Blanca Refinada', quantityConsumed: 21, unit: 'kg', unitCost: 0.95, totalCost: 19.95 },
        { materialId: 'rm-3', materialName: 'Pectina Cítrica HM', quantityConsumed: 200, unit: 'g', unitCost: 0.038, totalCost: 7.60 },
        { materialId: 'rm-4', materialName: 'Ácido Cítrico Anhidro', quantityConsumed: 90, unit: 'g', unitCost: 0.012, totalCost: 1.08 },
        { materialId: 'rm-5', materialName: 'Benzoato de Sodio', quantityConsumed: 40, unit: 'g', unitCost: 0.015, totalCost: 0.60 },
        { materialId: 'rm-8', materialName: 'Frasco Cilíndrico 1000g', quantityConsumed: 40, unit: 'unidades', unitCost: 0.68, totalCost: 27.20 },
        { materialId: 'rm-9', materialName: 'Tapa Twist-Off 82mm', quantityConsumed: 40, unit: 'unidades', unitCost: 0.16, totalCost: 6.40 },
        { materialId: 'rm-11', materialName: 'Etiqueta Institucional 1000g', quantityConsumed: 40, unit: 'unidades', unitCost: 0.12, totalCost: 4.80 },
      ],
      directMaterialCost: 97.63,
      directLaborCost: 22.50,
      indirectCost: 13.60,
      totalProductionCost: 133.73,
      unitCost: 3.34,
      operatorNotes: 'En cocción en marmita #2. Entrega programada para 08 de octubre.',
    },
  ];

  const employees: Employee[] = [
    {
      id: 'emp-1',
      fullName: 'José Gregorio Escalona',
      nationalId: 'V-16.782.901',
      roleTitle: 'Maestro Pailero y Cocción',
      weeklyBaseSalary: 75.00,
      hourlyRate: 1.88,
      status: 'activo',
    },
    {
      id: 'emp-2',
      fullName: 'Yelitza Coromoto Blanco',
      nationalId: 'V-19.345.112',
      roleTitle: 'Operaria de Selección y Despulpado',
      weeklyBaseSalary: 60.00,
      hourlyRate: 1.50,
      status: 'activo',
    },
    {
      id: 'emp-3',
      fullName: 'Miguel Ángel Duarte',
      nationalId: 'V-22.109.874',
      roleTitle: 'Auxiliar de Envasado y Empaque',
      weeklyBaseSalary: 55.00,
      hourlyRate: 1.38,
      status: 'activo',
    },
  ];

  const payrollWeeks: PayrollWeek[] = [
    {
      id: 'pw-36',
      weekNumber: 36,
      year: 2026,
      startDate: '2026-08-31',
      endDate: '2026-09-06',
      isActiveProduction: true,
      payments: [
        { employeeId: 'emp-1', employeeName: 'José Gregorio Escalona', roleTitle: 'Maestro Pailero', baseAmount: 75.00, productionBonus: 15.00, deductions: 2.00, netPaid: 88.00 },
        { employeeId: 'emp-2', employeeName: 'Yelitza Blanco', roleTitle: 'Operaria de Selección', baseAmount: 60.00, productionBonus: 10.00, deductions: 1.50, netPaid: 68.50 },
        { employeeId: 'emp-3', employeeName: 'Miguel Duarte', roleTitle: 'Auxiliar de Envasado', baseAmount: 55.00, productionBonus: 10.00, deductions: 1.50, netPaid: 63.50 },
      ],
      totalPayrollPaid: 220.00,
      fixedAbsorptionCost: 0,
      notes: 'Semana de alta producción para abastecer panaderías.',
    },
    {
      id: 'pw-37',
      weekNumber: 37,
      year: 2026,
      startDate: '2026-09-07',
      endDate: '2026-09-13',
      isActiveProduction: true,
      payments: [
        { employeeId: 'emp-1', employeeName: 'José Gregorio Escalona', roleTitle: 'Maestro Pailero', baseAmount: 75.00, productionBonus: 12.00, deductions: 2.00, netPaid: 85.00 },
        { employeeId: 'emp-2', employeeName: 'Yelitza Blanco', roleTitle: 'Operaria de Selección', baseAmount: 60.00, productionBonus: 8.00, deductions: 1.50, netPaid: 66.50 },
        { employeeId: 'emp-3', employeeName: 'Miguel Duarte', roleTitle: 'Auxiliar de Envasado', baseAmount: 55.00, productionBonus: 8.00, deductions: 1.50, netPaid: 61.50 },
      ],
      totalPayrollPaid: 213.00,
      fixedAbsorptionCost: 0,
      notes: 'Lotes de presentación pequeña de guayaba completados.',
    },
    {
      id: 'pw-38',
      weekNumber: 38,
      year: 2026,
      startDate: '2026-09-14',
      endDate: '2026-09-20',
      isActiveProduction: false, // ¡SEMANA INACTIVA!
      inactivityReason: 'mantenimiento_preventivo',
      payments: [
        { employeeId: 'emp-1', employeeName: 'José Gregorio Escalona', roleTitle: 'Maestro Pailero', baseAmount: 75.00, productionBonus: 0, deductions: 2.00, netPaid: 73.00 },
        { employeeId: 'emp-2', employeeName: 'Yelitza Blanco', roleTitle: 'Operaria de Selección', baseAmount: 60.00, productionBonus: 0, deductions: 1.50, netPaid: 58.50 },
        { employeeId: 'emp-3', employeeName: 'Miguel Duarte', roleTitle: 'Auxiliar de Envasado', baseAmount: 55.00, productionBonus: 0, deductions: 1.50, netPaid: 53.50 },
      ],
      totalPayrollPaid: 185.00,
      fixedAbsorptionCost: 185.00, // Nómina pagada íntegra sin producción: Costo fijo no absorbido
      notes: 'SEMANA INACTIVA: Mantenimiento general de marmitas, pulido de pailas de cobre y desinfección profunda.',
    },
    {
      id: 'pw-39',
      weekNumber: 39,
      year: 2026,
      startDate: '2026-09-21',
      endDate: '2026-09-27',
      isActiveProduction: false, // ¡SEMANA INACTIVA!
      inactivityReason: 'escasez_fruta',
      payments: [
        { employeeId: 'emp-1', employeeName: 'José Gregorio Escalona', roleTitle: 'Maestro Pailero', baseAmount: 75.00, productionBonus: 0, deductions: 2.00, netPaid: 73.00 },
        { employeeId: 'emp-2', employeeName: 'Yelitza Blanco', roleTitle: 'Operaria de Selección', baseAmount: 60.00, productionBonus: 0, deductions: 1.50, netPaid: 58.50 },
        { employeeId: 'emp-3', employeeName: 'Miguel Duarte', roleTitle: 'Auxiliar de Envasado', baseAmount: 55.00, productionBonus: 0, deductions: 1.50, netPaid: 53.50 },
      ],
      totalPayrollPaid: 185.00,
      fixedAbsorptionCost: 185.00,
      notes: 'SEMANA INACTIVA: Lluvias intensas en región productora retrasaron la cosecha de guayaba criolla fresca. Personal realizó inventario y etiquetado remanente.',
    },
    {
      id: 'pw-40',
      weekNumber: 40,
      year: 2026,
      startDate: '2026-09-28',
      endDate: '2026-10-04',
      isActiveProduction: true,
      payments: [
        { employeeId: 'emp-1', employeeName: 'José Gregorio Escalona', roleTitle: 'Maestro Pailero', baseAmount: 75.00, productionBonus: 18.00, deductions: 2.00, netPaid: 91.00 },
        { employeeId: 'emp-2', employeeName: 'Yelitza Blanco', roleTitle: 'Operaria de Selección', baseAmount: 60.00, productionBonus: 14.00, deductions: 1.50, netPaid: 72.50 },
        { employeeId: 'emp-3', employeeName: 'Miguel Duarte', roleTitle: 'Auxiliar de Envasado', baseAmount: 55.00, productionBonus: 12.00, deductions: 1.50, netPaid: 65.50 },
      ],
      totalPayrollPaid: 229.00,
      fixedAbsorptionCost: 0,
      notes: 'Reactivación a doble turno para recuperar pedidos acumulados tras veda de fruta.',
    },
  ];

  const fiscalSettings: FiscalSettings = {
    enabled: true,
    companyName: 'Mermeladas Artesanales del Valle C.A.',
    companyTaxId: 'J-40899231-0',
    fiscalAddress: 'Carretera Nacional Sector La Vega, Galpón PulpaCraft #4, Edo. Aragua',
    taxRatePercent: 16.0,
    invoicePrefix: 'FISC-',
    nextInvoiceNumber: 402,
    authorizationCode: 'SENIAT-PROV-2026-00914',
    printNotes: 'Contribuyente Ordinario. Retención de IVA aplicable según normativa fiscal vigente.',
  };

  const inventoryMovements: InventoryMovement[] = [
    {
      id: 'mov-1',
      materialId: 'rm-1',
      materialName: 'Guayaba Roja Criolla',
      type: 'entrada',
      quantity: 100,
      costPerUnit: 1.25,
      totalCost: 125.00,
      referenceDoc: 'Guía de Despacho Valle #881',
      date: '2026-10-02',
      performedBy: 'Yelitza Blanco',
    },
    {
      id: 'mov-2',
      materialId: 'rm-1',
      materialName: 'Guayaba Roja Criolla',
      type: 'salida_produccion',
      quantity: 15,
      costPerUnit: 1.25,
      totalCost: 18.75,
      referenceDoc: 'OP-2026-088 Lote L-GUAY-2610-A',
      date: '2026-10-03',
      performedBy: 'José Gregorio Escalona',
    },
  ];

  return {
    rawMaterials,
    inventoryMovements,
    finishedGoods,
    recipes,
    productionOrders,
    customers,
    salesOrders,
    deliveryNotes,
    employees,
    payrollWeeks,
    fiscalSettings,
  };
}

export class ErpDatabase {
  private state: DatabaseState;

  constructor() {
    this.state = createInitialDatabase();
  }

  public reset(): DatabaseState {
    this.state = createInitialDatabase();
    return this.state;
  }

  // --- RAW MATERIALS ---
  public getRawMaterials(): RawMaterial[] {
    return this.state.rawMaterials;
  }

  public addRawMaterial(mat: Omit<RawMaterial, 'id'>): RawMaterial {
    const newMat: RawMaterial = {
      ...mat,
      id: 'rm-' + Date.now(),
    };
    this.state.rawMaterials.push(newMat);
    return newMat;
  }

  public updateRawMaterial(id: string, updates: Partial<RawMaterial>): RawMaterial | null {
    const idx = this.state.rawMaterials.findIndex(m => m.id === id);
    if (idx === -1) return null;
    this.state.rawMaterials[idx] = { ...this.state.rawMaterials[idx], ...updates };
    return this.state.rawMaterials[idx];
  }

  public addInventoryMovement(mov: Omit<InventoryMovement, 'id'>): InventoryMovement {
    const newMov: InventoryMovement = {
      ...mov,
      id: 'mov-' + Date.now(),
    };
    this.state.inventoryMovements.unshift(newMov);

    // Update material currentStock
    const mat = this.state.rawMaterials.find(m => m.id === mov.materialId);
    if (mat) {
      if (mov.type === 'entrada') {
        mat.currentStock += mov.quantity;
        mat.lastRestockDate = mov.date;
      } else {
        mat.currentStock = Math.max(0, mat.currentStock - mov.quantity);
      }
    }
    return newMov;
  }

  public getMovements(): InventoryMovement[] {
    return this.state.inventoryMovements;
  }

  // --- FINISHED GOODS ---
  public getFinishedGoods(): FinishedGood[] {
    return this.state.finishedGoods;
  }

  public updateFinishedGood(id: string, updates: Partial<FinishedGood>): FinishedGood | null {
    const idx = this.state.finishedGoods.findIndex(f => f.id === id);
    if (idx === -1) return null;
    this.state.finishedGoods[idx] = { ...this.state.finishedGoods[idx], ...updates };
    return this.state.finishedGoods[idx];
  }

  // --- RECIPES (BOM) ---
  public getRecipes(): RecipeBOM[] {
    return this.state.recipes;
  }

  public addRecipe(rec: Omit<RecipeBOM, 'id'>): RecipeBOM {
    const newRec: RecipeBOM = {
      ...rec,
      id: 'rec-' + Date.now(),
    };
    this.state.recipes.push(newRec);
    return newRec;
  }

  // --- PRODUCTION ORDERS (MTO) ---
  public getProductionOrders(): ProductionOrder[] {
    return this.state.productionOrders;
  }

  public createProductionOrder(orderData: {
    recipeId: string;
    batchCount: number;
    salesOrderId?: string;
    lotNumber?: string;
    operatorNotes?: string;
  }): { order: ProductionOrder; missingMaterials: { name: string; required: number; available: number; unit: string }[] } {
    const recipe = this.state.recipes.find(r => r.id === orderData.recipeId);
    if (!recipe) {
      throw new Error('Receta no encontrada');
    }

    const batchCount = Math.max(1, orderData.batchCount || 1);
    const targetUnits = recipe.batchSizeUnits * batchCount;

    // Check material availability
    const missingMaterials: { name: string; required: number; available: number; unit: string }[] = [];
    const consumedMaterials = recipe.items.map(item => {
      const mat = this.state.rawMaterials.find(m => m.id === item.materialId);
      const reqQty = item.quantity * batchCount;
      const available = mat ? mat.currentStock : 0;
      if (available < reqQty) {
        missingMaterials.push({
          name: item.materialName,
          required: reqQty,
          available,
          unit: item.unit,
        });
      }
      const unitCost = mat ? mat.costPerUnit : 0;
      return {
        materialId: item.materialId,
        materialName: item.materialName,
        quantityConsumed: reqQty,
        unit: item.unit,
        unitCost,
        totalCost: Number((reqQty * unitCost).toFixed(2)),
      };
    });

    const directMaterialCost = consumedMaterials.reduce((acc, c) => acc + c.totalCost, 0);
    const directLaborCost = Number(((recipe.directLaborMinutes / 60) * 4.50 * batchCount).toFixed(2));
    const indirectCost = Number((recipe.estimatedUtilityCost * batchCount).toFixed(2));
    const totalProductionCost = Number((directMaterialCost + directLaborCost + indirectCost).toFixed(2));
    const unitCost = Number((totalProductionCost / targetUnits).toFixed(2));

    const nextOpNum = 'OP-2026-0' + (this.state.productionOrders.length + 90);
    const autoLot = orderData.lotNumber || `L-GUA-${Date.now().toString().slice(-4)}`;

    let custName = undefined;
    if (orderData.salesOrderId) {
      const so = this.state.salesOrders.find(s => s.id === orderData.salesOrderId);
      if (so) {
        custName = so.customerName;
        so.productionOrderId = undefined; // will link below
      }
    }

    const newOrder: ProductionOrder = {
      id: 'po-' + Date.now(),
      orderNumber: nextOpNum,
      recipeId: recipe.id,
      recipeName: recipe.name,
      flavor: recipe.flavor,
      presentation: recipe.presentation,
      targetUnits,
      batchCount,
      lotNumber: autoLot,
      status: 'planificada',
      salesOrderId: orderData.salesOrderId,
      customerName: custName,
      startDate: new Date().toISOString().slice(0, 10),
      consumedMaterials,
      directMaterialCost,
      directLaborCost,
      indirectCost,
      totalProductionCost,
      unitCost,
      operatorNotes: orderData.operatorNotes || '',
    };

    this.state.productionOrders.unshift(newOrder);

    if (orderData.salesOrderId) {
      const so = this.state.salesOrders.find(s => s.id === orderData.salesOrderId);
      if (so) {
        so.productionOrderId = newOrder.id;
        so.status = 'en_produccion';
      }
    }

    return { order: newOrder, missingMaterials };
  }

  public processProductionOrder(orderId: string): { success: boolean; message: string; order: ProductionOrder } {
    const order = this.state.productionOrders.find(o => o.id === orderId);
    if (!order) throw new Error('Orden no encontrada');
    if (order.status === 'completada') throw new Error('Esta orden ya fue completada');

    // 1. Discount raw materials atomically
    for (const item of order.consumedMaterials) {
      const mat = this.state.rawMaterials.find(m => m.id === item.materialId);
      if (mat) {
        mat.currentStock = Math.max(0, mat.currentStock - item.quantityConsumed);
      }
      this.state.inventoryMovements.unshift({
        id: 'mov-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        materialId: item.materialId,
        materialName: item.materialName,
        type: 'salida_produccion',
        quantity: item.quantityConsumed,
        costPerUnit: item.unitCost,
        totalCost: item.totalCost,
        referenceDoc: `${order.orderNumber} Lote ${order.lotNumber}`,
        date: new Date().toISOString().slice(0, 10),
        performedBy: 'Sistema MRP / Operador de Paila',
      });
    }

    // 2. Increase finished goods inventory
    const fg = this.state.finishedGoods.find(f => f.presentation === order.presentation && f.flavor === order.flavor);
    if (fg) {
      fg.stockUnits += order.targetUnits;
      fg.availableUnits = fg.stockUnits - fg.reservedUnits;
      fg.baseCost = order.unitCost;
    }

    // 3. Mark complete
    order.status = 'completada';
    order.completionDate = new Date().toISOString().slice(0, 10);

    // 4. Update sales order if linked
    if (order.salesOrderId) {
      const so = this.state.salesOrders.find(s => s.id === order.salesOrderId);
      if (so) {
        so.status = 'listo_despacho';
      }
    }

    return {
      success: true,
      message: `Orden ${order.orderNumber} procesada exitosamente. Se descontaron los insumos del BOM y se ingresaron ${order.targetUnits} unidades de producto terminado al inventario (Lote: ${order.lotNumber}).`,
      order,
    };
  }

  // --- CUSTOMERS ---
  public getCustomers(): Customer[] {
    return this.state.customers;
  }

  public addCustomer(cust: Omit<Customer, 'id'>): Customer {
    const newCust: Customer = {
      ...cust,
      id: 'cust-' + Date.now(),
    };
    this.state.customers.push(newCust);
    return newCust;
  }

  // --- SALES ORDERS ---
  public getSalesOrders(): SalesOrder[] {
    return this.state.salesOrders;
  }

  public addSalesOrder(data: Omit<SalesOrder, 'id' | 'orderNumber' | 'hasDeliveryNote'>): SalesOrder {
    const nextNum = 'PED-2026-0' + (this.state.salesOrders.length + 44);
    const newOrder: SalesOrder = {
      ...data,
      id: 'so-' + Date.now(),
      orderNumber: nextNum,
      hasDeliveryNote: false,
    };
    this.state.salesOrders.unshift(newOrder);

    // Reserve finished goods if available
    for (const item of newOrder.items) {
      const fg = this.state.finishedGoods.find(f => f.id === item.finishedGoodId);
      if (fg) {
        fg.reservedUnits += item.quantity;
        fg.availableUnits = Math.max(0, fg.stockUnits - fg.reservedUnits);
      }
    }

    return newOrder;
  }

  public updateSalesOrderStatus(id: string, status: SalesOrder['status']): SalesOrder | null {
    const order = this.state.salesOrders.find(s => s.id === id);
    if (!order) return null;
    order.status = status;
    return order;
  }

  // --- DELIVERY NOTES ---
  public getDeliveryNotes(): DeliveryNote[] {
    return this.state.deliveryNotes;
  }

  public createDeliveryNote(salesOrderId: string, transporter = 'Vehículo de Distribución Planta'): DeliveryNote {
    const so = this.state.salesOrders.find(s => s.id === salesOrderId);
    if (!so) throw new Error('Pedido de venta no encontrado');

    const nextNoteNum = 'NE-000' + (this.state.deliveryNotes.length + 125);
    const cust = this.state.customers.find(c => c.id === so.customerId);

    const items = so.items.map(item => {
      // Find lot from linked PO or finished goods
      let lot = 'L-GUAY-2610-ACT';
      if (so.productionOrderId) {
        const po = this.state.productionOrders.find(p => p.id === so.productionOrderId);
        if (po) lot = po.lotNumber;
      }
      return {
        description: `Mermelada Artesanal de ${item.flavor}`,
        presentationLabel: item.presentationLabel,
        quantity: item.quantity,
        lotNumber: lot,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
      };
    });

    const newNote: DeliveryNote = {
      id: 'dn-' + Date.now(),
      noteNumber: nextNoteNum,
      salesOrderId: so.id,
      salesOrderNumber: so.orderNumber,
      customerName: so.customerName,
      customerTaxId: so.customerTaxId,
      customerAddress: cust ? cust.address : 'Dirección Fiscal',
      customerPhone: cust ? cust.phone : '',
      dispatchDate: new Date().toISOString().slice(0, 16).replace('T', ' '),
      items,
      subtotal: so.subtotal,
      taxIncluded: true,
      taxAmount: so.taxAmount,
      total: so.total,
      transporter,
      status: 'emitida',
      observations: 'Despacho verificado por control de calidad. Conserve en lugar fresco y seco una vez abierto.',
    };

    this.state.deliveryNotes.unshift(newNote);

    // Deduct physical inventory & unreserve
    for (const item of so.items) {
      const fg = this.state.finishedGoods.find(f => f.id === item.finishedGoodId);
      if (fg) {
        fg.stockUnits = Math.max(0, fg.stockUnits - item.quantity);
        fg.reservedUnits = Math.max(0, fg.reservedUnits - item.quantity);
        fg.availableUnits = Math.max(0, fg.stockUnits - fg.reservedUnits);
      }
    }

    so.hasDeliveryNote = true;
    so.deliveryNoteNumber = nextNoteNum;
    so.status = 'despachado';

    return newNote;
  }

  // --- PAYROLL & INACTIVE WEEKS ---
  public getPayrollWeeks(): PayrollWeek[] {
    return this.state.payrollWeeks;
  }

  public getEmployees(): Employee[] {
    return this.state.employees;
  }

  public addPayrollWeek(weekData: Omit<PayrollWeek, 'id'>): PayrollWeek {
    const newWeek: PayrollWeek = {
      ...weekData,
      id: 'pw-' + Date.now(),
    };
    this.state.payrollWeeks.unshift(newWeek);
    return newWeek;
  }

  public addEmployee(emp: Omit<Employee, 'id'>): Employee {
    const newEmp: Employee = {
      ...emp,
      id: 'emp-' + Date.now(),
    };
    this.state.employees.push(newEmp);
    return newEmp;
  }

  // --- FISCAL SETTINGS ---
  public getFiscalSettings(): FiscalSettings {
    return this.state.fiscalSettings;
  }

  public updateFiscalSettings(settings: Partial<FiscalSettings>): FiscalSettings {
    this.state.fiscalSettings = { ...this.state.fiscalSettings, ...settings };
    return this.state.fiscalSettings;
  }

  // --- COSTING ANALYSIS & INTELLIGENCE ---
  public getCostStructure(): CostStructureAnalysis {
    const inactiveWeeks = this.state.payrollWeeks.filter(w => !w.isActiveProduction);
    const unabsorbedFixedCostYTD = inactiveWeeks.reduce((acc, w) => acc + w.fixedAbsorptionCost, 0);

    const activeWeeks = this.state.payrollWeeks.filter(w => w.isActiveProduction);
    const avgWeeklyLabor = activeWeeks.length
      ? activeWeeks.reduce((acc, w) => acc + w.totalPayrollPaid, 0) / activeWeeks.length
      : 200;

    // Prorated inactive weeks penalty across production batches
    const inactiveWeekPenaltyPerBatch = activeWeeks.length > 0 ? unabsorbedFixedCostYTD / (activeWeeks.length * 4) : 0;

    return {
      directMaterialsCostAverage: 1.15,
      directLaborWeeklyAverage: Number(avgWeeklyLabor.toFixed(2)),
      indirectManufacturingCostsWeekly: 65.00,
      inactiveWeeksCountYTD: inactiveWeeks.length,
      unabsorbedFixedCostYTD: Number(unabsorbedFixedCostYTD.toFixed(2)),
      costBreakdownByPresentation: [
        {
          presentation: 'pequena_250g',
          label: 'Frasco de Vidrio 250g',
          directMaterial: 0.35, // pulpa fruta, azúcar, químicos
          directPackaging: 0.49, // frasco, tapa, etiqueta
          directLabor: 0.18,
          cifAllocation: Number((0.09 + inactiveWeekPenaltyPerBatch * 0.01).toFixed(2)), // incluye absorción de semanas paradas
          totalUnitCost: 1.11,
          suggestedWholesalePrice: 1.65,
          suggestedRetailPrice: 2.20,
          marginWholesalePercent: 32.7,
          marginRetailPercent: 49.5,
        },
        {
          presentation: 'grande_1000g',
          label: 'Frasco Institucional 1000g (1 kg)',
          directMaterial: 1.48, // pulpa fruta, azúcar, aditivos
          directPackaging: 0.96, // frasco 1kg, tapa grande, etiqueta
          directLabor: 0.56,
          cifAllocation: Number((0.34 + inactiveWeekPenaltyPerBatch * 0.04).toFixed(2)),
          totalUnitCost: 3.34,
          suggestedWholesalePrice: 5.50,
          suggestedRetailPrice: 7.20,
          marginWholesalePercent: 39.3,
          marginRetailPercent: 53.6,
        },
      ],
    };
  }

  // --- DASHBOARD METRICS ---
  public getDashboardMetrics() {
    const monthlySales: MonthlySalesStat[] = [
      {
        month: 'Agosto',
        year: 2026,
        smallUnitsSold: 320,
        largeUnitsSold: 85,
        totalRevenue: 320 * 1.65 + 85 * 5.50, // 528 + 467.5 = 995.5
        grossMargin: 995.5 - (320 * 1.11 + 85 * 3.34),
        grossMarginPercent: 35.8,
      },
      {
        month: 'Septiembre',
        year: 2026,
        smallUnitsSold: 240, // menor por semanas paradas (semanas 38 y 39)
        largeUnitsSold: 60,
        totalRevenue: 240 * 1.65 + 60 * 5.50, // 396 + 330 = 726
        grossMargin: 726 - (240 * 1.11 + 60 * 3.34) - 370, // impacto directo de semanas inactivas
        grossMarginPercent: 12.4, // rentabilidad deprimida por costos fijos no absorbidos
      },
      {
        month: 'Octubre (En curso)',
        year: 2026,
        smallUnitsSold: 184,
        largeUnitsSold: 52,
        totalRevenue: 184 * 1.65 + 52 * 5.50, // 303.6 + 286 = 589.6
        grossMargin: 589.6 - (184 * 1.11 + 52 * 3.34),
        grossMarginPercent: 37.2,
      },
    ];

    const lowStockMaterials = this.state.rawMaterials.filter(m => m.currentStock <= m.minStock);
    const pendingOrdersCount = this.state.salesOrders.filter(o => o.status === 'pendiente' || o.status === 'en_produccion').length;
    const activeProductionCount = this.state.productionOrders.filter(p => p.status === 'en_proceso' || p.status === 'planificada').length;

    const totalStockValuation = this.state.rawMaterials.reduce((acc, m) => acc + (m.currentStock * m.costPerUnit), 0) +
      this.state.finishedGoods.reduce((acc, f) => acc + (f.stockUnits * f.baseCost), 0);

    return {
      monthlySales,
      lowStockMaterials,
      pendingOrdersCount,
      activeProductionCount,
      totalStockValuation: Number(totalStockValuation.toFixed(2)),
      costStructure: this.getCostStructure(),
    };
  }
}

export const dbInstance = new ErpDatabase();
