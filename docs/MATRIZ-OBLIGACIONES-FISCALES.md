# Matriz de obligaciones fiscales — borrador de trabajo (Issue #13)

> **Estado:** PROVISIONAL. No es evidencia de cumplimiento ni sustituye la validación de un contador público.
> **Fecha del borrador:** 2026-11-22.
> **Banderas del sistema:** `accountingEnabled=true`, `vatWithholdingEnabled=false`, `islrWithholdingEnabled=false`, IGTF `false` (no aplica), `digitalInvoicingEnabled=false` (sin emisión real ni envío al SENIAT).

Esta matriz recoge lo declarado por el usuario y los campos que faltan. Las filas **PENDIENTE** no se inventan: deben completarse con documento, fecha de decisión y referencia normativa antes de cerrar la Fase 0.

| Obligación / decisión | Lo confirmado por el usuario | Fuente sugerida | Estado para cargar | Efecto en el sistema |
|---|---|---|---|---|
| Régimen tributario | «Somos ordinario», giro: **fabricación de mermelada** | LISLR / LIVA | **ADOPTADO** (`2026-11-22`, confirmado al contador `2026-11-25`); instrumento que remita se carga al historial | `taxRegime = 'ordinario'`, sin activar retenciones |
| Contribuyente especial | «No somos aún agente de retención ni de IVA ni de impuesto sobre la renta» | Designación SENIAT | **No aplica** mientras seamos ordinarios; solo se registra al dejar de serlo | Transición ordinario→especial marca `specialTaxpayer`, `vatWithholdingAgent` e `islrWithholdingAgent` como condición declarativa/auditable; **no enciende** `vatWithholdingEnabled` ni `islrWithholdingEnabled` |
| Retenciones IVA **practicadas** | Como ordinarios **no practicamos retenciones al pagar** | PA SNAT/2025/000054, G.O. 43.171, vigente 01/08/2025 | **NO APLICA** confirmado por el usuario | `vatWithholdingEnabled=false`; sin cálculo ni consecutivos |
| Retenciones IVA **recibidas** | Clientes SPE nos practican retenciones al cobrar | Misma norma; casilla 66 Forma 30 | **Solo registro/control documental** de comprobantes recibidos | Libro `retenciones` en modo borrador: dirección `recibida`, sin cálculo real hasta cerrar #13 |
| Retenciones ISLR **practicadas** | Como ordinarios **no practicamos retenciones al pagar** | Decreto 1.808 · Providencia 0095/2009 | **NO APLICA** confirmado por el usuario | `islrWithholdingEnabled=false`; sin cálculo ni consecutivos |
| Retenciones ISLR **recibidas** | Solo control de comprobantes que nos practiquen clientes SPE | Decreto 1.808; UT de referencia Bs. 43,00 | **Solo registro/control documental**; conceptos preventivos, aplicación formal, sustraendo y alícuotas pendientes | Sin cálculo; correlación VEN-NIF `1.1.05.04` ratificada (respuesta 10), sin adopción operativa ni cuentas nuevas |
| Parámetros reales de retención | «No sé» | Art. 9 Decreto 1.808; UT histórica | **PENDIENTE contador**: sustraendo y alícuotas por rubro/persona/vigencia; se cargan en `IVA / UT / ISLR e historial (#13)` | No se calculan montos ni consecutivos |
| Alícuota IVA | «El 16» para mermelada procesada/envasada | Decreto N° 4.079, G.O. N° 41.788 del 26/12/2019; Ley de IVA G.O.E. N° 6.507, arts. 27 y 63 | 16% desde `2020-01-01` como **referencia general**; exentos/8% en insumos o productos **pendientes de validación contable** | Histórico `fiscal_reference_values` (`kind=iva`); **no modifica** `taxRatePercent` hasta cerrar #13 |
| Unidad tributaria (UT) | Bs. 43,00 | Providencia N° SNAT/2025/000048, G.O. N° 43.140 del 02/06/2025 | Bs. 43,00 desde `2025-06-02` como **referencia**; conceptos de ISLR del giro pendientes | Histórico `fiscal_reference_values` (`kind=ut`); sin cálculo de retenciones |
| IGTF | «No recibimos pagos en divisa» y contribuyente ordinario | Ley IGTF G.O.E. 6.687 · Decreto 4.972 | **NO APLICA** confirmado por el usuario (`2026-11-22`) | `igtf=false`, sin campo de cálculo; revisar si cambia la condición de contribuyente o el manejo de divisas |
| Facturación digital | «Aún no tenemos licencia»; quiere migrar | PA SNAT/2024/000102 · PA 000121 · SNAT/2026/00093 | **Respondido por el contador (2026-11-24):** forma libre, imprenta autorizada, sin máquina fiscal ni facturación digital activa. **PENDIENTE** antes del 19/04/2027 | Preparación v15 implementada (proveedor, RIF, URL, ambiente, certificado etiqueta/serial, fecha prevista); **sin emisión ni envío al SENIAT**. Falta foto/talonario, licencia y datos del proveedor si se adopta digital |
| Declaración y entrega | «Todavía no» | Normativa vigente a validar | **PENDIENTE** | Sin obligación operativa activa |
| Referencia normativa y fecha de decisión | «No sé» | Gaceta Oficial / SENIAT | **PENDIENTE contador** | Campo obligatorio por fila antes de cerrar Fase 0 |
| Libros Compras/Ventas | «No tengo formato, ayúdame» | Reglamento LIVA arts. 70–78 | Plantilla provisional | Reutiliza `/api/fiscal-books` y el nuevo libro unificado |
| Diario / Mayor / Balances | «No tengo formatos» | Código de Comercio art. 32 · VEN-NIF BA Nº 0 | Plantilla provisional | Generados desde asientos de la Fase 1 |
| Libro de Retenciones | «Quiero tenerlo allí» | PA SNAT/2025/000054 · Decreto 1.808 | Plantilla vacía, sin cálculo | Devuelve «SIN OPERACIONES» |
| Caja / Banco | No mencionado, solicitado después | Criterio contable | Plantilla provisional | Auxiliar desde cobros, pagos y gastos |
| Auxiliares CxC / CxP | Solicitado | Criterio contable | Plantilla provisional | Derivado de módulos existentes |
| Plan de cuentas | «Plan de cuentas aprobado, estructuras de código y nivel de detalle» | 35 cuentas actuales vs. 167 VEN-NIF | Provisional | No sobrescribir el plan actual; ofrecer importador opcional |
| Libro de Inventario | Solicitado como borrador/prueba | Código de Comercio art. 32 | Plantilla **DEFINITIVA sobre VEN-NIF** | Valora stock con `1.1.04.02` Materia Prima y `1.1.04.04` Producto Terminado (correlación `1.03.01`/`1.03.02`); sin apertura auditada ni ajustes de cierre |
| Cuentas de control IVA/retenciones | «No tengo nada de eso» | Plan base Fase 1 + plantilla Bwealthics | **Provisionales para pruebas**: `1.01.01` Caja, `1.01.02` Bancos, `1.02.01` Clientes (CxC), `2.01.01` Proveedores (CxP), `1.03.01` Materia Prima, `1.03.02` Producto Terminado, `1.04.01` Crédito Fiscal IVA, `2.02.01` IVA por Pagar, `2.02.02` Retenciones por Pagar | No hay cuenta dedicada a **retenciones recibidas de ISLR**; se define con el contador al cerrar #13 |
| Saldos de apertura y fecha de corte | No indicados | Criterio contable | **PENDIENTE contador** | Los libros no incluyen apertura auditada ni corte definitivo |
| Formatos legales y numeración libro/página | No indicados | Código de Comercio / COT | **PENDIENTE contador** | Se mantienen formatos provisionales y numeración sin asignar |
| Firma de libros | «Sí, obviamente» | Criterio contable / COT 2020 | **Aprobada**: Contador y socios, al final de cada cierre (24/11/2026) | Se guarda en **Parámetros de libros** y se refleja en los libros; paginación `1 al 99` y numeración siguen pendientes |

## Decisiones cerradas en esta ronda (Fase 0 / #13)

- **IVA y UT son históricos**, no constantes: tabla `fiscal_reference_values` con `kind`, valor, unidad, vigencia, instrumento, gaceta, publicación, base legal, soporte y confirmación contable.
- **IVA 16%** vigente desde `2020-01-01` (Decreto N° 4.079 / G.O. N° 41.788 del 26/12/2019 y Ley de IVA G.O.E. N° 6.507).
- **UT Bs. 43,00** vigente desde `2025-06-02` (Providencia N° SNAT/2025/000048 / G.O. N° 43.140).
- **Solapamiento de vigencias:** cierre automático del registro anterior al día previo, con auditoría.
- **Uso:** solo referencia/consulta hasta validar y cerrar Fase 0 / #13; sin cambios en cálculos de facturas ni libros.
- **Baja:** anulación lógica con motivo, sin borrado físico.
- **Contribuyente ordinario**, giro **fabricación de mermelada**: no se practican retenciones de IVA ni de ISLR al pagar (`vatWithholdingEnabled=false`, `islrWithholdingEnabled=false`). Solo se contempla el **registro/control de comprobantes de retención recibidos de clientes SPE al cobrar**, sin cálculo real ni consecutivos.
- **IVA 16%** como referencia general para **mermelada procesada/envasada**; exentos y 8% en insumos/productos quedan **pendientes de validación del contador**. Los conceptos de ISLR del giro se mantienen **preventivamente** (respuesta 4); aplicación formal, sustraendo y alícuotas siguen **pendientes** (UT de referencia Bs. 43,00).
- **IGTF:** no aplica, `false`, con referencia G.O.E. 6.687 / Decreto 4.972 y nota de revisión futura si cambia la condición de contribuyente o el manejo de divisas.
- **SPE:** solo cuando deje de ser ordinario; retenciones siguen desactivadas.
- **Cuentas provisionales:** plan base Fase 1 (CxC, CxP, caja/bancos, inventario, IVA, retenciones por pagar) solo para pruebas y borradores. Las correlaciones VEN-NIF están ratificadas (respuesta 10) y el plan VEN-NIF de 167 cuentas es definitivo para el Libro de Inventario (respuesta 9), sin cuentas nuevas ni asientos modificados. Saldos de apertura, fecha de corte, numeración de libro/página y paginación `1 al 99` quedan pendientes de ajustar con el contador.
- **Facturación digital:** forma libre con imprenta autorizada, sin máquina fiscal ni facturación digital activa (respuesta 7); solo configuración/borrador, sin emisión real ni envío al SENIAT. Faltan foto/talonario, licencia y fecha de migración antes del 19/04/2027.
- **Libros:** columnas Bs. pareadas junto a cada importe USD; tasa guardada por documento con fallback a `currentUsd`; columnas finales `Tasa Bs./USD` y `Origen de la tasa`; CSV conservado como exportación auxiliar junto a XLSX y PDF.
- **Formatos aprobados:** XLSX/PDF y CSV auxiliar. **Orden de columnas aprobado.** **Firma al final de cada cierre confirmada** y guardable desde la interfaz. **Paginación `1 al 99` y numeración:** pendientes (respuesta 8).

## Catálogo de referencia provisional (Fase 0 / #13)

`GET /api/fiscal-reference-catalog` (solo admin/master) expone `FISCAL_REFERENCE_CATALOG` en **Configuración → IVA / UT / ISLR e historial (#13)**. Cada rubro ISLR tiene **Cargar en histórico** para registrar alícuota, sustraendo, vigencia e instrumento con auditoría. No calcula impuestos, no activa retenciones ni modifica facturas, asientos o libros.

- **IVA:** `16%` general por defecto para mermelada procesada/envasada, azúcar, empaques/envases y gastos generales; `0%` exento previsto para materias primas agrícolas primarias en estado natural «según aplique»; `8%` únicamente para supuestos taxativos confirmados por el contador. Compras/Ventas separan base imponible, exento e impuesto.
- **ISLR (Decreto 1.808):** catálogo de referencia de honorarios profesionales, servicios técnicos/especializados, obras y servicios en general, fletes/transporte, publicidad y arrendamientos **sin factura ni esquema formal aún**; distingue persona natural/jurídica, usa UT `Bs. 43,00` y mantiene los conceptos **preventivamente**. Aplicación formal, `sustraendo` y alícuotas del art. 9 siguen **pendientes del contador**.
- Las filas del catálogo quedan en `status='referencia'`, `confirmedByAccountant=false`. El catálogo es de lectura; los valores que indique el contador se gestionan con CRUD en `fiscal_reference_values` (`kind=islr`), con vigencia e instrumento, sin tocar el catálogo ni los cálculos.

**Cierre formal pendiente con el contador (#13):** sustraendo y alícuotas de los conceptos ISLR, validación de exentos/8%, foto/talonario y licencia de imprenta, migración antes del 19/04/2027, saldos de apertura, fecha de corte, numeración y paginación `1 al 99`, acta/reconversión, criterio pago vs. devengo, comprobantes SPE y conservación/bitácora. Ratificados: régimen ordinario/no SPE, correlaciones VEN-NIF (respuesta 10), formatos XLSX/PDF con CSV auxiliar, orden de columnas, firmantes y firma al final de cada cierre; sin activar módulos fiscales. Cada pendiente se carga en `IVA / UT / ISLR e historial (#13)`, `Registro de decisiones tributarias` o `Contabilidad → Apertura`.

## Estado del plan de cuentas (Fase 0 / #13)

Fuente verificada: tabla `accounts` de `data/mermelada.db` y
`src/server/erp-database.ts::DEFAULT_ACCOUNTS`. El plan base de la migración v14
tiene **35 cuentas**, todas `active=1`, `is_system=1`, sin cuentas
personalizadas nuevas. Se consultan en `GET /api/accounting/accounts` y en
**Contabilidad → Plan de cuentas**. Es un plan **provisional para
pruebas/borradores**: no se han creado cuentas nuevas ni modificado asientos
por los criterios de esta ronda.

| Grupo | Cantidad | Cuentas de control ya sembradas |
|---|---:|---|
| `1 ACTIVO` | 11 | `1.01.01` Caja · `1.01.02` Bancos · `1.02.01` Clientes (CxC) · `1.03.01` Materia Prima · `1.03.02` Producto Terminado · `1.04.01` Crédito Fiscal IVA |
| `2 PASIVO` | 6 | `2.01.01` Proveedores (CxP) · `2.02.01` IVA por Pagar · `2.02.02` Retenciones por Pagar |
| `3 PATRIMONIO` | 3 | `3.01` Capital Social · `3.02` Utilidades Acumuladas |
| `4 INGRESOS` | 5 | `4.01.01` Ventas Nacionales Gravadas · `4.02.01` Ventas Exentas Nacionales |
| `5 GASTOS` | 7 | Alquileres, Servicios, Transporte, Sueldos y Salarios |
| `6 COSTOS` | 3 | `6.01.01` Materia Prima Consumida |

**Falta por cargar o validar con el contador**
- Adopción operativa de las correlaciones VEN-NIF ratificadas para **retenciones
  recibidas** (`1.1.05.03` IVA, `1.1.05.04` ISLR; respuesta 10) de comprobantes
  que emitan clientes **Sujetos Pasivos Especiales al cobrar**. `2.02.02
  Retenciones por Pagar` corresponde a retenciones **practicadas**, no a recibidas.
- Cuenta separada para **IVA reducido 8%** (no hay control por tasa; `4.02.01`
  solo cubre ventas exentas 0%).
- Instrumento y fecha de vigencia formal del plan **VEN-NIF de 167 cuentas**
  (definido/activo para el Libro de Inventario, respuesta 9); no hay importador
  VEN-NIF implementado y el plan base de 35 sigue en pruebas/borradores.
- Saldos de apertura, fecha de corte, numeración de libro/página y paginación
  `1 al 99`; formatos XLSX/PDF con CSV auxiliar, orden de columnas y firma al
  final de cada cierre están aprobados (respuesta 8).

Si se acuerda la adopción operativa de esas cuentas o una cuenta para IVA 8%,
se propondrá una migración v17 con backup previo; mientras tanto el flujo sigue
en **BORRADOR / REFERENCIA**, sin retenciones activas ni asientos alterados.

## Fuentes consultadas

- `OCA/l10n-venezuela` — AGPL-3.0, rama 19.0 por defecto. Consultado 2026-11-21. Referencia general; en 16.0 solo aporta proveedor de tasa BCV.
- `binaural-dev/2.0-odoo-venezuela` — `LICENSE` indica LGPL-3 (GitHub lo marca `NOASSERTION`). Consultado 2026-11-21. Módulos de referencia: `l10n_ve_accounting`, `l10n_ve_tax`, `l10n_ve_payment_extension`, `l10n_ve_invoice`, `account_fiscal_year_closing`.
- `bwealthics/l10n-venezuela-bw` — LGPL-3 salvo `l10n_ve_bw_compliance` (AGPL-3). Consultado 2026-11-21. Documentos útiles: `docs/BASAMENTO-LEGAL.md`, `docs/MANUAL-LOCALIZACION-VE.md`. Módulos de referencia: `l10n_ve_bw_chart`, `l10n_ve_bw_fiscal_books`, `l10n_ve_bw_wh_iva`, `l10n_ve_bw_wh_islr`, `l10n_ve_bw_igtf`, `l10n_ve_bw_invoice_format`, `l10n_ve_bw_einvoice`.

Estos repositorios se usan **solo como referencia normativa, de campos y de plantillas**. No se instalan módulos Odoo en este ERP Angular/Express/SQLite; cualquier reexpresión a TypeScript se documenta y respeta la licencia de origen.
