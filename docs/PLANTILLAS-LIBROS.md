# Plantillas de libros contables — BORRADOR / PRUEBA

> **Estado:** BORRADOR / PRUEBA – PROVISIONAL – PENDIENTE DE VALIDACIÓN CONTABLE (#13).
> Los libros generados por el sistema son borradores de trabajo: no son libros oficiales, no calculan impuestos, no asignan consecutivos oficiales ni sustituyen la firma del contador.

## 1. Estructura común

Toda respuesta de `GET /api/accounting/books?type=…&year=…&month=…` incluye:

### Encabezado / metadatos

| Campo | Contenido |
|---|---|
| Razón social | `fiscalSettings.companyName` |
| RIF | `fiscalSettings.companyTaxId` |
| Dirección fiscal | `fiscalSettings.fiscalAddress` |
| Título del libro | Según tipo solicitado |
| Período | `YYYY-MM`, desde `YYYY-MM-01` hasta último día del mes |
| Estado del período | `abierto` / `cerrado` desde `accountingPeriods` |
| Moneda | USD canónico + equivalente en Bs. (bolívares soberanos), columnas pareadas |
| Política de tasa | `documento_con_fallback`: tasa guardada en el documento; si no existe, `exchangeRates.currentUsd` marcado como referencia |
| Tasa de referencia | `exchangeRates.currentUsd` cuando no hay tasa de documento |
| Generado | Fecha ISO y usuario solicitante |
| Saldo de control | Suma absoluta de importes **USD** de detalle y totales (no duplica el equivalente Bs.); se muestra en USD y Bs. |
| Hash | SHA-256 truncado a 16 caracteres sobre tipo + período + filas + control |
| Leyenda | **BORRADOR / PRUEBA – PROVISIONAL – PENDIENTE DE VALIDACIÓN CONTABLE (#13)** |
| Cuentas de control | Plan base de 35 cuentas, **provisionales para pruebas**; el **Libro de Inventario usa VEN-NIF de 167 cuentas** (definido/activo, respuesta 9). Correlaciones de retenciones recibidas ratificadas (`1.1.05.03` IVA, `1.1.05.04` ISLR; respuesta 10), sin crear cuentas nuevas ni activar cálculos |
| Pendientes de ajustar | Saldos de apertura, fecha de corte, numeración de libro/página y paginación `1 al 99` (#13); formatos, orden de columnas y firma ya aprobados |
| Firma | `Firma: _______________________   Contador / Representante legal` |

### Tipos de fila

`detail`, `section`, `entryTotal`, `total`, `grandTotal`, `note`, `signature`.
La UI resalta secciones, totales de asiento y totales generales; la exportación CSV/Excel/PDF conserva el orden y las notas.

## 2. Columnas por libro

> **Orden aprobado:** se conserva el orden de columnas abajo indicado para los importes USD. Después de **cada importe USD** se intercala su equivalente en Bs. (por ejemplo, `Débito USD` → `Débito Bs.`). Al final de todas las filas se agregan `Tasa Bs./USD` y `Origen de la tasa` (`Tasa guardada en el documento` o `currentUsd (referencia)`). Los totales incluyen `valueBs`.


### Diario
Fecha · Nro. Asiento · Descripción · Origen · Código · Cuenta · Débito USD · Crédito USD · Estado · Detalle.
Solo totaliza asientos confirmados. Los anulados se conservan con montos en cero; los borradores se excluyen.

### Mayor
Código · Cuenta · Naturaleza · Saldo inicial · Débitos del período · Créditos del período · Saldo final.
El saldo inicial incluye asientos confirmados de períodos anteriores.

### Balance de comprobación
Código · Cuenta · Saldo inicial Debe · Saldo inicial Haber · Movimiento Debe · Movimiento Haber · Saldo final Debe · Saldo final Haber.
Debe cuadrar; la diferencia se muestra como total.

### Balance General
Código · Cuenta · Saldo USD · Observaciones.
Secciones Activo, Pasivo y Patrimonio, con total por sección y diferencia final. Estructura provisional del plan base de 35 cuentas.

### Estado de resultados
Código · Cuenta · Importe USD · Observaciones.
Secciones Ingresos, Costos y Gastos; resultado del período = ingresos − costos − gastos. No incluye resultados acumulados.

### Inventario (definitivo — VEN-NIF)
Código/ID · Concepto · Tipo · Cantidad · Costo unitario USD · Valor USD · Cuenta VEN-NIF · Unidad/Referencia · Observaciones.
Secciones Materia Prima, Producto Terminado y Movimientos del período; valora el stock operativo actual con `1.1.04.02` y `1.1.04.04` (correlación de `1.03.01`/`1.03.02`). No incluye inventario inicial auditado ni ajustes de cierre. Firmantes: **Contador y socios**; firma al final de cada cierre confirmada (respuesta 8), paginación `1 al 99` pendiente.

### Compras
Fecha · Tipo · Documento · Proveedor · RIF · Base gravada USD · Alícuota % · IVA USD · Exento USD · No sujeto USD · Retención IVA USD · Total USD · Crédito fiscal.
Reutiliza `FiscalBooksReport`. La retención es informativa: el cálculo permanece desactivado. IVA 16% general por defecto; exento 0% y 8% solo como clasificación de referencia, sin cálculo hasta validar #13. Se separan base imponible, exento e impuesto.

### Ventas
Fecha · Tipo · Documento · Control · Cliente · RIF · Condición · Base gravada USD · IVA USD · Exento USD · No sujeto USD · Total USD.
Reutiliza `FiscalBooksReport`. La clasificación IVA 0%/8% es referencia provisional: se separan base imponible, exento e impuesto, pero no se calculan tasas reducidas hasta validar #13.

### Retenciones
Fecha · Impuesto · Dirección · Tercero · RIF · Comprobante · Factura referencia · Base USD · Alícuota % · Monto USD · Moneda · Tasa BCV.
**SIN OPERACIONES.** Como contribuyente ordinario no se practican retenciones al pagar: la fila de prueba usa **`Recibida (cliente SPE)`**. Solo se contempla el registro/control documental de comprobantes que nos practiquen clientes SPE al cobrar, sin cálculo real ni consecutivos oficiales hasta cerrar #13. `vatWithholdingEnabled=false` e `islrWithholdingEnabled=false`.

### Caja y Banco
Fecha · Concepto · Tipo · Método de pago · Banco · Referencia · Ingreso USD · Egreso USD · Saldo USD.
Auxiliar derivado de cobros, pagos CxP y gastos. No incluye saldo inicial ni conciliación bancaria.

### Auxiliar CxC
Fecha · Cliente · RIF · Documento · Tipo de movimiento · Cargo USD · Abono USD · Saldo USD · Vencimiento.
Derivado de pedidos y abonos; requiere conciliación previa.

### Auxiliar CxP
Fecha · Proveedor · RIF · Documento · Tipo de movimiento · Cargo USD · Abono USD · Saldo USD · Vencimiento.
Derivado de facturas por pagar y sus abonos; requiere conciliación previa.

## 3. Implementación

- Generador: `src/server/accounting-books.ts`.
- Endpoint: `GET /api/accounting/books`, RBAC módulo `accounting`, acción `view`.
- UI: pestaña **Contabilidad → Libros**; selector de libro/año/mes y exportación **XLSX/PDF** con **CSV auxiliar** (la exportaciónExcel conserva el mismo orden de columnas).
- Parámetros: **Configuración → IVA / UT / ISLR e historial (#13)** permite guardar formatos, firmantes, firma al final de cada cierre, paginación, numeración de libro/página, instrumento de ratificación y notas; se reflejan en metadatos, notas y exportaciones. Formatos XLSX/PDF, CSV auxiliar, orden de columnas, firmantes **Contador y socios** y firma al final de cada cierre: **aprobados y cargados** (respuesta 8); **pendiente**: paginación `1 al 99` y numeración de libro/página.
- Catálogo de referencia: `GET /api/fiscal-reference-catalog` (solo admin/master) expone la clasificación IVA 16%/0%/8% y los rubros ISLR del giro. Cada rubro permite **Cargar en histórico** (`kind=islr`) con alícuota, sustraendo, vigencia e instrumento; no calcula impuestos ni activa retenciones.
- Modelos: `AccountingBookType`, `AccountingBookRow`, `AccountingBookMetadata`, `AccountingBookReport`.
- Las exportaciones conservan la firma aprobada (respuesta 8); la leyenda **BORRADOR / PRUEBA – PENDIENTE DE VALIDACIÓN CONTABLE (#13)** se incluye en todos los libros excepto `inventario`, rotulado **LIBRO DEFINITIVO — PLAN VEN-NIF DE 167 CUENTAS**.
- Los repos Odoo referenciados en `docs/MATRIZ-OBLIGACIONES-FISCALES.md` se usaron solo como fuente de campos y normas; no se portó código literal.

## 4. Ajustes pendientes del contador

1. ~~Orden exacto de columnas~~ **aprobado**. **Paginación `1 al 99` pendiente** (respuesta 8).
2. **Formatos aprobados XLSX/PDF** y **CSV auxiliar**; falta número de libro/página. **Firma al final de cada cierre confirmada**, se guarda desde la interfaz existente (respuesta 8).
3. **Correlaciones VEN-NIF ratificadas** (respuesta 10): IVA crédito fiscal `1.1.05.01`, IVA débito fiscal `2.1.04.01`, retenciones IVA/ISLR recibidas `1.1.05.03`/`1.1.05.04`, CxC `1.1.03.01`, CxP `2.1.02.01`, Caja `1.1.01.01`, Bancos `1.1.01.03`, Materia Prima `1.1.04.02` y Producto Terminado `1.1.04.04`. El plan base sigue con 35 cuentas provisionales (`1.04.01`, `2.02.01`, `1.02.01`, `2.01.01`, `1.01.01`, `1.01.02`, `1.03.01`, `1.03.02`; `2.02.02` es para retenciones **practicadas**). No se han creado cuentas ni modificado asientos; la adopción operativa y una cuenta específica para IVA 8% requieren migración v17 con backup, sin activar retenciones.
4. Saldos de apertura y fechas de corte para balances formales.
5. Numeración de libro/página y paginación `1 al 99`; el texto de firma ya está confirmado (respuesta 8).
6. Validación final de exentos/8%: 16% general para mermelada procesada/envasada, azúcar, empaques/envases y gastos generales; 0% previsto para materias primas agrícolas primarias en estado natural (según aplique); 8% solo para supuestos taxativos confirmados. Los conceptos ISLR del giro (honorarios profesionales, servicios técnicos/especializados, obras y servicios en general, fletes/transporte, publicidad y arrendamientos **sin factura ni esquema formal aún**) se mantienen **preventivamente** (respuesta 4) con UT de referencia Bs. 43,00 y distinción persona natural/jurídica; el contador debe indicar **sustraendo y alícuotas por concepto/persona/vigencia**, que se cargan en `IVA / UT / ISLR e historial (#13)` con instrumento y soporte.
7. Activación futura de cálculo de retenciones y consecutivos oficiales **solo al cerrar #13**; hoy no se practican retenciones por ser contribuyente ordinario. Hasta entonces no se calcula 0%/8%, no se crean cuentas nuevas y no se alteran asientos activos.
