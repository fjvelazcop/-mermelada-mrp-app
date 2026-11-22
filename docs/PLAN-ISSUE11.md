# Plan Issue #11 — SENIAT / Facturación Fiscal Venezolana

**Fecha:** 31/10/2026
**Estado actual:** El P0 técnico de emisión, notas, libros, cierre, exportación auditada y validaciones está implementado. Configuración → Datos Fiscales permite al administrador registrar obligaciones tributarias y consultar su historial. Pendientes: validación externa contable/normativa, definición del alcance P1/P2 y evidencia de aceptación. No implica autorización del SENIAT.
**Vigencia normativa:** SNAT/2011/0071 vence el **18/04/2027**; nuevo régimen SNAT/2026/00093 entra en vigor el **19/04/2027**.
**Definición de obligaciones:** issue [#13 — obligaciones tributarias y alcance contable con contador](https://github.com/fjvelazcop/-mermelada-mrp-app/issues/13).

---

## 1. Supuestos de operación (del issue)

- ⚠️ Se supone contribuyente ordinario de IVA, no sujeto pasivo especial; falta confirmación del contador.
- ⚠️ Se supone que no es agente de retención de IVA ni de ISLR; falta confirmación.
- ⚠️ Se supone que aún no está obligada a emitir factura digital; confirmar cronograma aplicable.
- ⚠️ Se supone que opera en una sola sede y con una sola serie de facturación.
- ⚠️ Se supone que maneja precios en USD con cobro/referencia en Bs. a tasa BCV.

> Estos supuestos son de planificación, no hechos verificados. Confirmarlos en el issue [#13](https://github.com/fjvelazcop/-mermelada-mrp-app/issues/13); no hay módulos de retención/digital/SPE habilitables hasta que se definan e implementen.

---

## 2. Marco normativo de referencia

| Norma | Materia | Vigencia / nota |
|---|---|---|
| **Ley de IVA (2020)**, arts. 56, 57 y 58 | Libros y registros; requisitos de la factura; notas de crédito y débito | Vigente |
| **Reglamento de la Ley de IVA (1999)** | Desarrollo de libros de compras/ventas y registros especiales | Vigente |
| **Código de Comercio**, arts. 32 a 38 | Libro Diario, Libro Mayor y Libro de Inventarios y Balances; forma de llevarlos | Vigente |
| **Providencia SNAT/2011/0071** | Normas generales de emisión de facturas, notas de débito/crédito, guías de despacho y máquinas fiscales | Vigente hasta el **18/04/2027** |
| **Providencia SNAT/2024/000102** | Facturación digital | Vigente; obligatoria según cronograma del SENIAT |
| **Providencia SNAT/2026/00084** | Deroga la SNAT/2024/000121 y reordena el régimen de homologación de sistemas de facturación | Verificar alcance |
| **Providencia SNAT/2026/00093** | Nuevas normas generales de emisión de facturas y documentos fiscales (G.O. 43.484 del 21/10/2026) | Entra en vigor el **19/04/2027**; deroga la SNAT/2011/0071 |
| **Providencia SNAT/2025/000054** | Retención de IVA | Aplica solo si la empresa es agente de retención |
| **Providencia SNAT/2026/00099** | Sujetos pasivos especiales | Aplica solo si la empresa es calificada como SPE |
| **Código Orgánico Tributario** | Deberes formales, conservación de documentos y prescripción | Vigente |
| **Ley de ISLR y Decreto de Retenciones** | Retenciones de ISLR y comprobantes | Aplica solo si la empresa es agente de retención |

**Hito crítico:** todo lo construido sobre SNAT/2011/0071 debe poder migrar a SNAT/2026/00093 antes de abril de 2027 (nuevos campos, formatos, validaciones y facturación digital).

---

## 3. Requisitos obligatorios del sistema (sección 3 del issue)

| # | Requisito | Estado actual |
|---|---|---|
| 3.1 | Razón social, RIF, dirección fiscal, teléfono y correo del emisor **configurables y congelados por documento** al momento de emitir | ✅ Configurables en Configuración → Datos Fiscales y copiados al snapshot de la factura |
| 3.1 | Actividad económica y régimen tributario (ordinario / especial) | ✅ Configurables en Configuración → Datos Fiscales |
| 3.1 | Datos de la sucursal o establecimiento cuando aplique | ✅ Nombre y dirección de sucursal configurables |
| 3.1 | **RIF de clientes y proveedores como campo obligatorio en los maestros** | ✅ Implementado (`Customer.taxId`, `Supplier.taxId`) |
| 3.1 | **Vinculación al maestro de proveedores desde gastos y movimientos de inventario** | ✅ Implementado (migración v13): autocomplete con alta rápida, `supplierId` y snapshots de razón social/RIF en `expenses` e `inventory_movements` |
| 3.1 | **Configuración fiscal base: alícuota IVA, prefijo y próximo número de factura** | ✅ UI completa en Configuración → Datos Fiscales (solo admin) |
| 3.2 | **Número de factura consecutivo, único e irrepetible por serie** | ✅ Persistido con restricción única por serie |
| 3.2 | **Número de control consecutivo e irrepetible**, independiente del número de factura | ✅ Persistido con restricción única por serie |
| 3.2 | Fecha y hora de emisión | ✅ Incluidas en la factura |
| 3.2 | Nombre/razón social y RIF del emisor | ✅ Copiados al snapshot |
| 3.2 | Nombre/razón social y RIF del adquirente; NIT cuando posea | ✅ Tomados de la ficha vigente y congelados en el snapshot; NIT opcional |
| 3.2 | Descripción de bienes/servicios, cantidad, precio unitario y monto total | ✅ Tomados del pedido |
| 3.2 | **IVA discriminado por alícuota, separado del precio** | ✅ Por línea admite varias alícuotas y tratamientos gravado/exento/no sujeto; redondeo por línea y desglose en consulta/impresión. Las tasas y leyendas deben validarse con un contador |
| 3.2 | Total en letras y en números | ✅ Total numérico y en letras en la representación imprimible |
| 3.2 | Condición de venta (contado/crédito) y forma de pago | ✅ Capturados en el pedido y guardados en la factura |
| 3.2 | Leyendas obligatorias: "sin derecho a crédito fiscal", régimen aplicable, etc. | ⚠️ Notas configurables; validar y completar leyendas con contador |
| 3.2 | **Anulación con motivo, usuario, fecha/hora y trazabilidad; el número no se reutiliza** | ✅ Anulación restringida a admin, auditada; números conservados |
| 3.2 | **Reimpresión marcada como DUPLICADO** | ✅ Contador persistente, marca de copia y auditoría |
| 3.2 | PDF/representación gráfica con todos los requisitos y sin datos truncados | ⚠️ Vista imprimible disponible; faltan datos y validación legal |
| 3.2 | **Registro inmutable: una factura emitida no se edita ni se elimina; se corrige con nota de crédito/débito** | ✅ Notas de crédito/débito vinculadas, con consecutivos propios, tope acreditable e impresión auditada |
| 3.4 | Libro de Ventas mensual: fecha, número de factura, número de control, RIF y nombre del cliente, monto exento, base imponible por alícuota, IVA, total, operaciones a crédito, notas de crédito/débito y retenciones recibidas | ⚠️ Reporte mensual, CSV, conciliación y cierre; campos/registros de retenciones recibidas dependen de la decisión contable |
| 3.4 | Libro de Compras mensual: fecha, número de factura, número de control, RIF y nombre del proveedor, monto exento, base imponible, IVA, total, retención de IVA practicada y condición de crédito fiscal | ⚠️ Reporte, CSV, conciliación y cierre; retenciones practicadas y crédito fiscal sujetos a validación contable |
| 3.4 | Libro Diario: asientos cronológicos con cuenta, débito, crédito y referencia al documento | ⚠️ Libro provisional generado desde asientos; formato pendiente de validación |
| 3.4 | Libro Mayor: movimientos y saldo por cuenta | ⚠️ Libro provisional derivado del Diario; formato pendiente de validación |
| 3.4 | Libro de Inventarios y Balances: inventario inicial, movimientos, inventario final y balances | ⚠️ Base parcial; Balance General y Libro de Inventario en modo BORRADOR/PRUEBA disponibles, saldos de apertura pendientes |
| 3.4 | Balance General / Estado de Resultados | ⚠️ Versiones provisionales generadas desde el plan base; pendientes de cuentas de control y validación |
| 3.6 | Facturación digital: generación en formato/estructura exigida (XML/JSON), firma electrónica/sellado, transmisión al SENIAT, manejo de acuses, modo contingencia, adaptación a SNAT/2026/00093 | ⚠️ Solo configuración de preparación (v15); sin emisión, firma, transmisión ni acuses |
| 3.7 | Auditoría de emisión, anulación, reimpresión y cambio de configuración fiscal | ✅ Eventos técnicos para emisión, anulación, impresión, exportación, cierre y cambios de configuración; el código de autorización no se guarda en el detalle del evento. Revisar retención/controles de acceso del log antes de producción |
| 3.7 | Roles y permisos: emisión, anulación, cierre de período, configuración fiscal | ✅ Emisión según permiso de ventas; anulación, notas y libros restringidos a admin |
| 3.7 | Validaciones de RIF y de datos obligatorios antes de emitir | ✅ RIF emisor/cliente, coincidencia con ficha, configuración, alícuota, tasa positiva y consecutivos disponibles |
| 3.7 | Multi-moneda con tasa BCV registrada por operación | ✅ USD como moneda operativa; equivalente Bs. calculado en servidor con tasa positiva conservada por pedido |
| 3.7 | Evaluación de IGTF en pagos en divisas, si aplica | ⬜ Pendiente |

Estados: ✅ = implementado · ⚠️ = parcial · ❌ = faltante.

---

## 4. Matriz de libros requeridos vs. estado actual

| Libro / registro | Base legal | Estado | Brecha principal |
|---|---|---|---|
| Libro de Ventas | Ley IVA art. 56 y Reglamento | ✅ Reporte mensual, CSV, conciliación y cierre | Validar formato y campos con contador |
| Libro de Compras | Ley IVA art. 56 y Reglamento | ✅ Reporte mensual basado en gastos elegibles, CSV, conciliación y cierre | Retenciones y requisitos de crédito fiscal dependen de validación contable |
| Libro Diario | Código de Comercio art. 32 | ⚠️ Provisional implementado | Falta formato/libro formal validado |
| Libro Mayor | Código de Comercio art. 32 | ⚠️ Provisional implementado | Derivado del Diario; falta formato validado |
| Libro de Inventarios y Balances | Código de Comercio art. 32 | ⚠️ Base parcial | Existen Libro de Inventario y Balance General en borrador/prueba; faltan saldos de apertura y formato formal |
| Balance General / Estado de Resultados | Código de Comercio / práctica contable | ⚠️ Provisional implementado | Cuentas de control y saldos iniciales pendientes |
| Comprobantes de retención IVA | SNAT/2025/000054 | ❌ No existe | Solo aplica si la empresa es agente |
| Comprobantes de retención ISLR | Ley ISLR / Decreto | ❌ No existe | Solo aplica si la empresa es agente |
| Registro de sujetos pasivos especiales | SNAT/2026/00099 | ❌ No existe | Solo aplica si la empresa es calificada |
| Documentos fiscales digitales | SNAT/2024/000102 y SNAT/2026/00093 | ❌ No existe | Integración, firma, transmisión y contingencia |

---

## 5. Lo que ya existe y sirve como base

| Capacidad | Dónde está | Qué aporta |
|---|---|---|
| Datos fiscales de la empresa | `FiscalSettings` + API `/api/fiscal-settings` | Razón social, RIF, dirección, alícuota, prefijo, consecutivo, notas de impresión |
| RIF de terceros | `Customer.taxId`, `Supplier.taxId` | Base para libros y validaciones |
| Cálculo de IVA | `SalesOrder.taxAmount`, `taxAmountBs` y configuración fiscal | Base imponible, IVA y total en USD/Bs |
| Tasa de cambio por operación | `SalesOrder.exchangeRateUsed` | Trazabilidad multi-moneda |
| Notas de entrega | `deliveryNoteNumber` + PDF | Guía de despacho operativa; falta requisito fiscal completo |
| Gastos con datos fiscales | `Expense` (`documentType`, `documentNumber`, `taxId`, `taxCategory`, `taxRatePercent`, `taxAmount*`, `fiscalBookEligible`) | Materia prima del Libro de Compras |
| Exportación | `export.utils.ts` (CSV, Excel, PDF) | Base para exportes de libros, pero sin formato oficial |
| Seguridad y trazabilidad | Auth/RBAC, audit log, backups | Soporta los controles transversales |
| Respaldo externo | `scripts/backup-remote.mjs` (S3/Drive) | Conservación y continuidad operativa |

---

## 6. Brechas priorizadas

### P0 — Base técnica implementada; validación externa pendiente antes de uso fiscal real

1. ✅ **Entidad `FiscalInvoice`** con serie, número de factura y número de control, snapshots de emisor/cliente y estado (`emitida`, `anulada`).
2. ⚠️ **Emisión e impresión:** snapshot, numeración, impuestos, representación imprimible y marca DUPLICADO implementados técnicamente; validar requisitos legales, leyendas y formato con contador antes de uso fiscal real.
3. ✅ **Anulación controlada** con motivo, usuario, fecha/hora y auditoría; el consecutivo no se reutiliza.
4. ✅ **Notas de crédito y débito** vinculadas a la factura, con serie propia y efecto en libros.
5. ✅ **Libro de Ventas y Libro de Compras** mensuales, con conciliación, cierre y exportación CSV auditada.
6. ✅ **Validaciones previas a emitir**: RIF del emisor/cliente, coincidencia con la ficha, alícuota, importes USD, tasa positiva y numeración libre.
7. ✅ **Permisos fiscales**: emisión según acceso de ventas; anulación, notas y cierre para admin.
8. ✅ **Pruebas de regresión fiscal** para tasas, tratamientos, consecutivos, notas, persistencia, libros y bloqueos de cierre.

### P1 — Definir con contador (#13); implementar solo obligaciones confirmadas

9. ✅ **Plan de cuentas y asientos contables automáticos** (Fase 1 implementada con plan base provisional; pendiente validación contable).
10. **Libro Diario y Libro Mayor**.
11. **Libro de Inventarios y Balances**, Balance General y Estado de Resultados.
12. **Retención de IVA** + comprobante (si la empresa es agente de retención).
13. **Retención de ISLR** + comprobante (si la empresa es agente de retención).
14. **Registro de retenciones recibidas** de clientes.

### P2 — Evaluación y preparación antes del 19/04/2027

15. **Facturación digital**: formato, firma, transmisión, acuses y contingencia.
16. **Migración a SNAT/2026/00093** (nuevos campos y reglas).
17. **Verificación pública** del documento (QR/código).
18. **IGTF** y cualquier régimen especial aplicable.
19. **Sujetos pasivos especiales** y libros adicionales, si la empresa es calificada.

---

## 7. Módulos potencialmente condicionados a autorización

> **Estado actual:** la mayoría de estos módulos especializados aún no están implementados. La Fase 1 incorporó un módulo `accounting` con RBAC propio y banderas en `fiscal_settings` (`accountingEnabled=true`, `vatWithholdingEnabled=false`, `islrWithholdingEnabled=false`), pero **no existe un sistema general de feature flags**. La autorización del backend y el rol deben proteger cualquier acción incluso si se oculta del menú.

| Módulo | ¿Ocultar al inicio? | Motivo | Cómo habilitarlo |
|---|---|---|---|
| Facturación digital / transmisión SENIAT | Sí | Requiere autorización, firma y ambiente de pruebas | Diseñar y habilitar solo tras confirmar requisitos y autorización; flag propuesto, no implementado |
| Retención de IVA y comprobantes | Sí | Solo si la empresa es agente de retención | Confirmar designación; flag propuesto, no implementado |
| Retención de ISLR y comprobantes | Sí | Solo si la empresa es agente de retención | Confirmar designación; flag propuesto, no implementado |
| Sujetos pasivos especiales | Sí | Solo si la empresa es calificada como SPE | Confirmar calificación y obligaciones; flag propuesto, no implementado |
| Libro Diario / Mayor / Balances avanzados | Parcial | El Diario base ya existe dentro del módulo `accounting` con RBAC propio; Mayor/Balances siguen bloqueados | Evaluar control de acceso al aprobar alcance; `accountingEnabled=true`, retenciones en `false` |
| Multi-serie / multi-sucursal | Sí | Complejiza numeración y libros | Evaluar si aplica; no implementado |
| Portal de clientes / autofacturación | Sí | No es obligatorio para arrancar | Evaluar en una iniciativa separada; no implementado |
| Nómina fiscal / ISLR de empleados | Sí | Depende de obligaciones laborales específicas | Confirmar obligaciones antes de definir alcance; no implementado |
| Activos fijos y depreciación | Sí | Depende del alcance contable/ISLR | Definir con contador; no implementado |

No existe actualmente una tabla `fiscal_features` ni un sistema general de flags. Si se requiere habilitación gradual, definirla por módulo con auditoría y autorización del backend antes de exponer la función.

---

## 8. Hoja de ruta propuesta

| Fase | Alcance | Resultado verificable |
|---|---|---|
| **Fase 0** | Normalizar datos fiscales y validaciones | RIF/alícuota/tasa validadas antes de emitir |
| **Fase 1** | Factura fiscal + PDF + anulación + notas de crédito/débito | Documento fiscal emitible y auditable |
| **Fase 2** | Libro de Ventas y Libro de Compras + cierre mensual + export | Libros conciliados con IVA del período |
| **Fase 3** | Contabilidad: plan de cuentas, Diario, Mayor, Inventarios y Balances | Estados financieros básicos |
| **Fase 4** | Retenciones IVA/ISLR (si aplica) | Comprobantes y conciliación |
| **Fase 5** | Facturación digital y migración a SNAT/2026/00093 | Emisión digital con acuses y contingencia |

> **Cada fase debe cerrar con:** pruebas unitarias e integración, cobertura de ramas ≥70 %, revisión de seguridad/RBAC y validación funcional con el área contable.

**Plan de ejecución ampliado (0–7).** Para separar el gate contable del código
se adoptó un plan de ocho hitos: **Fase 0** = validación de obligaciones con el
contador en #13; **Fase 1** = núcleo contable (plan de cuentas, asientos de
doble entrada, períodos y Diario); **Fases 2–7** = libros formales/Mayor,
retenciones, reportes PDF/Excel y digitalización. La Fase 1 quedó implementada
técnicamente; las siguientes no se activan hasta cerrar la Fase 0. Se avanzó
adicionalmente en los entregables no sensibles de libros: Diario formalizado,
Mayor, Balances, Estado de resultados, Libro de Inventario, Compras/Ventas
unificados, auxiliares, Caja/Banco y plantilla vacía de Retenciones. Todos se
marcan **BORRADOR / PRUEBA – PENDIENTE DE VALIDACIÓN CONTABLE (#13)** y no activan
impuestos ni consecutivos. La configuración de facturación digital (v15) también
queda como preparación, sin emisión real. Soportes:
`docs/MATRIZ-OBLIGACIONES-FISCALES.md`,
`docs/CUESTIONARIO-CONTADOR-ISSUE13.md` y `docs/PLANTILLAS-LIBROS.md`.

---

## 9. Criterios de aceptación

- [x] Toda factura emitida tiene número y número de control únicos; no existen huecos sin registro de anulación.
- [x] Una factura emitida no puede editarse ni eliminarse; solo anularse o ajustarse con nota.
- [ ] La representación imprimible contiene todos los requisitos legales; técnicamente se marca DUPLICADO, pero falta validación contable/normativa.
- [x] El Libro de Ventas del mes cuadra contra la suma de facturas y notas.
- [x] El Libro de Compras del mes cuadra contra gastos con `fiscalBookEligible` y documentos válidos.
- [x] El cierre mensual bloquea emisión y edición en períodos cerrados.
- [x] Los exportes son reproducibles y auditables (usuario, fecha, período, hash/total de control).
- [x] El administrador registra aplicabilidad, referencia, fecha y observaciones de obligaciones; el historial separado conserva cambios y usuario.
- [x] El rol administrador mantiene permisos absolutos; la lectura/escritura del registro de obligaciones exige admin en API.
- [ ] Los módulos especializados no están implementados; al desarrollarlos se deben proteger rutas y API por rol, no solo ocultar menús.
- [x] Existen pruebas de regresión para alícuotas, exentos, no sujetos, redondeos, anulaciones y notas.
- [x] Todo asiento contable está balanceado, usa cuentas activas y conserva auditoría al anularse.
- [x] Los asientos automáticos son idempotentes por `sourceType + sourceId` y un período cerrado bloquea nuevos asientos.
- [x] El módulo `accounting` tiene RBAC propio y las rutas `/api/payables*` permanecen bajo `expenses`.
- [x] Los libros contables provisionales se generan con metadatos, control, hash y firma; Retenciones permanece vacío y sin cálculo de impuestos.
- [ ] Completar revisión dedicada de RIF/datos fiscales, credenciales y secretos hardcodeados antes de certificar este criterio.
- [ ] La solución puede migrar a SNAT/2026/00093 sin rediseño de datos.

---

## 10. Riesgos y decisiones abiertas

1. **Calendario 2027:** la SNAT/2011/0071 vence el 18/04/2027. Si la facturación digital se posterga, el sistema debe al menos cumplir el nuevo formato general desde el 19/04/2027.
2. **Homologación:** la SNAT/2026/00084 cambia el régimen anterior. Confirmar con el SENIAT si el ERP requiere autorización, homologación o solo cumplimiento de requisitos.
3. **Formato de libros:** confirmar el formato exacto exigido para exportación (XLS/TXT/PDF) y si aplica carga en el portal del SENIAT.
4. **Retenciones:** no construir los módulos hasta confirmar si la empresa será agente de retención, para no activar obligaciones innecesarias.
5. **Asesoría externa:** validar el diseño de numeración, notas y libros con un contador antes de la primera emisión real.
6. **Datos históricos:** definir si las órdenes de venta existentes se migran a facturas o quedan solo como registro operativo.

---

## 11. Cómo se puede ayudar

- Confirmar el régimen tributario real de la empresa y si será agente de retención o sujeto pasivo especial.
- Aportar el formato exacto de libros que exige el contador o el SENIAT.
- Definir si se usará una serie única o varias series/sucursales.
- Validar las leyendas y el diseño del PDF fiscal con el área contable.

---

## 12. Próximo paso inmediato (Fase 0)

1. ✅ Configuración fiscal, datos de cliente/proveedor y validación inicial de RIF.
2. ✅ Entidad persistente `FiscalInvoice`, numeración única, snapshots, emisión y anulación auditada.
3. ✅ Consulta e impresión con marca de DUPLICADO para las reimpresiones.
4. ✅ Escenarios técnicos de IVA por línea (múltiples alícuotas, exentos/no sujetos) y pruebas de redondeo; falta validar tasas y leyendas con contador.
5. ✅ Notas de crédito/débito persistentes, imprimibles y auditadas, con consecutivos propios y validación del saldo acreditable.
6. ✅ Libros fiscales mensuales de Ventas/Compras, conciliación, exportación CSV auditada y cierre que bloquea cambios posteriores.
7. ✅ Validaciones previas a emitir de RIF, datos de cliente, tasa/alícuota, importes y consecutivos.
8. ⬜ Validar tasas, formatos, leyendas y obligaciones aplicables con un contador antes del uso fiscal real (issue #13).
9. ✅ Registrar en auditoría los cambios de configuración fiscal, identificando actor, rol, campos y valores modificados; el código de autorización se redacta.

---

## 13. Transición a SNAT/2026/00093

- **Fecha clave:** 19/04/2027.
- **Cambios esperados:** nuevos campos en la factura, posible cambio de formato de PDF, actualización de validaciones, nueva estructura para la facturación digital.
- **Acción:** tener la entidad `FiscalInvoice` diseñada con fields opcionales/extensibles y un script de migración que mapee los datos de SNAT/2011/0071 al nuevo formato.
- **Validación:** el sistema debe poder operar bajo ambos regímenes durante un periodo de superposición (ener-feb 2027) sin romper la emisión.

---

## 14. Plan de ejecución de pendientes

Actualizar este plan y marcar solo las tareas con evidencia técnica o validación documentada. La aprobación del contador no se sustituye con pruebas de software.

| Etapa | Trabajo y responsable | Salida / checklist |
|---|---|---|
| **A. Registro de decisiones** | Administrador registra en Configuración → Datos Fiscales → Obligaciones y validaciones la conclusión del contador, referencia, fecha y observaciones. | ✅ Interfaz e historial persistente con usuario/rol; solo admin consulta y edita. Registrar no activa módulos. |
| **B. Decisiones tributarias (#13)** | Administrador coordina y entrega datos; contador/especialista confirma régimen/SPE, retenciones, IGTF, facturación digital, leyes/leyendas y formato de libros. Luego registrar decisiones en la interfaz. | ⬜ Matriz de obligaciones fechada, con fundamento, evidencia y responsable; ⬜ validación de representación y libros |
| **C. Alcance P1** | Dirección + contador definen; desarrollo estima y ejecuta en issues derivados. **P1: contabilidad formal y retenciones, si corresponden.** | ✅ Núcleo Fase 1: plan base/asientos/Diario y RBAC; ⬜ validación del plan con contador; ⬜ Mayor; ⬜ Inventarios y Balances/estados financieros; ⬜ retenciones aplicables |
| **D. Preparación P2** | Administrador y especialista verifican normativa vigente; desarrollo implementa requisitos confirmados, pruebas, credenciales seguras y contingencia. | ⬜ requisitos oficiales trazados; ⬜ adaptación SNAT/2026/00093; ⬜ facturación digital y verificación antes del 19/04/2027 |
| **E. Liberación** | Administrador ejecuta pruebas operativas; contador revisa documentos/libros; dirección autoriza uso. | ⬜ pruebas UAT; ⬜ permisos por rol verificados; ⬜ respaldo/restauración probados; ⬜ aprobación externa y decisión de producción |

### Acciones por rol

- **Administrador del ERP:** coordina la revisión externa; no infiere ni cambia el régimen por su cuenta; configura datos fiscales solo después de validarlos, revisa el log de auditoría, corrige datos maestros, concilia exportes, no cierra un período con diferencias y mantiene backups.
- **Permisos:** el rol `admin` conserva permisos absolutos activos para todos los módulos/acciones; el API de obligaciones exige administrador para leer o guardar. Los demás roles no reciben permiso a la sección ni endpoints.
- **Personal con permiso de ventas:** verifica RIF, datos del cliente, precios, condición de venta y tasa antes de guardar el pedido que emite la factura; comunica cualquier bloqueo al administrador. No altera documentos emitidos.
- **Administrador que opera facturación fiscal:** tramita anulaciones con motivo, emite notas justificadas, revisa y exporta libros, concilia diferencias y cierra únicamente el período aprobado.
- **Contador/especialista externo:** valida obligaciones, tasas, leyendas, formatos y tratamiento contable; entrega decisiones documentadas. No se le atribuye un rol de aplicación salvo que la organización lo cree y autorice explícitamente.
- **Desarrollo / responsable técnico:** implementa solo decisiones aprobadas, agrega pruebas y controles de autorización en API, actualiza el checklist con evidencia y prepara los entregables P1/P2 como issues separados.

---

## 15. Ejecución de la Fase 1 (núcleo contable)

**Estado:** implementada y verificada técnicamente; **no equivale a validación
contable**. El plan de 35 cuentas y las cuentas de control de IVA/retenciones
son provisionales hasta que el contador confirme códigos, naturaleza,
saldo inicial y libros formales en #13.

| Entregable | Detalle |
|---|---|
| Migración v14 | Tablas `accounts`, `accounting_entries`, `accounting_entry_lines`, `accounting_periods`; columnas `accounting_enabled`, `vat_withholding_enabled`, `islr_withholding_enabled` en `fiscal_settings`. Respaldo previo: `backups/mermelada-2026-11-22T01-46-31-760Z.db`. |
| Plan de cuentas | 35 cuentas base sembradas en bases nuevas y existentes; CRUD de cuentas adicionales; cuentas base no eliminables. |
| Asientos | Validación de balanceo, cuenta activa y período abierto; estados `borrador`/`confirmado`/`anulado`; auditoría con motivo. Hooks automáticos en gasto, inventario, factura fiscal, cobro y pago CxP con idempotencia por `sourceType + sourceId`. |
| Períodos | Creación automática mensual, cierre y reapertura restringidos a admin/master. |
| API/OpenAPI | 8 paths `/api/accounting/*` y esquemas `Account`, `AccountInput`, `AccountUpdate`, `AccountingEntry`, `AccountingEntryLine`, `AccountingEntryInput`, `AccountingPeriod`. |
| UI | Módulo top-level **Contabilidad** con pestañas Plan de Cuentas, Asientos/Diario, Períodos y Retenciones bloqueada; export CSV/Excel del Diario. |
| RBAC | Módulo `accounting` con 84 filas de permisos (6 roles × 14 módulos). `/api/payables*` permanece bajo `expenses`. |
| Pruebas | `npm run build`, `npm run lint`, `npm test -- --watch=false` (74/74), `npm run test:server` (402/402). PM2 reiniciado; `/api/health` → 200; DB v14 con 35 cuentas. |

**Bloqueo activo:** `vatWithholdingEnabled=false` e `islrWithholdingEnabled=false`.
No se calculan retenciones, no se definen consecutivos oficiales y no se activa
facturación digital hasta la Fase 0.