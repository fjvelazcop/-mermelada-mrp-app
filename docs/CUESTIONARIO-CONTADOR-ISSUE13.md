# Cuestionario para el contador — cierre de la Fase 0 (Issue #13)

Enviar junto con `docs/MATRIZ-OBLIGACIONES-FISCALES.md` y `docs/PLANTILLAS-LIBROS.md`.
Cada respuesta debe incluir **instrumento o documento de soporte** y **fecha de decisión/vigencia**.

## Régimen y retenciones

1. ~~¿Confirmamos contribuyente **ordinario** y **no SPE**?~~ **Respondido por el usuario (2026-11-22):** contribuyente **ordinario**, giro **fabricación de mermelada**. Falta ratificación contable con documento y fecha. El pase a SPE solo se registra cuando deje de ser ordinario y **no enciende** retenciones.
2. ~~Aunque hoy no sean agentes de retención, ¿la empresa retiene actualmente por algún concepto específico —honorarios, comisiones, servicios, fletes, arrendamientos—?~~ **Respondido por el usuario:** como ordinarios **no practicamos retenciones de IVA ni de ISLR al pagar** (`vatWithholdingEnabled=false`, `islrWithholdingEnabled=false`). Solo debemos contemplar el **registro/control de comprobantes de retención que clientes SPE nos practiquen al cobrar**, sin cálculos reales hasta cerrar #13.
3. ~~¿Confirmamos IVA **16%**?~~ **Respondido por el usuario:** IVA **16%** desde `2020-01-01` como alícuota general por defecto para **mermelada procesada/envasada, azúcar, empaques/envases y gastos generales**; Decreto N° 4.079, G.O. N° 41.788 del 26/12/2019 y Ley de IVA G.O.E. N° 6.507. Queda previsto el **exento 0%** para materias primas agrícolas primarias en estado natural «según aplique» y el **8%** solo para supuestos taxativos que confirme el contador. Compras/Ventas separan base imponible, exento e impuesto, pero no calculan 0%/8% hasta cerrar #13.
4. ¿Qué conceptos del art. 9 del Decreto 1.808 aplican y con qué alícuotas de retención ISLR? **Pendiente del contador**. Como referencia provisional se registran los rubros habituales del giro: honorarios profesionales, servicios técnicos/especializados, obras y servicios en general, fletes/transporte, publicidad y arrendamientos, con distinción persona natural/jurídica. **Sustraendo y alícuotas quedan pendientes**; hoy no se calculan montos ni consecutivos.
5. ~~¿Qué Unidad Tributaria histórica debe usarse para los sustraendos?~~ **Respondido por el usuario:** UT **Bs. 43,00** desde `2025-06-02`; Providencia N° SNAT/2025/000048, G.O. N° 43.140 del 02/06/2025. Queda como **referencia** para los sustraendos y conceptos de ISLR del giro, pendientes de validación contable.
6. ~~¿Confirmamos que no hay pagos en divisas ni criptoactivos, o existe exoneración IGTF vigente aplicable?~~ **Respondido por el usuario:** **IGTF no aplica** (sin pagos en divisa y contribuyente ordinario). Referencia: G.O.E. 6.687 / Decreto 4.972. Revisar si cambia la condición de contribuyente o el manejo de divisas. `IGTF=false`, sin cálculo.

## Facturación y libros

7. Canal actual de facturación —forma libre, máquina fiscal o digital—, imprenta autorizada, licencia y fecha prevista de migración antes del **19/04/2027**. Si se usará facturación digital, indique proveedor autorizado, RIF del proveedor, URL/API, ambiente de pruebas/producción y responsable del certificado de firma.
8. Lista final de libros —**formato aprobado XLSX/PDF y CSV auxiliar; orden de columnas aprobado**—, **paginación aún por definir** y firma **aún pendiente por indicar** (ya existe interfaz para guardarla). Confirme si el **Libro de Inventario** borrador/prueba debe conservarse y con qué cuentas definitivas reemplaza `1.03.01` y `1.03.02`.
9. ¿Mantener el plan base de 35 cuentas, adoptar la propuesta VEN-NIF de 167 cuentas de 6 dígitos o usar un plan propio? **Por ahora se usan las provisionales actuales solo para pruebas/borradores.**
10. Códigos definitivos para IVA débito/crédito, retenciones recibidas, CxC, CxP, caja/bancos e inventario. Hoy se usan `1.04.01` Crédito Fiscal IVA, `2.02.01` IVA por Pagar, `2.02.02` Retenciones por Pagar, `1.02.01` Clientes, `2.01.01` Proveedores, `1.01.01` Caja, `1.01.02` Bancos, `1.03.01` Materia Prima y `1.03.02` Producto Terminado. **Falta definir la cuenta definitiva para comprobantes de retención recibidos de clientes Sujetos Pasivos Especiales al cobrar**; `2.02.02` es para retenciones **practicadas**, no equivale a recibidas. Mientras tanto no se han creado cuentas nuevas ni se han modificado asientos.
11. Tasa definida: **guardada por documento con fallback a `currentUsd`**, con columnas `Tasa Bs./USD` y `Origen de la tasa`. Confirmar si se mantiene esta política para la versión definitiva.
12. ¿Activar cadena de integridad/hash de asientos? Es irreversible; recomendación del sistema: **mantenerla apagada** hasta autorización expresa.
13. Conservación y auditoría: años de retención, quién firma y qué eventos deben quedar en la bitácora.

## Observaciones

- IVA y UT se administran en **Configuración → IVA / UT e Historial (#13)**, con vigencias, instrumento, gaceta, soporte y confirmación por fila. Los registros sembrados quedan en estado `referencia` y `confirmedByAccountant=false`; **no afectan cálculos activos**.
- La misma pantalla muestra, en **solo lectura y solo para admin/master**, el catálogo de referencia de `GET /api/fiscal-reference-catalog`: IVA 16%/0%/8% y los seis rubros ISLR con persona natural/jurídica, UT Bs. 43,00 y sustraendo pendiente. No es un CRUD y no calcula impuestos.
- El plan de cuentas vigente es el base de **35 cuentas**, activo y sembrado desde la migración v14; incluye materia prima, producto terminado, CxC, CxP, caja/bancos e IVA. No hay cuenta de **retenciones recibidas** ni cuenta específica para IVA 8%, y no se han creado cuentas ni tocado asientos por esta ronda: todo sigue en borrador hasta la validación contable.
- Las bajas son anulaciones lógicas con motivo; no se borran registros del historial.
- Las banderas `vatWithholdingEnabled` e `islrWithholdingEnabled` permanecen en `false` hasta que este cuestionario esté cerrado y validado; no se practican retenciones al pagar.
- El Libro de Retenciones se genera en modo borrador con la dirección **recibida (cliente SPE)** y `SIN OPERACIONES`: solo control documental de comprobantes, sin cálculo ni consecutivos.
- **Cierre formal pendiente con el contador (#13):** validación final de exentos/8% y conceptos ISLR, cuenta contable para retenciones recibidas, saldos de apertura, fecha de corte, formatos legales finales, firma y numeración de libro/página. Todo se mantiene en modo **BORRADOR / PRUEBA** hasta entonces.
- El cambio de régimen a SPE solo registra condición declarativa en auditoría: no habilita cálculos de retención ni emisión digital.
- Los libros, incluido Inventario, se generan como **BORRADOR / PRUEBA – PENDIENTE DE VALIDACIÓN CONTABLE (#13)**: no sustituyen formatos oficiales ni evidencia fiscal.
- El Libro de Retenciones generado hoy devuelve **SIN OPERACIONES**: como ordinarios no se practican retenciones; la estructura queda preparada para el control de comprobantes **recibidos de clientes SPE**, sin calcular impuestos ni asignar consecutivos oficiales.
- La casilla de facturación digital guarda solo preparación: no emite documentos ni transmite datos al SENIAT. No-envíe llaves privadas ni tokens; solo etiqueta/serial del certificado.
- La respuesta 8 define los ajustes finales de `docs/PLANTILLAS-LIBROS.md`.
