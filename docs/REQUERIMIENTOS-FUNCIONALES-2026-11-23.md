# Requerimientos Funcionales — Mermelada ERP

| Campo | Valor |
|---|---|
| Versión | 2 (fechada) |
| Fecha | 23/11/2026 |
| Estado | BORRADOR/PRUEBA – PROVISIONAL – PENDIENTE DE VALIDACIÓN CONTABLE (#13) |
| Ámbito | ERP/MRP *Make-to-Order* de producción de mermeladas artesanales/industriales |
| Versión anterior | Tabla RF de la pestaña *Análisis de Requerimientos* en `src/app/features/architecture-docs/architecture-docs.html` (se conserva sin modificaciones) |

Esta versión recoge los requerimientos funcionales vigentes en la interfaz y añade los
correspondientes a las mejoras de contabilidad provisional implementadas bajo el issue #13.
No implica la validación contable integral del cierre #13 ni autorización del SENIAT:
UT, IVA e IGTF ya están validados, mientras que el régimen ordinario/no SPE y el resto
del cierre permanecen pendientes de ratificación documental.

## Estado de decisiones fiscales y tasa de cambio (23/11/2026)

| Concepto | Estado | Regla vigente |
|---|---|---|
| Unidad Tributaria | **Validado** | Bs. 43,00 desde `02/06/2025` (Providencia SNAT/2025/000048, G.O. 43.140). |
| IVA | **Validado** | 16 % desde `2020-01-01` (Decreto 4.079, G.O. 41.788). Exento 0 % / 8 % y conceptos ISLR **por precisar si aplica**. |
| IGTF | **Validado** | No aplica según la condición actual (sin pagos en divisa, contribuyente ordinario); `IGTF=false`. |
| Régimen ordinario / no SPE | **Pendiente por el contador** | Falta ratificación documental con instrumento y fecha. No enciende retenciones. |
| Cierre #13 (reconversión, corte, aportes, saldos, formatos y firmas) | **Borrador / provisional** | Sin efecto en libros ni estados financieros definitivos. |
| Política de tasa de cambio | **Validada** | Tasa del documento = actual (`currentUsd`) o histórica por fecha de guardado; visible y editable en UI; fallback a la tasa actual si no se especifica o modifica. |

---

## Requerimientos funcionales vigentes (RF-01 a RF-11)

| ID | Módulo | Descripción Funcional | Criterio de Aceptación |
|---|---|---|---|
| RF-01 | Inventario Materia Prima | Registro de materias primas categorizadas: Fruta fresca, Químicos/Aditivos (Pectina cítrica HM, Ácido cítrico, Benzoato de sodio) y Empaques (Frascos 250g, Frascos 1000g, Tapas twist-off, Etiquetas). | Stock actualizado en tiempo real con alertas si cae por debajo del mínimo de seguridad. |
| RF-02 | Inventario Producto Terminado | Control de existencias de mermelada terminada según presentación: Frasco 250 g, Frasco 300 g, Frasco 1000 g, Galón 5 kg, Caja 6 kg, Cuñete 20 kg y Caja 20 kg. Discriminación entre stock físico, reservado para pedidos y libre despacho. | Trazabilidad por número de lote único asignado al envasar. |
| RF-03 | Recetas & BOM | Definición de fórmulas maestras (Bill of Materials) indicando cantidades exactas de insumos requeridas por lote (ej. lote de 50 frascos de 250g o lote de 20 frascos de 1kg), minutos de cocción y costo de servicios. | Comprobación automática de viabilidad de insumos antes de autorizar cocción. |
| RF-04 | Descuento Atómico en Cocción | Al procesar una Orden de Producción, descontar automáticamente las cantidades exactas de materia prima del almacén e ingresar el producto terminado correspondiente. | Operación transaccional ACID: no descuenta materias primas si falla el registro del lote. |
| RF-05 | Estructura de Costeo Dinámico | Cálculo de costo unitario por presentación segregando: Materiales directos + Empaques directos + Mano de obra en paila + Costos Indirectos (CIF) + Prorrateo de semanas inactivas. | Sugerencia de Precios Mayorista (30-40% margen) y Minorista (45-55% margen). |
| RF-06 | Gestión de Semanas Inactivas | Registro de periodos sin producción (causas: mantenimiento preventivo, veda/escasez de fruta, acumulación de inventario) contabilizando la nómina pagada como costo fijo no absorbido. | Visualización del impacto directo en el margen bruto anual acumulado. |
| RF-07 | Ventas & Despacho MTO | Registro de pedidos de clientes comerciales. Si no hay suficiente stock libre en almacén, generar con un clic la Orden de Producción correspondiente ligada al pedido. | Trazabilidad desde el pedido comercial hasta la orden de cocción. |
| RF-08 | Emisión de Notas de Entrega | Generación e impresión formal de Notas de Entrega con membrete de la empresa, RIF, número consecutivo, desglose de ítems, lotes despachados y espacios de firma de recibido. | Descuenta el producto terminado del almacén al emitir la nota física. |
| RF-09 | Preparación Fiscal | Estructura base para Facturación Fiscal: número de control, alícuotas de IVA parametrizables, prefijo fiscal y datos de imprenta digital para homologación tributaria. | Diseño modular desacoplado listo para conexión con impresoras o APIs fiscales. |
| RF-10 | Reportes & Dashboard | Comparativo mensual de ventas (Agosto, Septiembre, Octubre), rotación de inventario por presentación (Pequeña 250g vs Grande 1000g) y reporte de rentabilidad por lote. | Cálculo de margen neto y ratios de rentabilidad en tiempo real. |
| RF-11 | Monitoreo Cambiario Venezuela (USD / USDT) | Registro diario y visible en dashboard de cotizaciones USD (BCV oficial) y USDT (Binance P2P / mercado). Sincronización continua y búsqueda activa durante las dos ventanas de actualización financiera en Venezuela: 8:00 AM a 10:00 AM y 12:30 PM a 3:00 PM. | Almacenamiento de histórico diario, cálculo de variaciones porcentuales y calculadora rápida de conversión a Bolívares. |

---

## Requerimientos incorporados en la versión 2 (issue #13)

| ID | Módulo | Descripción Funcional | Criterio de Aceptación |
|---|---|---|---|
| RF-12 | Contabilidad · Plan de cuentas | Alta de cuentas contables genéricas con clasificación `banco`, `caja` u `otra`, datos de banco opcionales (código SUDEBAN, nombre del banco, número de cuenta y moneda `USD`/`Bs`/`AMBAS`), conservando las 35 cuentas provisionales base. | La cuenta queda disponible en los selectores de asientos y se persiste de forma aditiva en la DB v16 (sin crear v17). |
| RF-13 | Contabilidad · Saldo provisional | Captura y edición de un saldo provisional en USD por cuenta, con fecha de actualización y nota de conciliación, marcado explícitamente como referencia #13. | No genera asiento ni modifica libros o estados financieros; el saldo contable continúa calculándose solo con asientos confirmados. |
| RF-14 | Contabilidad · Asientos automáticos | Los asientos automáticos de inventario (compras de contado), gastos, cobros de ventas y pagos de CxP utilizan la cuenta contable elegida en cada transacción. | Los registros legacy sin cuenta usan `1.01.01` (Caja) o `1.01.02` (Bancos); una cuenta inexistente, inactiva o que no sea de activo se rechaza con `422 ACCOUNT_NOT_AVAILABLE`. Los asientos automáticos quedan `confirmado`; los manuales se crean en `borrador`. |
| RF-15 | Inventario · CxP | La condición de pago distingue `contado` (sin deuda) de `crédito` (genera o actualiza la CxP de forma idempotente con proveedor y factura). El origen se distingue entre *Compra Inventario* y *Gasto / CxP Manual*. | Se devuelve `409 DUPLICATE_PAYABLE` al repetir un documento y `422 MISSING_CREDIT_REFERENCE` si falta proveedor o factura. La relación sobrevive al reinicio mediante `inventoryMovements[].payableId`. |
| RF-16 | Ayuda contextual y auditoría | Panel de ayuda `help_outline` en todos los módulos, badges «BORRADOR #13» y explicación de la diferencia entre saldo provisional y saldo contable. | El Libro de Inventario usa el plan VEN-NIF de 167 cuentas y deja de ser borrador; los demás libros se rotulan `BORRADOR/PRUEBA – PROVISIONAL – PENDIENTE DE VALIDACIÓN CONTABLE (#13)`. La cadena hash está activada con backfill histórico; altas, confirmaciones y anulaciones quedan registradas en auditoría. |
| RF-17 | Contabilidad · Libro de Inventario VEN-NIF | Valoración de materias primas y producto terminado con cuentas definitivas VEN-NIF (`1.1.04.02` y `1.1.04.04`), conservando la correlación de los códigos provisionales `1.03.01`/`1.03.02`. | El libro se genera como definitivo, con firmantes **Contador y socios**. Paginación `1 al 99` y firma al final de cada cierre quedan pendientes de definir. |
| RF-18 | Contabilidad · Cadena hash | Cada asiento almacena `previousHash`, `entryHash` y `hashSequence` calculados con SHA-256 sobre número, fecha, descripción, estado, montos, tasa y líneas. | El backfill cubre asientos históricos; altas, confirmaciones y anulaciones re-encadenan la cadena. Los endpoints `GET /api/accounting/hash/verify` y `POST /api/accounting/hash/rebuild` permiten verificar y reparar; el evento queda en la bitácora. |
| RF-19 | Inventario · Proveedor habitual del insumo | Alta de insumo con autocomplete de proveedor, condición de pago derivada de `paymentTerms`, días y fecha de pago ajustables, y persistencia en el maestro. | Si el proveedor tiene días de crédito se muestra **Crédito** con vencimiento; si no, solo **Contado**. El modal usa `max-w-4xl` y scroll interno sin reducir zoom ni escala. |

### Notas de alcance de la versión 2

- MP-348 (*Guayaba Miguel Villalobos*) y MP-611 (*Cesta de guayaba*) permanecen en `0,00 kg`, sin
  histórico que afecte compras, gastos ni libros; se conservan código, nombre y ficha.
- Nómina: con pagos registrados el operario se inactiva; sin pagos puede eliminarse
  (`409 EMPLOYEE_HAS_PAYMENTS` cuando corresponda). Las vacaciones excluyen al operario de nuevas semanas.
- La plantilla de producción usa la matriz como fuente única, con merma separada de «por asignar/envasar».
- No se activó facturación digital/SENIAT, retenciones de IVA/ISLR, IGTF ni régimen SPE.
  El catálogo fiscal es solo referencia de apoyo: la tasa general de IVA, la UT e IGTF están
  validados, pero no sustituyen la ratificación documental del régimen ni cierran el resto de #13.
  El issue #11 no ha sido publicado.
- Los formularios de documentos exponen la tasa Bs./USD de forma visible y editable. Por defecto
  toman la tasa actual o la histórica de la fecha de guardado; si el usuario no la modifica,
  se conserva ese valor con fallback a `currentUsd`. El equivalente en Bs. usa la tasa guardada
  en el documento, sin recalcular los importes en USD.
- Pasos 2–5: la planilla manual discrimina el insumo concreto de almidón/químico/ácido; el
  catálogo de presentaciones es editable (`/api/presentation-types`, migración v17); las recetas
  BOM y los productos terminados se dan de alta desde la interfaz, con baja lógica para estos
  últimos. Los códigos nuevos de presentación se documentan como `otra`, conservando etiqueta y
  peso. Todo se implementó de forma aditiva, sin tocar asientos, CxP, reglas fiscales ni el
  estado borrador/prueba #13.

---

## Verificación de esta versión (23/11/2026)

| Comprobación | Resultado |
|---|---|
| `npm run build` | Correcto |
| `npm run lint` | Correcto |
| `npm test -- --watch=false` | 19 archivos / 123 pruebas |
| `npm run test:server` | 22 archivos / 441 pruebas |
| Tasa en documentos | Visible y editable; actual/histórica por fecha con fallback a `currentUsd` (5 pruebas nuevas) |
| `git diff --check` | Sin hallazgos |
| PM2 `mermelada-erp` | `online`; `/api/health` → 200 |
| Columnas aditivas en DB | `accounts`, `inventory_movements`, `expenses`, `payable_payments` |
| Flags de Fase 0 | `vat_withholding_enabled=0`, `islr_withholding_enabled=0`, `digital_invoicing_enabled=0`, `tax_regime=ordinario` |
| MP-348 / MP-611 | `current_stock=0`, `last_restock_date` vacío |

---

## Pendientes de validación con el contador (#13)

IVA 16 %, UT Bs. 43,00 e IGTF no aplica ya están validados; lo que sigue pendiente es:

1. Ratificación documental del contribuyente **ordinario / no SPE**, con instrumento y fecha.
2. Precisar **si aplican** exento **0 %**, **8 %** y los conceptos ISLR del art. 9 (sustraendo y alícuotas).
3. Cuenta contable para **retenciones ISLR recibidas** de clientes SPE (`2.02.02` es solo para practicadas).
4. **Reconversión** de la figura jurídica y cotejo del acta constitutiva.
5. **Fecha de corte** y saldos de apertura: generales y por banco/clientes/proveedores.
6. Tratamiento **pago versus devengo**.
7. Formatos legales, paginación, firma y numeración de libro/página; conservación y auditoría.
8. Canal de facturación antes del **19/04/2027**. El plan VEN-NIF de 167 cuentas ya está incorporado y el Libro de Inventario lo usa; el resto de los libros siguen sobre el plan base mientras se ratifica el cierre.
9. La activación de la cadena hash fue autorizada: quedó activada con backfill y verificación. Lo pendiente es la firma al final de cada cierre y la paginación `1 al 99`, además de la ratificación documental de los firmantes.
10. Cierre formal de los comprobantes SPE y del Libro de Retenciones «SIN OPERACIONES».

Todo lo anterior se mantiene en modo **BORRADOR / PRUEBA** hasta la ratificación contable.

---

## Rutas de los documentos

- Anterior (sin cambios): `/home/fjvel/proyectos/mermelada/src/app/features/architecture-docs/architecture-docs.html`
- Nuevo (esta versión): `/home/fjvel/proyectos/mermelada/docs/REQUERIMIENTOS-FUNCIONALES-2026-11-23.md`
- Índice de documentación: `/home/fjvel/proyectos/mermelada/docs/README.md`
