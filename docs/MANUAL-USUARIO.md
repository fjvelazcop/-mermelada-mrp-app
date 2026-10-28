# Manual de Usuario — Mermelada ERP

**Versión:** 1.0 · **Última actualización:** 28/10/2026
**Aplicación:** PulpaCraft MRP / Mermelada ERP
**Alcance:** personal administrativo, supervisores, operadores de planta, almacén y costos.

> Este manual describe cómo usar el sistema. No sustituye la asesoría contable
> ni tributaria. El ERP **todavía no emite facturas fiscales**; consulte la
> sección [Estado fiscal](#estado-fiscal-actual).

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
- Auditoría de las operaciones y administración de usuarios.

Todos los módulos comparten la misma base de datos, por lo que una venta
descuenta inventario y deja rastro en la auditoría.

---

## 2. Cómo ingresar

### 2.1. Acceso a la interfaz

1. Abra la URL pública vigente del ERP. La URL cambia cuando se reinicia el
   túnel rápido; el administrador la recibe por correo y también puede
   consultarla en `GET /api/system/tunnel`.
2. Si el navegador muestra una ventana de **autenticación básica**, introduzca
   las credenciales de la interfaz:
   - Usuario: `erp-ui`
   - Contraseña: la definida por el administrador en `UI_AUTH_PASSWORD`.
3. A continuación aparece la pantalla de **inicio de sesión del ERP**. Use su
   usuario personal y su contraseña.

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
compartidos. La sesión expira a las 8 horas.

---

## 3. Roles y permisos

| Rol | Uso típico | Acceso general |
|---|---|---|
| **Administrador** | Dirección / sistemas | Todos los módulos, usuarios, roles, configuración y auditoría. |
| **Supervisor de planta** | Jefe de producción | Producción, inventario, costos, reportes y parte de la administración. |
| **Operador** | Personal de planta | Producción e inventario operativo. |
| **Analista de costos** | Costos y precios | Costeo, recetas, precios y reportes financieros. |
| **Almacenista** | Almacén | Inventario, entradas, salidas y ajustes. |

Los permisos son por módulo y por acción (**ver, crear, editar, eliminar,
exportar**). Si un módulo no aparece en el menú, su rol no tiene permiso de
lectura. Solicite el cambio al administrador.

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

### 4.4. Inventario y almacén

- **Materia prima:** stock actual, mínimo, unidad, costo y proveedor.
- **Producto terminado:** unidades disponibles y reservadas por pedidos.
- **Movimientos:** entradas, salidas, ajustes y mermas. Cada movimiento guarda
  quién lo realizó.
- **Alertas:** los insumos por debajo del mínimo se resaltan para reposición.

Buenas prácticas:

- Registre la merma real, no la teórica.
- No ajuste stock para “cuadrar” sin documentar el motivo.
- Verifique la unidad de medida (kg, g, unidad) antes de guardar.

### 4.5. Ventas y despacho

1. Seleccione el cliente (con RIF) y agregue productos.
2. El sistema calcula subtotal, IVA (16 %) y total en USD y Bs. según la tasa.
3. Guarde el pedido: queda registrado quién lo creó y se reserva inventario.
4. Genere la **nota de entrega** cuando el pedido salga del almacén.
5. Registre el **cobro** indicando banco, método de pago y referencia.

Importante:

- Una nota de entrega **no es una factura fiscal**.
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
- Registre proveedor, RIF, número de factura y datos fiscales cuando aplique.
- El IVA de gastos con factura válida puede registrarse como crédito fiscal.
- Cada gasto guarda el usuario que lo registró.

### 4.8. Directorio de proveedores

- Datos de contacto, RIF y condiciones de pago.
- Historial de precios por insumo.
- Un proveedor con precios o compras registradas no debe eliminarse; desactívelo.

### 4.9. Configuración y permisología

Disponible para administradores:

- **Usuarios:** crear, editar, desactivar y asignar roles.
- **Roles:** matriz de permisos por módulo y acción.
- **Datos fiscales:** razón social, RIF, dirección, serie y datos de contacto.
- **Auditoría:** consulta de eventos por módulo y usuario.

### 4.10. Documentación y guía

Referencia interna de arquitectura, módulos y flujos. Úsela para resolver dudas
sobre el funcionamiento del sistema.

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

El sistema **no emite todavía facturas fiscales**. Hoy produce:

- Pedidos de venta.
- Notas de entrega.
- Registro de cobros.
- Gastos con datos fiscales y crédito de IVA.

La facturación fiscal venezolana (numeración y control, libros de ventas y
compras, notas de crédito/débito, retenciones y facturación digital) está
planificada en el issue **#11** y requiere validación con un contador público.
Mientras tanto, **no use las notas de entrega como documento fiscal**.

---

## 7. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El navegador pide usuario y contraseña antes del login | Basic Auth de la interfaz | Use `erp-ui` y la clave de UI; luego ingrese con su usuario personal. |
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
