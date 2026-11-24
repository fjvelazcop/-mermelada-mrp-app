import {AppModuleId} from '../models/erp.models';

/** Módulos de primer nivel y submódulos que pueden solicitar ayuda contextual. */
export type ModuleHelpKey =
  | AppModuleId
  | 'fiscal_invoices'
  | 'accounts_receivable'
  | 'accounts_payable'
  | 'fiscal_reference_values';

export interface ModuleHelpSection {
  title: string;
  bullets: string[];
}

export interface ModuleHelpContent {
  title: string;
  summary: string;
  sections: ModuleHelpSection[];
}

/** Contenido por defecto mientras se documenta un módulo nuevo. */
export const GENERIC_MODULE_HELP: ModuleHelpContent = {
  title: 'Ayuda del módulo',
  summary: 'Guía rápida de las acciones disponibles en esta pantalla.',
  sections: [
    {
      title: 'Qué puedes hacer',
      bullets: [
        'Consultar la información principal y usar los filtros de la barra superior.',
        'Registrar o editar datos según los permisos de tu rol.',
        'Exportar reportes cuando la acción de exportación esté habilitada.',
      ],
    },
    {
      title: 'Puntos de atención',
      bullets: [
        'Las acciones sensibles requieren permisos de administrador o master.',
        'Ante dudas sobre valores fiscales o contables, valida con el contador.',
      ],
    },
  ],
};

export const MODULE_HELP: Record<ModuleHelpKey, ModuleHelpContent> = {
  dashboard: {
    title: 'Tablero principal',
    summary: 'Vista rápida del estado de la fábrica y de los indicadores que requieren atención.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Revisar métricas de inventario, producción, ventas y cobros.',
          'Ver alertas de stock mínimo y lotes en curso.',
          'Consultar la cotización de USD y USDT vigente.',
        ],
      },
      {
        title: 'Según tu rol',
        bullets: [
          'El perfil operativo muestra solo órdenes en curso y tareas pendientes.',
          'Los roles con permiso de precios ven importes y cotizaciones.',
        ],
      },
    ],
  },
  inventory: {
    title: 'Inventario y materia prima',
    summary: 'Control de insumos, movimientos y trazabilidad de producto terminado.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Buscar insumos por código, nombre o proveedor y filtrar por categoría o alertas.',
          'Registrar entradas, consumos de cocción y ajustes de merma.',
          'Ver el historial de movimientos de un insumo con el botón Movimientos.',
          'Distinguir compras de contado y de crédito, con su CxP y vencimiento.',
          'Buscar el proveedor habitual de un insumo en el maestro y guardar su condición de pago y fecha de pago.',
        ],
      },
      {
        title: 'Flujo recomendado',
        bullets: [
          'Filtra por insumo u operación antes de revisar el historial.',
          'Usa el resumen para comparar entradas, consumo y merma neta.',
          'Exporta el listado si tu rol tiene permiso de exportación.',
        ],
      },
      {
        title: 'Puntos de atención',
        bullets: [
          'Los movimientos conservan razón social y RIF del proveedor cuando se registran con factura.',
          'Los asientos automáticos de inventario se confirman solos y alimentan Diario y Mayor; la presentación de libros sigue en borrador/prueba hasta validar #13.',
          'El Libro de Compras se alimenta al pagar la CxP (gasto fiscalmente elegible), no al registrar la entrada.',
        ],
      },
    ],
  },
  production: {
    title: 'Producción y recetas (BOM)',
    summary: 'Fórmulas maestras, órdenes Make-to-Order y descuento de insumos en cocción.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Consultar la matriz de unidades por marmita y la planilla manual multipresentación.',
          'Crear y ejecutar órdenes de producción con rendimiento configurable.',
          'Registrar planillas manuales sin procesar inventario cuando corresponda.',
        ],
      },
      {
        title: 'Flujo recomendado',
        bullets: [
          'Define la presentación y revisa los rendimientos antes de guardar.',
          'Ejecuta el lote para descontar insumos y generar el movimiento de inventario.',
          'Consulta el detalle de la orden para ver insumos consumidos.',
        ],
      },
      {
        title: 'Puntos de atención',
        bullets: [
          'Los supervisores de planta tienen permisos reducidos sobre precios.',
          'Las planillas manuales y los cálculos de mermelada están en modo borrador/prueba.',
        ],
      },
    ],
  },
  costing: {
    title: 'Estructura de Costos & Precios',
    summary: 'Simulador de costos por lote con materia prima, empaques, nómina y márgenes.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Calcular la estructura de costos para una presentación de 20 kg.',
          'Editar materia prima, empaques/envases, nómina de 10 trabajadores y gastos fijos.',
          'Alternar entre USD y Bolívares con la tasa vigente.',
          'Cargar el Preset Img 2 o el Lote 72 para partir de valores de referencia.',
          'Comparar márgenes de 20%, 25%, 30% y el margen personalizado.',
        ],
      },
      {
        title: 'Flujo recomendado',
        bullets: [
          'Elige la moneda en la barra superior.',
          'Carga un preset o ajusta los insumos y gastos según tu lote real.',
          'Revisa el rendimiento y la nómina antes de leer el precio sugerido.',
          'Exporta el reporte detallado si tu rol tiene permiso de exportación.',
        ],
      },
      {
        title: 'Puntos de atención',
        bullets: [
          'La exportación está disponible solo con el permiso costing.canExport.',
          'Los valores sin permiso de precios pueden mostrarse ocultos para ciertos roles.',
          'Los resultados apoyan la cotización; no generan asientos contables ni obligaciones fiscales.',
        ],
      },
      {
        title: 'Atajos y exportación',
        bullets: [
          'Preset Img 2 restaura los valores de referencia iniciales.',
          'Lote 72 precarga el escenario de 6 marmitas / 2.600 kg.',
          'Puedes exportar a PDF, Excel, CSV, imprimir o enviar por correo según permisos.',
        ],
      },
    ],
  },
  sales: {
    title: 'Ventas, despacho y facturación',
    summary: 'Pedidos Make-to-Order, notas de entrega, cobros y facturas fiscales.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Registrar pedidos y controlar saldos por cliente.',
          'Emitir notas de entrega y consultar el estado de la factura fiscal.',
          'Registrar cobros y revisar el historial de abonos de cada pedido.',
        ],
      },
      {
        title: 'Puntos de atención',
        bullets: [
          'Los consecutivos anulados no se reutilizan.',
          'La facturación digital sigue en modo preparación: no hay emisión real ni envío al SENIAT.',
        ],
      },
    ],
  },
  payroll: {
    title: 'Nómina semanal',
    summary: 'Pagos al personal de planta y control de semanas sin producción.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Registrar la nómina semanal y sus pagos en USD o Bolívares.',
          'Buscar operarios por nombre, cédula o cargo y filtrar por estado.',
          'Ver y exportar el historial individual de pagos (CSV, Excel o PDF).',
          'Dar de baja o marcar de vacaciones: ambos se excluyen de nuevas semanas.',
          'Eliminar solo operarios sin pagos registrados.',
          'Usar cargos existentes o crear uno nuevo en el alta de operarios.',
          'Consultar semanas activas y justificar semanas inactivas.',
          'Exportar el detalle para el área contable.',
        ],
      },
    ],
  },
  expenses: {
    title: 'Gastos y egresos operativos',
    summary: 'Clasificación de gastos, presupuesto por rubro y cuentas por pagar.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Registrar gastos por categoría y controlar el presupuesto mensual.',
          'Vincular gastos y movimientos de inventario al maestro de proveedores.',
          'Consultar facturas por liquidar y su antigüedad en Cuentas por pagar.',
        ],
      },
      {
        title: 'Puntos de atención',
        bullets: [
          'Las retenciones de IVA e ISLR están desactivadas por ser contribuyente ordinario.',
          'Los asientos automáticos de gastos se confirman solos; la presentación de libros sigue en borrador/prueba hasta validar #13.',
        ],
      },
    ],
  },
  accounting: {
    title: 'Contabilidad',
    summary: 'Plan de cuentas, asientos de doble entrada confirmados y períodos; libros en borrador/prueba hasta #13.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Consultar el plan base de 35 cuentas y crear cuentas adicionales con permiso, incluidas cuentas bancarias con su banco y número de cuenta.',
          'Capturar y editar un saldo provisional por cuenta como referencia de conciliación (#13), sin generar asiento.',
          'Gestionar la Apertura (#13): reconversión, fecha de corte, accionistas, saldos generales y por auxiliar en USD/Bs con tasa por línea, con cuadre en tiempo real y asiento siempre borrador.',
          'Elegir la cuenta de efectivo/banco en cobros, pagos CxP, gastos y compras de inventario para los asientos automáticos.',
          'Revisar asientos automáticos, crear asientos manuales y anular con motivo.',
          'Generar libros y reportes en modo BORRADOR / PRUEBA.',
        ],
      },
      {
        title: 'Puntos de atención',
        bullets: [
          'El plan de cuentas y las cuentas de control son provisionales hasta la validación contable (#13).',
          'El saldo provisional no es saldo contable: no alimenta libros ni estados financieros; las transacciones sin cuenta elegida siguen usando Caja (1.01.01) o Bancos (1.01.02).',
          'La apertura se guarda en borrador/provisional y su asiento no se puede confirmar sin autorización contable expresa; la cadena hash, retenciones y facturación digital permanecen apagadas.',
          'IVA 16 %, UT Bs. 43,00 e IGTF no aplica están validados; el régimen ordinario/no SPE requiere ratificación documental con fecha del contador.',
          'La tasa de los documentos es visible y editable: por defecto usa la actual o la de la fecha de guardado, con fallback a `currentUsd` si no se modifica.',
          'No hay cuenta dedicada a retenciones recibidas de clientes SPE; tampoco se han creado cuentas nuevas.',
        ],
      },
    ],
  },
  suppliers: {
    title: 'Directorio de proveedores',
    summary: 'Maestro de proveedores, datos fiscales y catálogo histórico de precios.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Registrar proveedores y mantener razón social, RIF y contactos.',
          'Clasificar proveedores por tipo y revisar su historial de precios.',
          'Seleccionar un proveedor desde gastos o movimientos de inventario.',
        ],
      },
    ],
  },
  supplier_types: {
    title: 'Tipos de proveedor',
    summary: 'Catálogo que clasifica a los proveedores del maestro.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Crear, editar, activar o desactivar tipos de proveedor con permiso.',
          'Asignar un color para identificar cada tipo en las listas.',
        ],
      },
    ],
  },
  material_categories: {
    title: 'Categorías de materia prima',
    summary: 'Catálogo usado por inventario y por el alta de insumos.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Crear, editar o desactivar categorías de insumos.',
          'Ver los cambios reflejados en los filtros y formularios de Inventario.',
        ],
      },
    ],
  },
  settings: {
    title: 'Configuración y permisología',
    summary: 'Usuarios, roles, parámetros fiscales y catálogos del sistema.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Gestionar usuarios, matriz de permisos y simulador de accesos.',
          'Consultar datos fiscales y el histórico de IVA/UT con permiso de administrador; IVA 16 %, UT Bs. 43,00 e IGTF no aplica están validados (#13).',
          'Administrar correos, tipos de proveedor, categorías y reset operativo.',
        ],
      },
      {
        title: 'Puntos de atención',
        bullets: [
          'Las opciones fiscales y catálogos se muestran solo a admin/master o a roles con permiso.',
          'El histórico de IVA/UT es soporte documental: no modifica cálculos; la ratificación del régimen ordinario/no SPE y el resto del cierre #13 siguen pendientes.',
        ],
      },
    ],
  },
  architecture: {
    title: 'Análisis técnico y arquitectura',
    summary: 'Documentación del sistema ERP/MRP y de sus decisiones técnicas.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Consultar requerimientos, arquitectura, modelos de datos y decisiones de implementación.',
          'Usar esta documentación como referencia para soporte y mantenimiento.',
        ],
      },
    ],
  },
  activation: {
    title: 'Activación y control de pagos',
    summary: 'Registro exclusivo del rol Master para activaciones, pagos y vigencias.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Registrar activaciones y pagos con sus referencias.',
          'Revisar vigencias y el historial de movimientos de activación.',
        ],
      },
      {
        title: 'Puntos de atención',
        bullets: ['Esta pantalla está restringida al rol Master.'],
      },
    ],
  },
  fiscal_invoices: {
    title: 'Facturación fiscal',
    summary: 'Facturas generadas al registrar pedidos, con control de consecutivos.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Consultar facturas emitidas y su documento de origen.',
          'Revisar notas de crédito o anulaciones y su referencia.',
        ],
      },
      {
        title: 'Puntos de atención',
        bullets: [
          'Los consecutivos anulados no se reutilizan.',
          'No hay transmisión al SENIAT: la facturación digital está en preparación.',
        ],
      },
    ],
  },
  accounts_receivable: {
    title: 'Cuentas por cobrar',
    summary: 'Saldos pendientes por pedido o factura, vencimientos y antigüedad.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Revisar saldos y filtrar por cliente o rango de fechas.',
          'Registrar cobros y abrir el historial de abonos de un pedido.',
        ],
      },
    ],
  },
  accounts_payable: {
    title: 'Cuentas por pagar',
    summary: 'Facturas de proveedores por liquidar, vencimientos y antigüedad.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Consultar obligaciones pendientes y su antigüedad.',
          'Registrar pagos y conservar la referencia del comprobante.',
        ],
      },
      {
        title: 'Puntos de atención',
        bullets: ['USD es la moneda canónica; los valores en Bs. se derivan de la tasa vigente.'],
      },
    ],
  },
  fiscal_reference_values: {
    title: 'IVA / UT e historial (#13)',
    summary: 'Valores con vigencia e instrumento: IVA/UT/IGTF validados y política de tasa por documento.',
    sections: [
      {
        title: 'Qué puedes hacer',
        bullets: [
          'Consultar el IVA 16% desde 2020-01-01 y la UT Bs. 43,00 desde 2025-06-02, ambos validados, e IGTF no aplica según la condición actual.',
          'Revisar la política de tasa validada: actual o histórica por fecha de guardado, visible y editable en los formularios, con fallback a currentUsd.',
          'Registrar cambios de vigencia, con cierre automático del registro anterior.',
          'Dar de baja valores con motivo, sin borrado físico.',
        ],
      },
      {
        title: 'Puntos de atención',
        bullets: [
          'Solo admin/master puede consultar o modificar estos parámetros.',
          'El régimen ordinario/no SPE sigue pendiente de ratificación documental con fecha; exento 0%, 8% y conceptos ISLR están por precisar si aplica.',
          'El histórico es soporte documental: no modifica cálculos ni activa retenciones, facturación digital ni cadena hash.',
        ],
      },
    ],
  },
};

/** Resuelve el contenido de ayuda de un módulo, con fallback genérico. */
export function getModuleHelp(module: ModuleHelpKey): ModuleHelpContent {
  return MODULE_HELP[module] ?? GENERIC_MODULE_HELP;
}
