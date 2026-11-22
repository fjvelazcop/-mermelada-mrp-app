# Manual de Usuario — Mermelada ERP

**Versión:** 1.4 · **Última actualización:** 22/11/2026
**Aplicación:** PulpaCraft MRP / Mermelada ERP
**Alcance:** personal administrativo, supervisores, operadores de planta, almacén y costos.

> Este manual describe cómo usar el sistema. No sustituye la asesoría contable
> ni tributaria. La facturación disponible es preliminar y requiere validación;
> consulte la sección [Estado fiscal](#estado-fiscal-actual).

---

## 1. ¿Qué es el sistema?

Es un ERP/MRP para una microempresa de mermeladas que integra:

- Inventario de materia prima y producto terminado.
- Producción por lotes con recetas (BOM).
- Costeo dinámico y precios de venta.
- Ventas, notas de entrega y cobros.
- Nómina semanal.
- Gastos y egresos.
- Directorio de proveedores.
- Contabilidad básica: plan de cuentas, asientos de doble entrada y períodos.
- Auditoría de las operaciones y administración de usuarios.

Todos los módulos comparten la misma base de datos, por lo que una venta
descuenta inventario y deja rastro en la auditoría.

---

## 2. Cómo ingresar

### 2.1. Acceso a la interfaz

1. Abra la URL pública vigente del ERP. La URL cambia cuando se reinicia el
   túnel rápido; el administrador la recibe por correo y también puede
   consultarla en `GET /api/system/tunnel`.
2. Si el administrador activó la protección adicional de la interfaz
   (`UI_AUTH_ENABLED=true`), el navegador mostrará una ventana de
   **autenticación básica** antes de cargar la aplicación. En la configuración
   actual esa protección está desactivada, así que verá directamente el login.
3. A continuación aparece la pantalla de **inicio de sesión del ERP**. Use su
   usuario personal y su contraseña. Este login es siempre obligatorio.

### 2.2. Primer ingreso y cambio de contraseña

- Todo usuario nuevo creado **sin contraseña** recibe la clave temporal
  **`inicio123`**.
- Al ingresar por primera vez, cambie la contraseña desde el menú de su cuenta
  → **Cambiar contraseña**.
- Requisitos: mínimo 8 caracteres. Se recomienda combinar mayúsculas,
  minúsculas, números y símbolos.
- Si olvidó su contraseña, solicítela al administrador; él puede asignarle una
  nueva desde **Configuración → Usuarios**.

### 2.3. Cerrar sesión

Use **Cerrar sesión** en el menú de la cuenta, especialmente en equipos
compartidos. La sesión expira a las 8 horas; al vencer, el sistema vuelve
automáticamente a la pantalla de login. Cerrar sesión también regresa al login.

---

## 3. Roles y permisos

| Rol | Uso típico | Acceso general |
|---|---|---|
| **Administrador** | Dirección / sistemas | Todos los módulos, usuarios, roles, configuración y auditoría. |
| **Master** | Superusuario oculto | Todo lo del administrador más el módulo exclusivo de activación y control de pagos. |
| **Supervisor de planta** | Jefe de producción | Producción, inventario, costos, reportes y parte de la administración. |
| **Operador** | Personal de planta | Producción e inventario operativo. |
| **Analista de costos** | Costos y precios | Costeo, recetas, precios y reportes financieros. |
| **Almacenista** | Almacén | Inventario, entradas, salidas y ajustes. |

El rol **Master** es una cuenta raíz oculta: no aparece en la lista de usuarios,
solo un Master puede verlo o asignarlo, no puede restringirse ni eliminarse y es
el único con acceso al módulo **Activación & Control de Pagos**. El resto de los
roles, incluido el administrador, no ve ese módulo.

Los permisos son por módulo y por acción (**ver, crear, editar, eliminar,
exportar**). Si un módulo no aparece en el menú, su rol no tiene permiso de
lectura. Solicite el cambio al administrador.

En el flujo fiscal, el personal con permiso de ventas crea el pedido y la
factura se genera automáticamente si está habilitada. La configuración fiscal,
las anulaciones, las notas de crédito/débito y el cierre de libros corresponden
al administrador. Un contador externo valida criterios tributarios; no debe
usar una cuenta del ERP salvo que el administrador le asigne explícitamente un
rol y permisos.

---

## 4. Módulos del sistema

### 4.1. Tablero principal

Resumen de ventas, producción, inventario crítico, gastos y tasa de cambio.
Úselo al inicio del día para detectar alertas de stock y pedidos pendientes.

### 4.2. Costos y precios

- Calcula el costo unitario a partir de la receta, merma y costos indirectos.
- Permite simular escenarios y definir precios mayoristas/detallistas.
- Los precios pueden expresarse en USD y convertirse a bolívares con la tasa
  BCV registrada.

**Recomendación:** revise el costo cada vez que cambie el precio de un insumo o
la tasa de cambio.

### 4.3. Producción y BOM

1. Cree una **orden de producción** indicando receta, presentación y cantidad
   objetivo.
2. El sistema calcula los materiales requeridos y los descuenta del inventario
   al procesar la orden.
3. Registre el lote y las observaciones del operador.
4. Al finalizar, el producto terminado entra al inventario disponible.

Estados habituales: pendiente → en proceso → completada. Una orden puede
anularse; la anulación queda auditada y no borra el historial.

**Planilla manual de marmitas (formato físico Lote 72).** El Administrador, el
Master y el Supervisor de Planta pueden registrarla desde *Producción → Órdenes
Manuales de Producción*. Solo el Administrador y el Master pueden editarla,
procesarla, anularla o eliminarla:

1. Pulse **Planilla de marmitas** e indique lote, fecha de producción y
   referencia de compromiso.
2. Complete las seis marmitas fijas con cestas/base, guayaba, azúcar, almidón,
   químico (g), ácido (g), agua/gasoil, hora finalizada y marca de reproceso.
   **Kilos totales** se estima como *insumos (guayaba + azúcar + almidón +
   químico + ácido) × rendimiento*; el agua/gasoil es consumo de proceso y no
   suma masa. **Cant. obtenida** se calcula como *kilos totales ÷ peso por
   envase*. Ambos valores pueden corregirse manualmente y se recalculan cuando
   cambia una base relevante.
3. Registre cada presentación (peso por envase) y el rendimiento (%). La
   **matriz de unidades por marmita y presentación** permite capturar las
   unidades de cada presentación en cada marmita; una marmita puede tener varias
   presentaciones y una presentación puede producirse en varias marmitas. El
   icono de check al final de cada fila marca la **marmita activa** y resalta su
   fila en la tabla principal. La columna **Unidades** de cada presentación y la
   tabla principal quedan sincronizadas: editar en cualquiera actualiza la otra.
4. El sistema calcula en tiempo real los totales por marmita, por presentación y
   el total general (unidades y kilos), el costo de insumos y empaques, el valor
   de producción con las tarifas vigentes y avisa si los kilos asignados a una
   marmita no cuadran con sus kilos estimados.
5. Guarde la planilla. Si la registra el Administrador o el Master, la orden se
   procesa en la misma operación y descuenta guayaba, azúcar, almidón, químicos,
   ácidos, agua/gasoil, cuñetes y cajas; las unidades producidas quedan en
   inventario comprometido. Si la registra el Supervisor de Planta, queda en
   borrador para revisión.
6. Use el icono de ojo junto al número de orden o **Ver detalle** para consultar
   por lote las seis marmitas, los totales, los costos y la regla de valoración
   aplicada. En las órdenes automáticas, el mismo icono abre el detalle de
   ejecución con fórmulas, materiales consumidos y costos del lote.

Un mismo lote no puede registrarse dos veces mientras la orden no esté anulada,
lo que evita descuentos duplicados. Si falta stock o falla el guardado, no se
crea la orden ni se altera el inventario.

La valoración usa el costo unitario vigente del producto terminado de Guayaba
20 kg (cuñete y caja) al momento de guardar; los insumos y empaques se costean a
su costo promedio vigente. No son tarifas fijas: cámbielas en inventario o
costos cuando cambien sus precios.

Las órdenes manuales cargadas por fórmulas BOM siguen disponibles con el botón
**Por fórmulas BOM**.

### 4.4. Inventario y almacén

- **Materia prima:** stock actual, mínimo, unidad, costo y proveedor.
- **Producto terminado:** unidades disponibles y reservadas por pedidos.
- **Movimientos:** entradas, salidas, ajustes y mermas. Cada movimiento guarda
  quién lo realizó. En el modal **Registrar Movimiento de Inventario**, el campo
  **Proveedor de la factura** busca en el maestro de proveedores por razón
  social, código (`PROV-0001`), RIF/Cédula o contacto. Al seleccionarlo se guardan
  el `supplierId` y una copia de la razón social y el RIF/Cédula vigentes, que
  aparecen en el listado, detalle y exportaciones. Si el proveedor no existe,
  puede crearlo desde **+ Registrar nuevo proveedor** sin salir del modal.
- **Alertas:** los insumos por debajo del mínimo se resaltan para reposición.

Buenas prácticas:

- Registre la merma real, no la teórica.
- No ajuste stock para “cuadrar” sin documentar el motivo.
- Verifique la unidad de medida (kg, g, unidad) antes de guardar.

### 4.5. Ventas y despacho

1. Seleccione el cliente y confirme que su razón social y RIF estén correctos.
2. Agregue productos y revise la categoría y alícuota de IVA de cada línea.
   Si el tratamiento es **Exento** o **No sujeto**, la alícuota queda en 0; al
   volver a **Gravado** se restaura la alícuota vigente (16 % actualmente).
3. Indique condición de venta (contado/crédito), forma de pago y la tasa BCV
   vigente. Para ventas a crédito seleccione el **plazo en días** (7, 15, 30,
   45, 60, 90, 120 o 180); el plazo se guarda con el pedido para consultas y
   cobros posteriores. Los importes se expresan en USD y el sistema calcula su
   equivalente en Bs.; no introduzca conversiones manuales en los campos
   calculados.
4. Guarde el pedido. Si la facturación fiscal está habilitada, se emite la
   factura en ese momento; el pedido reserva inventario y registra quién lo
   creó.
5. Genere la **nota de entrega** cuando el pedido salga del almacén.
6. Registre el **cobro** indicando banco, método de pago y referencia.

Importante:

- Una nota de entrega **no es una factura fiscal**.
- La factura toma el nombre y RIF de la ficha vigente del cliente. El sistema
  bloquea la emisión si el RIF no tiene formato válido, la tasa de cambio no es
  positiva, la configuración fiscal está incompleta o los consecutivos ya se
  utilizaron.
- Si necesita anular un pedido, hágalo desde el flujo de anulación; no elimine
  registros manualmente.

### 4.6. Nómina semanal

- Registre empleados y sus datos.
- Cargue la semana con días trabajados, bonos y deducciones.
- Cierre la semana para calcular el total a pagar.
- Los pagos quedan en el historial para auditoría.

### 4.7. Gastos y egresos

- Clasifique cada gasto por categoría (alquiler, servicios, transporte,
  honorarios, etc.).
- En **Registrar Nuevo Gasto / Egreso**, el campo **Proveedor o Beneficiario** es
  un autocompletable del maestro de proveedores. Busca por razón social, código,
  RIF/Cédula o contacto; al elegir una opción se llenan automáticamente el RIF y
  la razón social y se vincula el `supplierId`. El RIF queda de solo lectura hasta
  que se use **Limpiar selección**.
- Si el proveedor no existe, use **+ Registrar nuevo proveedor**. El alta rápida
  exige razón social, RIF/Cédula válido (`V-`, `J-`, `G-`, `E-` o `C-`), contacto,
  teléfono, dirección fiscal, tipo y condiciones de pago. Si el RIF ya está
  registrado, el sistema ofrece **Usar proveedor existente** para evitar duplicados.
- Para socios, viáticos o vales de caja use **Beneficiario eventual (sin
  proveedor maestro)**: se conserva el texto libre sin crear una ficha.
- Registre número de factura y datos fiscales cuando aplique. El IVA de gastos
  con factura válida puede registrarse como crédito fiscal.
- Cada gasto guarda el usuario que lo registró y, cuando aplica, el proveedor
  maestro vinculado.

### 4.8. Directorio de proveedores

- Datos de contacto, RIF y condiciones de pago.
- Historial de precios por insumo.
- Un proveedor con precios o compras registradas no debe eliminarse; desactívelo.

### 4.9. Configuración y permisología

Disponible para administradores y Master:

- **Usuarios:** crear, editar, desactivar y asignar roles.
- **Roles:** matriz de permisos por módulo y acción.
- **Datos fiscales:** razón social, RIF, dirección, serie y datos de contacto.
- **IVA / UT e Historial (#13):** solo admin/master. Histórico de IVA/UT con
  vigencias e instrumentos, parámetros pendientes de libros y un catálogo de
  referencia de solo lectura con la clasificación IVA 16%/0%/8% y los rubros
  ISLR del giro. No calcula impuestos ni activa retenciones.
- **Auditoría:** consulta de eventos por módulo y usuario.

### 4.10. Documentación y guía

Referencia interna de arquitectura, módulos y flujos. Úsela para resolver dudas
sobre el funcionamiento del sistema.

### 4.11. Facturas, notas y libros fiscales

1. En **Facturación Fiscal**, consulte las facturas emitidas y abra una para
   revisar o imprimirla. La primera impresión es el original; las siguientes
   quedan identificadas como **DUPLICADO**.
2. La anulación de una factura requiere motivo y permisos de administrador. Los
   números emitidos no se reutilizan.
3. El administrador puede emitir una nota de crédito o débito desde una factura
   vigente. La nota conserva su propio consecutivo y referencia a la factura;
   una nota de crédito no puede exceder el saldo acreditable disponible.
4. En **Libros fiscales mensuales**, seleccione año y mes y consulte los libros
   de Ventas y Compras y sus diferencias de conciliación. **Exportar CSV**
   genera ambos archivos y registra en auditoría el usuario, período, totales y
   huella SHA-256 del reporte exportado.
5. Cierre el período solo después de revisar los datos y guardar los archivos.
   El cierre es definitivo: bloquea nuevas facturas, notas y cambios en los
   gastos de ese mes.

La creación de notas y la consulta, exportación y cierre de libros se reservan
al administrador. Revise las diferencias antes del cierre; los formatos y
criterios deben confirmarse con el contador.

El registro de obligaciones tributarias y sus decisiones es una función
administrativa exclusiva. Si necesita confirmar si aplica una retención, IGTF,
SPE u otra obligación, consulte al administrador; no cambie datos fiscales ni
interprete un estado registrado como habilitación para emitir o cobrar un
impuesto.

**Si una validación bloquea la factura:** no cambie la tasa, RIF, numeración ni
la configuración fiscal para eludirla. Informe al administrador para que revise
los datos maestros y, si corresponde, consulte al contador. No edite ni elimine
una factura emitida; solicite al administrador la corrección documentada.

### 4.12. Activación & control de pagos (solo Master)

Módulo exclusivo del rol **Master** para llevar el libro de activaciones y pagos
de clientes:

1. Abra **Activación & Pagos** en la navegación. Solo aparece con una sesión
   Master.
2. Use **Nueva Activación** para registrar cliente, cédula/RIF, concepto, monto,
   moneda (USD o Bs.), método de pago, referencia, fecha de pago, vigencia y
   estado.
3. Consulte los totales por estado y moneda, y filtre por texto o estado.
4. Edite con el icono de lápiz o elimine con el icono de papelera. Cada cambio
   pide confirmación cuando corresponde y queda reflejado en el libro.
5. El sistema no permite que otros roles vean, creen, editen o eliminen estos
   registros, ni desde la interfaz ni desde la API.

### 4.13. Contabilidad (plan de cuentas, asientos y períodos)

El módulo **Contabilidad** aparece en la navegación principal para los roles con
permiso. Cinco pestañas:

1. **Plan de cuentas:** lista el plan base provisional de 35 cuentas activas
   (activo, pasivo, patrimonio, ingreso, gasto y costo), con código, naturaleza
   y nivel. Ya incluye caja/bancos, CxC, CxP, materia prima, producto terminado
   e IVA; no incluye una cuenta dedicada a **retenciones recibidas** ni una
   cuenta específica para IVA 8%. Administradores pueden crear cuentas
   adicionales, pero en esta ronda no se han creado cuentas ni modificado
   asientos. Los códigos, la naturaleza y el plan definitivo (base 35 o VEN-NIF
   de 167) deben confirmarse con el contador (#13).
2. **Asientos / Diario:** consulta los asientos automáticos generados desde
   ventas, cobros, egresos, pagos de CxP e inventario, y permite crear asientos
   manuales balanceados. Un asiento con débitos distintos de créditos no puede
   guardarse. Admin/Master pueden confirmar borradores o anular con motivo; la
   anulación conserva el historial.
3. **Libros:** genera versiones **BORRADOR / PRUEBA** de Diario, Mayor, Balance
   de comprobación, Balance General, Inventario, Estado de resultados, Compras,
   Ventas, Retenciones, Caja/Banco y auxiliares CxC/CxP para el año y mes
   elegidos. Inventario usa las cuentas provisionales `1.03.01` y `1.03.02`.
   Cada libro incluye metadatos, saldo de control, hash, leyenda «PENDIENTE DE
   VALIDACIÓN CONTABLE (#13)» y línea de firma. Puede exportarlo a CSV, Excel o
   PDF. Retenciones se muestra «SIN OPERACIONES»: como ordinario no se practican retenciones; solo control de comprobantes recibidos de SPE, sin cálculo ni
   consecutivos.
4. **Períodos:** los meses se crean automáticamente al registrar el primer
   asiento. Admin/Master pueden cerrar o reabrir un período; un período cerrado
   bloquea nuevos asientos con fecha de ese mes.
5. **Retenciones:** aparece bloqueada para cálculo. Como contribuyente ordinario no se practican retenciones de IVA/ISLR al pagar; solo se contempla el control documental de comprobantes recibidos de clientes SPE. No hay cálculo ni
   consecutivos oficiales hasta que el contador valide las obligaciones en el
   [issue #13](https://github.com/fjvelazcop/-mermelada-mrp-app/issues/13).

En **Asientos / Diario** puede exportar el libro Diario a CSV o Excel. Los
asientos automáticos son idempotentes: un mismo origen (por ejemplo, una
entrada de inventario) genera un solo asiento aunque se sincronice varias veces.
El detalle de columnas y encabezados está en `docs/PLANTILLAS-LIBROS.md`.

---

## 5. Reglas importantes

### 5.1. Los usuarios con actividad no se eliminan

Si un usuario ya registró ventas, movimientos de inventario, producción,
gastos, precios de proveedores o eventos de auditoría, **el sistema impide
eliminarlo**. En su lugar, **desactívelo**:

1. Vaya a **Configuración → Usuarios**.
2. Edite el usuario y cambie su estado a **inactivo**.

Así los documentos históricos siguen apuntando a una persona real y la
auditoría se mantiene íntegra. Solo se pueden eliminar usuarios sin actividad.

### 5.2. Todo queda auditado

Las operaciones relevantes generan un evento con fecha, usuario y detalle:
creación de pedidos, cobros, movimientos de inventario, producción, gastos,
proveedores y cambios de usuarios. No es posible borrar la auditoría desde la
interfaz.

### 5.3. No comparta credenciales

Cada persona debe tener su propio usuario. Las acciones quedan asociadas al
usuario que las ejecuta; compartir cuentas rompe la trazabilidad.

---

## 6. Estado fiscal actual

El sistema emite facturas numeradas, notas de crédito/débito y reportes mensuales
de compras y ventas, con impresión, auditoría, exportación CSV y cierre
bloqueante. La representación y los reportes requieren validación de un
contador público y **no implican autorización del SENIAT**.

La Fase 1 del plan ampliado ya entrega un plan de cuentas base, asientos de
doble entrada (manuales y automáticos), períodos mensuales y exportación del
Diario. Es una base técnica **provisional**: no sustituye la validación del plan
de cuentas, libros formales ni estados financieros. Mayor, Balances e Inventario
ya se pueden generar como **borradores/prueba**, pero el cálculo de Retenciones
IVA/ISLR e IGTF sigue bloqueado hasta definir las obligaciones con un contador en el
[issue #13](https://github.com/fjvelazcop/-mermelada-mrp-app/issues/13).

Si cambia el régimen de **Ordinario** a **Especial / SPE**, el sistema marca
automáticamente «Sujeto Pasivo Especial», «Agente de Retención de IVA» y
«Agente de Retención de ISLR» como condición declarativa. No enciende los cálculos
de retención: `vatWithholdingEnabled` e `islrWithholdingEnabled` permanecen en
`false` hasta la validación contable. El usuario confirmó que hoy somos
contribuyentes **ordinarios** (fabricación de mermelada): IVA 16% de referencia
general para mermelada procesada/envasada, exentos/8% y conceptos de ISLR
pendientes del contador, y UT de referencia Bs. 43,00.

En **Configuración → Datos Fiscales** puede guardar, sin activar emisión real,
los datos de facturación digital: proveedor autorizado, RIF del proveedor, URL
del servicio, ambiente, certificado (solo etiqueta/serial), fecha prevista y
notas. La casilla «Configuración de facturación digital preparada / borrador» no
envía nada al SENIAT; solo exige que los datos estén completos. Tampoco se guardan
secretos ni claves privadas en la base de datos.
La adaptación a SNAT/2026/00093 debe planificarse antes del 19/04/2027.
**No use las notas de entrega como documento fiscal**.

---

## 7. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El navegador pide usuario y contraseña antes del login | Basic Auth de la interfaz activada (`UI_AUTH_ENABLED=true`) | Use las credenciales de UI y luego ingrese con su usuario personal. Si no debe pedirlas, el administrador puede desactivar esa barrera. |
| No aparece el login y los módulos quedan bloqueados | El navegador no pudo verificar `/api/health` o el servidor no está disponible | Use **Reintentar conexión** en el login. Si continúa, solicite al administrador revisar el servicio y `/api/health`; el acceso se mantiene protegido mientras no se pueda verificar. |
| “Usuario o contraseña inválidos” | Credenciales incorrectas o usuario inactivo | Verifique mayúsculas; pida al administrador restablecer la clave. |
| “Demasiados intentos de inicio de sesión” | Límite de seguridad (429) | Espere unos minutos y reintente; no siga probando claves. |
| Un módulo no aparece | Su rol no tiene permiso de lectura | Solicite permisos al administrador. |
| No puede eliminar un usuario | Tiene actividad registrada | Desactívelo en lugar de eliminarlo. |
| No puede eliminar un proveedor | Tiene precios/compras asociadas | Desactívelo. |
| El stock no cuadra | Movimientos sin registrar o merma no documentada | Revise el historial de movimientos y registre el ajuste con motivo. |
| La página no carga | Túnel caído o URL antigua | Solicite la URL vigente al administrador. |

---

## 8. Glosario

- **BOM / receta:** lista de materiales y cantidades para producir un lote.
- **Merma:** pérdida de material durante el proceso.
- **Lote:** cantidad producida en una corrida, identificada con un número.
- **Nota de entrega:** documento de despacho; no es factura fiscal.
- **RIF:** Registro de Información Fiscal del cliente o proveedor.
- **Tasa BCV:** tipo de cambio oficial usado para expresar montos en Bs.
- **Crédito fiscal:** IVA soportado en compras que puede compensarse.
- **RBAC:** permisos asignados por rol.

---

## 9. Soporte

Para altas, bajas, cambios de rol, restablecimiento de contraseñas, backups o
incidencias técnicas, contacte al administrador del sistema. Conserve el
mensaje de error completo y la hora aproximada: facilita la revisión de la
auditoría.
