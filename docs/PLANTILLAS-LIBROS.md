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
| Cuentas de control | Plan base de 35 cuentas, **provisionales para pruebas**; sin cuenta dedicada a retenciones recibidas de ISLR |
| Pendientes de ajustar | Saldos de apertura, fecha de corte, formatos legales, firma definitiva y numeración de libro/página (#13) |
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

### Inventario (borrador/prueba)
Código/ID · Concepto · Tipo · Cantidad · Costo unitario USD · Valor USD · Cuenta provisional · Unidad/Referencia · Observaciones.
Secciones Materia Prima, Producto Terminado y Movimientos del período; valora el stock operativo actual con `1.03.01` y `1.03.02`. No incluye inventario inicial auditado ni ajustes de cierre.

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
- Parámetros pendientes: **Configuración → IVA / UT e Historial (#13)** permite guardar paginación, firma, formato y notas; se reflejan en metadatos, notas y exportaciones.
- Catálogo de referencia: `GET /api/fiscal-reference-catalog` (solo admin/master, solo lectura) expone la clasificación IVA 16%/0%/8% y los rubros ISLR del giro; no calcula impuestos ni activa retenciones.
- Modelos: `AccountingBookType`, `AccountingBookRow`, `AccountingBookMetadata`, `AccountingBookReport`.
- Firma y leyenda **BORRADOR / PRUEBA – PENDIENTE DE VALIDACIÓN CONTABLE (#13)** se incluyen en todas las exportaciones.
- Los repos Odoo referenciados en `docs/MATRIZ-OBLIGACIONES-FISCALES.md` se usaron solo como fuente de campos y normas; no se portó código literal.

## 4. Ajustes pendientes del contador

1. ~~Orden exacto de columnas~~ **aprobado**. **Paginación aun por definir**.
2. Formato aprobado **XLSX/PDF**, **CSV auxiliar**; falta número de libro/página. La firma está pendiente por indicar y se puede guardar desde la interfaz.
3. Cuentas de control definitivas para IVA, **retenciones recibidas**, CxC, CxP, caja/bancos e inventario. Hoy están sembradas `1.04.01` Crédito Fiscal IVA, `2.02.01` IVA por Pagar, `1.02.01` Clientes, `2.01.01` Proveedores, `1.01.01` Caja, `1.01.02` Bancos, `1.03.01` Materia Prima y `1.03.02` Producto Terminado; `2.02.02` Retenciones por Pagar es para retenciones **practicadas**. Falta la cuenta para comprobantes **recibidos de clientes SPE al cobrar** y una cuenta específica para IVA 8%. No se han creado cuentas ni modificado asientos; si se requiere, se hará migración v17 con backup.
4. Saldos de apertura y fechas de corte para balances formales.
5. Formatos legales finales, texto de firma y numeración de libro/página.
6. Validación final de exentos/8%: 16% general para mermelada procesada/envasada, azúcar, empaques/envases y gastos generales; 0% previsto para materias primas agrícolas primarias en estado natural (según aplique); 8% solo para supuestos taxativos confirmados. También validar los conceptos ISLR del giro (honorarios profesionales, servicios técnicos/especializados, obras y servicios en general, fletes/transporte, publicidad y arrendamientos) con UT de referencia Bs. 43,00, persona natural/jurídica, sustraendo y alícuotas del art. 9 del Decreto 1.808.
7. Activación futura de cálculo de retenciones y consecutivos oficiales **solo al cerrar #13**; hoy no se practican retenciones por ser contribuyente ordinario. Hasta entonces no se calcula 0%/8%, no se crean cuentas nuevas y no se alteran asientos activos.
