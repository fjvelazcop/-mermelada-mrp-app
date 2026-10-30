# Plan Issue #11 — SENIAT / Facturación Fiscal Venezolana

**Fecha:** 29/10/2026
**Estado actual:** Sistema operativo con backup, seguridad y túnel. Sin facturación fiscal activa.
**Vigencia normativa:** SNAT/2011/0071 vence el **18/04/2027**; nuevo régimen SNAT/2026/00093 entra en vigor el **19/04/2027**.

---

## 1. Supuestos de operación (del issue)

- ✅ Empresa **contribuyente ordinario de IVA** (no sujeto pasivo especial).
- ✅ **No** es agente de retención de IVA ni de ISLR.
- ✅ **No** está obligada aún a emitir factura digital (hay tiempo hasta el cronograma SENIAT).
- ✅ Opera en una sola sede y con una sola serie de facturación.
- ✅ Maneja precios en USD con cobro/referencia en Bs. a tasa BCV.

> Si cualquiera de estos supuestos cambia, se activan los módulos ocultos de la sección 7.

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
| 3.1 | Razón social, RIF, dirección fiscal, teléfono y correo del emisor **configurables y congelados por documento** al momento de emitir | ✅ Configurables en Configuración → Datos Fiscales (solo admin); ⬜ falta congelar por documento |
| 3.1 | Actividad económica y régimen tributario (ordinario / especial) | ✅ Configurables en Configuración → Datos Fiscales |
| 3.1 | Datos de la sucursal o establecimiento cuando aplique | ✅ Nombre y dirección de sucursal configurables |
| 3.1 | **RIF de clientes y proveedores como campo obligatorio en los maestros** | ✅ Implementado (`Customer.taxId`, `Supplier.taxId`) |
| 3.1 | **Configuración fiscal base: alícuota IVA, prefijo y próximo número de factura** | ✅ UI completa en Configuración → Datos Fiscales (solo admin) |
| 3.2 | **Número de factura consecutivo, único e irrepetible por serie** | ⬜ Pendiente (entidad `FiscalInvoice`) |
| 3.2 | **Número de control consecutivo e irrepetible**, independiente del número de factura | ⬜ Pendiente |
| 3.2 | Fecha y hora de emisión | ⬜ Pendiente |
| 3.2 | Nombre/razón social y RIF del emisor | ⬜ Pendiente (parte de 3.1) |
| 3.2 | Nombre/razón social y RIF del adquirente; NIT cuando posea | ⬜ Pendiente |
| 3.2 | Descripción de bienes/servicios, cantidad, precio unitario y monto total | ⬜ Pendiente |
| 3.2 | **IVA discriminado por alícuota, separado del precio** | ⬜ Pendiente (base: `taxAmount`, `taxAmountBs`) |
| 3.2 | Total en letras y en números | ⬜ Pendiente |
| 3.2 | Condición de venta (contado/crédito) y forma de pago | ⬜ Pendiente |
| 3.2 | Leyendas obligatorias: "sin derecho a crédito fiscal", régimen aplicable, etc. | ⬜ Pendiente |
| 3.2 | **Anulación con motivo, usuario, fecha/hora y trazabilidad; el número no se reutiliza** | ⬜ Pendiente |
| 3.2 | **Reimpresión marcada como DUPLICADO** | ⬜ Pendiente |
| 3.2 | PDF/representación gráfica con todos los requisitos y sin datos truncados | ⬜ Pendiente |
| 3.2 | **Registro inmutable: una factura emitida no se edita ni se elimina; se corrige con nota de crédito/débito** | ⬜ Pendiente |
| 3.4 | Libro de Ventas mensual: fecha, número de factura, número de control, RIF y nombre del cliente, monto exento, base imponible por alícuota, IVA, total, operaciones a crédito, notas de crédito/débito y retenciones recibidas | ❌ No existe |
| 3.4 | Libro de Compras mensual: fecha, número de factura, número de control, RIF y nombre del proveedor, monto exento, base imponible, IVA, total, retención de IVA practicada y condición de crédito fiscal | ⚠️ Base parcial (gastos tienen RIF, documento, alícuota, IVA y `fiscalBookEligible`, pero no hay libro ni cierre) |
| 3.4 | Libro Diario: asientos cronológicos con cuenta, débito, crédito y referencia al documento | ❌ No existe |
| 3.4 | Libro Mayor: movimientos y saldo por cuenta | ❌ No existe |
| 3.4 | Libro de Inventarios y Balances: inventario inicial, movimientos, inventario final y balances | ⚠️ Base parcial |
| 3.4 | Balance General / Estado de Resultados | ❌ No existe |
| 3.6 | Facturación digital: generación en formato/estructura exigida (XML/JSON), firma electrónica/sellado, transmisión al SENIAT, manejo de acuses, modo contingencia, adaptación a SNAT/2026/00093 | ❌ No existe |
| 3.7 | Auditoría inmutable de emisión, anulación, reimpresión y cambio de configuración fiscal | ⬜ Base (audit_logs), falta validación fiscal |
| 3.7 | Roles y permisos: emisión, anulación, cierre de período, configuración fiscal | ⬜ Pendiente |
| 3.7 | Validaciones de RIF y de datos obligatorios antes de emitir | ⬜ Pendiente |
| 3.7 | Multi-moneda con tasa BCV registrada por operación | ✅ Base (`exchangeRateUsed`) |
| 3.7 | Evaluación de IGTF en pagos en divisas, si aplica | ⬜ Pendiente |

Estados: ✅ = implementado · ⚠️ = parcial · ❌ = faltante.

---

## 4. Matriz de libros requeridos vs. estado actual

| Libro / registro | Base legal | Estado | Brecha principal |
|---|---|---|---|
| Libro de Ventas | Ley IVA art. 56 y Reglamento | ❌ No existe | Entidad de factura fiscal + agregación mensual + export |
| Libro de Compras | Ley IVA art. 56 y Reglamento | ⚠️ Base parcial | Gastos ya tienen RIF, documento, alícuota, IVA y `fiscalBookEligible`, pero no hay libro ni cierre |
| Libro Diario | Código de Comercio art. 32 | ❌ No existe | Plan de cuentas y asientos contables |
| Libro Mayor | Código de Comercio art. 32 | ❌ No existe | Derivación desde el Diario |
| Libro de Inventarios y Balances | Código de Comercio art. 32 | ⚠️ Base parcial | Existe inventario operativo, falta libro formal y balances |
| Balance General / Estado de Resultados | Código de Comercio / práctica contable | ❌ No existe | Contabilidad general y cuentas |
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

### P0 — Imprescindible para arrancar a facturar (antes de la primera emisión real)

1. **Entidad `FiscalInvoice`** con serie, número de factura y número de control consecutivos e irrepetibles, snapshot de emisor y cliente, leyendas y estado (`emitida`, `anulada`).
2. **Emisión inmutable + PDF fiscal** con todos los requisitos del art. 57 y SNAT/2011/0071; reimpresión marcada como duplicado.
3. **Anulación controlada** con motivo, usuario, fecha/hora y auditoría; el consecutivo no se reutiliza.
4. **Notas de crédito y débito** vinculadas a la factura, con serie propia y efecto en libros.
5. **Libro de Ventas y Libro de Compras** mensuales, con cierre de período y exportación.
6. **Validaciones previas a emitir**: RIF, datos del cliente, alícuota, moneda, tasa BCV y numeración disponible.
7. **Permisos fiscales**: quién emite, quién anula y quién cierra el mes.
8. **Pruebas de regresión fiscal** y conciliación automática (ventas vs. IVA vs. libros).

### P1 — Necesario para contabilidad formal y retenciones

9. **Plan de cuentas y asientos contables automáticos**.
10. **Libro Diario y Libro Mayor**.
11. **Libro de Inventarios y Balances**, Balance General y Estado de Resultados.
12. **Retención de IVA** + comprobante (si la empresa es agente de retención).
13. **Retención de ISLR** + comprobante (si la empresa es agente de retención).
14. **Registro de retenciones recibidas** de clientes.

### P2 — Antes del 19/04/2027

15. **Facturación digital**: formato, firma, transmisión, acuses y contingencia.
16. **Migración a SNAT/2026/00093** (nuevos campos y reglas).
17. **Verificación pública** del documento (QR/código).
18. **IGTF** y cualquier régimen especial aplicable.
19. **Sujetos pasivos especiales** y libros adicionales, si la empresa es calificada.

---

## 7. Módulos que pueden quedar ocultos hasta autorización

> **Regla de UX:** si un módulo está oculto, no debe aparecer en el menú ni en rutas directas; si se muestra una vista previa, debe indicar claramente "En habilitación" y no permitir emitir documentos.

| Módulo | ¿Ocultar al inicio? | Motivo | Cómo habilitarlo |
|---|---|---|---|
| Facturación digital / transmisión SENIAT | Sí | Requiere autorización, firma y ambiente de pruebas | Flag `fiscal.digital_invoicing` + credenciales + pruebas certificadas |
| Retención de IVA y comprobantes | Sí | Solo si la empresa es agente de retención | Flag `fiscal.vat_withholding` + designación del SENIAT |
| Retención de ISLR y comprobantes | Sí | Solo si la empresa es agente de retención | Flag `fiscal.islr_withholding` + designación |
| Sujetos pasivos especiales | Sí | Solo si la empresa es calificada como SPE | Flag `fiscal.special_taxpayer` + calificación |
| Libro Diario / Mayor / Balances avanzados | Sí | Útil, pero no bloquea la facturación inicial | Flag `accounting.full_ledger` cuando exista plan de cuentas |
| Multi-serie / multi-sucursal | Sí | Complejiza numeración y libros | Flag `fiscal.multi_series` + configuración de series |
| Portal de clientes / autofacturación | Sí | No es obligatorio para arrancar | Flag `fiscal.customer_portal` |
| Nómina fiscal / ISLR de empleados | Sí | Depende de obligaciones laborales específicas | Flag `payroll.fiscal` |
| Activos fijos y depreciación | Sí | Requerido para ISLR, no para facturar | Flag `accounting.fixed_assets` |

Los flags se guardarán en una tabla `fiscal_features` con auditoría de activación (quién, cuándo, bajo qué rol).

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

---

## 9. Criterios de aceptación

- [ ] Toda factura emitida tiene número y número de control únicos; no existen huecos sin registro de anulación.
- [ ] Una factura emitida no puede editarse ni eliminarse; solo anularse o ajustarse con nota.
- [ ] El PDF fiscal contiene todos los requisitos legales y se marca como duplicado al reimprimir.
- [ ] El Libro de Ventas del mes cuadra contra la suma de facturas y notas.
- [ ] El Libro de Compras del mes cuadra contra gastos con `fiscalBookEligible` y documentos válidos.
- [ ] El cierre mensual bloquea emisión y edición en períodos cerrados.
- [ ] Los exportes son reproducibles y auditables (usuario, fecha, filtros y hash/total de control).
- [ ] Los módulos ocultos no son accesibles por URL directa ni por API sin permiso.
- [ ] Existen pruebas de regresión para alícuotas, exentos, no sujetos, redondeos, anulaciones y notas.
- [ ] No hay RIF, credenciales ni secretos hardcodeados.
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

1. ✅ Configuración fiscal en la UI (`FiscalSettings`): razón social, RIF, dirección, teléfono, correo, actividad económica, régimen, sucursal, alícuota IVA, serie, prefijo y numeración, retenciones, SPE, formato de libros y tratamiento de órdenes históricas. Pendiente: confirmar los datos reales con el contador.
2. Hacer el RIF obligatorio en los formularios de cliente y proveedor (ya es campo en la base, falta validación en UI).
3. Implementar la entidad `FiscalInvoice` con los campos mínimos: `serie`, `invoiceNumber`, `controlNumber`, `emitterSnapshot`, `customerSnapshot`, `status`, `issuedAt`, `annulledAt`, `annulledBy`.
4. Añadir las validaciones previas a la creación de pedidos de venta: RIF del cliente, alícuota configurada, numeración disponible.
5. Crear las pruebas de regresión para los casos borde: alícuotas, exentos, no sujetos, redondeos, anulaciones.

---

## 13. Transición a SNAT/2026/00093

- **Fecha clave:** 19/04/2027.
- **Cambios esperados:** nuevos campos en la factura, posible cambio de formato de PDF, actualización de validaciones, nueva estructura para la facturación digital.
- **Acción:** tener la entidad `FiscalInvoice` diseñada con fields opcionales/extensibles y un script de migración que mapee los datos de SNAT/2011/0071 al nuevo formato.
- **Validación:** el sistema debe poder operar bajo ambos regímenes durante un periodo de superposición (ener-feb 2027) sin romper la emisión.