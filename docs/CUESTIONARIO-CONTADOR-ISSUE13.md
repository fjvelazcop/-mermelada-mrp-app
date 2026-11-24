# Cuestionario para el contador — cierre de la Fase 0 (Issue #13)

Enviar junto con `docs/MATRIZ-OBLIGACIONES-FISCALES.md` y `docs/PLANTILLAS-LIBROS.md`.
Cada respuesta debe incluir **instrumento o documento de soporte** y **fecha de decisión/vigencia**.

Estado general: **BORRADOR/PRUEBA – PROVISIONAL – PENDIENTE DE VALIDACIÓN CONTABLE (#13)**.
IVA, UT e IGTF ya están **validados** (23/11/2026); el régimen ordinario/no SPE sigue pendiente de ratificación documental y el resto del cierre permanece en borrador.

## Régimen y retenciones

1. ~~¿Confirmamos contribuyente **ordinario** y **no SPE**?~~ **Respondido por el usuario (2026-11-22):** contribuyente **ordinario**, giro **fabricación de mermelada**. **PENDIENTE POR EL CONTADOR:** ratificación documental con instrumento y fecha. El pase a SPE solo se registra cuando deje de ser ordinario y **no enciende** retenciones.
2. ~~Aunque hoy no sean agentes de retención, ¿la empresa retiene actualmente por algún concepto específico —honorarios, comisiones, servicios, fletes, arrendamientos—?~~ **Respondido por el usuario:** como ordinarios **no practicamos retenciones de IVA ni de ISLR al pagar** (`vatWithholdingEnabled=false`, `islrWithholdingEnabled=false`). Solo debemos contemplar el **registro/control de comprobantes de retención que clientes SPE nos practiquen al cobrar**, sin cálculos reales hasta cerrar #13.
3. ~~¿Confirmamos IVA **16%**?~~ **VALIDADO (2026-11-23):** IVA **16%** desde `2020-01-01` como alícuota general por defecto para **mermelada procesada/envasada, azúcar, empaques/envases y gastos generales**; Decreto N° 4.079, G.O. N° 41.788 del 26/12/2019 y Ley de IVA G.O.E. N° 6.507. Quedan **por precisar si aplica** (a la espera del contador) el **exento 0%** para materias primas agrícolas primarias en estado natural y el **8%** solo para supuestos taxativos. Compras/Ventas separan base imponible, exento e impuesto, pero no calculan 0%/8% hasta cerrar #13.
4. ¿Qué conceptos del art. 9 del Decreto 1.808 aplican y con qué alícuotas de retención ISLR? **PENDIENTE POR EL CONTADOR** (por precisar si aplica). Como referencia provisional se registran los rubros habituales del giro: honorarios profesionales, servicios técnicos/especializados, obras y servicios en general, fletes/transporte, publicidad y arrendamientos, con distinción persona natural/jurídica. **Sustraendo y alícuotas quedan pendientes**; hoy no se calculan montos ni consecutivos.
5. ~~¿Qué Unidad Tributaria histórica debe usarse para los sustraendos?~~ **VALIDADO (2026-11-23):** UT **Bs. 43,00** desde `2025-06-02`; Providencia N° SNAT/2025/000048, G.O. N° 43.140 del 02/06/2025. Se mantiene como regla para los sustraendos y conceptos de ISLR del giro; la aplicación concreta de esos conceptos sigue **por precisar si aplica**.
6. ~~¿Confirmamos que no hay pagos en divisas ni criptoactivos, o existe exoneración IGTF vigente aplicable?~~ **VALIDADO (2026-11-23):** **IGTF no aplica según la condición actual** (sin pagos en divisa y contribuyente ordinario). Referencia: G.O.E. 6.687 / Decreto 4.972. Revisar si cambia la condición de contribuyente o el manejo de divisas. `IGTF=false`, sin cálculo.

## Facturación y libros

7. Canal actual de facturación —forma libre, máquina fiscal o digital—, imprenta autorizada, licencia y fecha prevista de migración antes del **19/04/2027**. Si se usará facturación digital, indique proveedor autorizado, RIF del proveedor, URL/API, ambiente de pruebas/producción y responsable del certificado de firma.
8. Lista final de libros —**formato aprobado XLSX/PDF y CSV auxiliar; orden de columnas aprobado**—, **paginación aún por definir** y firma **aún pendiente por indicar** (ya existe interfaz para guardarla). El **Libro de Inventario ya no es borrador**: usa VEN-NIF con firmantes **Contador y socios**; la paginación `1 al 99` y la firma al final de cada cierre siguen pendientes.
9. ¿Mantener el plan base de 35 cuentas, adoptar la propuesta VEN-NIF de 167 cuentas de 6 dígitos o usar un plan propio? **Ya se incorporó el plan VEN-NIF de 167 cuentas adjunto y el Libro de Inventario lo usa; el resto del cierre sigue con las provisionales actuales solo para pruebas/borradores.**
10. Códigos definitivos para IVA débito/crédito, retenciones recibidas, CxC, CxP, caja/bancos e inventario. Correlación VEN-NIF aplicada: IVA crédito fiscal `1.1.05.01`, IVA débito fiscal `2.1.04.01`, retenciones IVA recibidas `1.1.05.03`, retenciones ISLR recibidas `1.1.05.04`, retenciones practicadas IVA/ISLR `2.1.04.03`/`2.1.04.05`, CxC `1.1.03.01`, CxP `2.1.02.01`, Caja `1.1.01.01`, Bancos `1.1.01.03`, Materia Prima `1.1.04.02` y Producto Terminado `1.1.04.04` (antes `1.03.01`/`1.03.02`). **Queda por ratificar documentalmente la cuenta de retenciones ISLR recibidas** de clientes SPE; no se crearon cuentas nuevas en el plan base ni se modificaron asientos automáticos.
11. Política de tasa: **VALIDADA (2026-11-23)**. La tasa de cada documento toma por defecto la **tasa actual (`currentUsd`)** o la **tasa histórica correspondiente a la fecha con la que se guarda**; se muestra **visible y editable** en los formularios para permitir el ajuste manual, con columnas `Tasa Bs./USD` y `Origen de la tasa`. Si no se especifica o no se modifica otra, aplica el **fallback a la tasa actual**. Los cálculos en USD no se recalculan al cambiar la tasa: el equivalente en Bs. usa la tasa guardada en el documento.
12. ¿Activar cadena de integridad/hash de asientos? Es irreversible; recomendación del sistema: **mantenerla apagada** hasta autorización expresa.
13. Conservación y auditoría: años de retención, quién firma y qué eventos deben quedar en la bitácora.

## Pendiente por el contador (#13)

1. Ratificación documental del contribuyente **ordinario / no SPE**, con instrumento y fecha (respuesta 1).
2. Precisar **si aplican** exento **0 %**, **8 %** y los conceptos ISLR del art. 9 (sustraendo y alícuotas; respuestas 3 y 4).
3. Cuenta contable para **retenciones ISLR recibidas** de clientes SPE (respuesta 10; `2.02.02` es solo para practicadas).
4. **Reconversión** de la figura jurídica y cotejo del acta constitutiva.
5. **Fecha de corte** y saldos de apertura: generales y por banco/clientes/proveedores.
6. Tratamiento **pago versus devengo**.
7. Formatos legales, paginación, firma y numeración de libro/página; conservación y auditoría.
8. Canal de facturación antes del **19/04/2027**. El plan VEN-NIF de 167 cuentas ya está incorporado y lo usa el Libro de Inventario.
9. La cadena hash fue autorizada y quedó activada con backfill histórico, verificación y auditoría; lo pendiente es la paginación `1 al 99` y la firma al final de cada cierre.
10. Cierre formal de los comprobantes SPE y del Libro de Retenciones «SIN OPERACIONES».

## Observaciones

- IVA y UT se administran en **Configuración → IVA / UT e Historial (#13)**, con vigencias, instrumento, gaceta, soporte y confirmación por fila. Los registros sembrados siguen en estado `referencia` en la tabla histórica (soporte documental), pero **IVA 16 %, UT Bs. 43,00 e IGTF no aplica están VALIDADOS desde el 23/11/2026** según las respuestas 3, 5 y 6; no afectan cálculos activos ni sustituyen la ratificación documental del régimen.
- La misma pantalla muestra, en **solo lectura y solo para admin/master**, el catálogo de referencia de `GET /api/fiscal-reference-catalog`: IVA 16%/0%/8% y los seis rubros ISLR con persona natural/jurídica, UT Bs. 43,00 y sustraendo pendiente. No es un CRUD y no calcula impuestos; la tasa general y la UT están validadas, los supuestos 0%/8% e ISLR siguen **por precisar si aplica**.
- El plan base sigue siendo el de **35 cuentas** (migración v14) y no se han creado cuentas ni tocado asientos automáticos. El **catálogo VEN-NIF de 167 cuentas** ya está incorporado y lo usa el Libro de Inventario: `1.03.01` → `1.1.04.02` (Materia Prima) y `1.03.02` → `1.1.04.04` (Producto Terminado). Las cuentas de retenciones recibidas quedan mapeadas como referencia (`1.1.05.03` IVA, `1.1.05.04` ISLR) y siguen pendientes de ratificación; no hay cuenta específica para IVA 8 %.
- Las bajas son anulaciones lógicas con motivo; no se borran registros del historial.
- Las banderas `vatWithholdingEnabled` e `islrWithholdingEnabled` permanecen en `false` hasta que este cuestionario esté cerrado y validado; no se practican retenciones al pagar.
- El Libro de Retenciones se genera en modo borrador con la dirección **recibida (cliente SPE)** y `SIN OPERACIONES`: solo control documental de comprobantes, sin cálculo ni consecutivos.
- El resto de respuestas del cierre #13 —reconversión, fecha de corte, aportes, saldos de apertura, formatos y firmas— se mantienen en modo **BORRADOR / PRUEBA** hasta la ratificación contable, aunque UT, IVA e IGTF ya estén validados.
- El cambio de régimen a SPE solo registra condición declarativa en auditoría: no habilita cálculos de retención ni emisión digital.
- El **Libro de Inventario** se genera como **definitivo sobre VEN-NIF de 167 cuentas**, con Contador y socios como firmantes. Los demás libros se generan como **BORRADOR / PRUEBA – PENDIENTE DE VALIDACIÓN CONTABLE (#13)**: no sustituyen formatos oficiales ni evidencia fiscal. La paginación `1 al 99` y la firma al final de cada cierre continúan pendientes.
- El Libro de Retenciones generado hoy devuelve **SIN OPERACIONES**: como ordinarios no se practican retenciones; la estructura queda preparada para el control de comprobantes **recibidos de clientes SPE**, sin calcular impuestos ni asignar consecutivos oficiales.
- La casilla de facturación digital guarda solo preparación: no emite documentos ni transmite datos al SENIAT. No envíe llaves privadas ni tokens; solo etiqueta/serial del certificado.
- La respuesta 8 define los ajustes finales de `docs/PLANTILLAS-LIBROS.md`.
