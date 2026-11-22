# Manual de Administración — Mermelada ERP

**Versión:** 1.4 · **Última actualización:** 22/11/2026
**Audiencia:** responsable técnico / administrador del sistema.
**Documentos relacionados:** [`MANUAL-USUARIO.md`](./MANUAL-USUARIO.md), [`../DEPLOYMENT.md`](../DEPLOYMENT.md), [`../README.md`](../README.md).

---

## 1. Arquitectura en una página

```
Navegador
   │  HTTPS
   ▼
Cloudflare Quick Tunnel (cloudflared, proceso PM2 "mermelada-tunnel")
   │  HTTP loopback 127.0.0.1:4000
   ▼
Angular SSR + Express (proceso PM2 "mermelada-erp")
   ├── /api/*  → bearer token + RBAC + rate limit
   ├── UI      → HTTP Basic Auth opcional (UI_AUTH_ENABLED)
   └── SQLite  → data/mermelada.db (WAL + foreign keys)
```

- El servidor escucha en `0.0.0.0:4000` pero el acceso público pasa por el túnel.
- El túnel reporta la URL al backend por un callback **solo loopback** protegido
  con `TUNNEL_INTERNAL_TOKEN`.
- Las copias de seguridad las ejecuta **cron**, no PM2, para que sigan
  funcionando aunque la app esté caída.

---

## 2. Operación diaria

### 2.1. Arrancar / reiniciar

```bash
cd /home/fjvel/proyectos/mermelada

pm2 start ecosystem.config.cjs --update-env   # primera vez o tras cambiar .env
pm2 restart mermelada-erp --update-env        # solo la app
pm2 restart mermelada-tunnel --update-env     # solo el túnel
pm2 save                                      # persistir la lista actual
pm2 status
```

En PM2 nativo, configura `DB_PATH=./data/mermelada.db` en `.env.production`;
`/app/data/mermelada.db` es una ruta interna de Docker y puede impedir que el
backend arranque en el host. PM2 prioriza `.env.production` sobre `.env`, así
que verifica que allí también estén los datos SMTP reales, no los valores de
ejemplo, antes de esperar el correo del túnel.

### 2.2. Verificar salud

```bash
curl -s http://127.0.0.1:4000/api/health | jq
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/api/health
```

Respuesta esperada: `status: "ok"`, `database.connected: true`,
`authEnabled: true`.

### 2.3. Logs

```bash
pm2 logs mermelada-erp --lines 200
pm2 logs mermelada-tunnel --lines 200
pm2 logs mermelada-tunnel --lines 50 --nostream  # ver la URL publicada más reciente
tail -n 100 logs/backup.log
tail -n 100 logs/tunnel-out.log
```

### 2.4. Arranque automático tras reinicio del servidor

`pm2 save` guarda la lista, pero **falta el servicio systemd** de PM2. Ejecutar
una sola vez:

```bash
sudo env PATH=$PATH:/home/fjvel/.nvm/versions/node/v24.21.0/bin \
  /home/fjvel/.nvm/versions/node/v24.21.0/lib/node_modules/pm2/bin/pm2 \
  startup systemd -u fjvel --hp /home/fjvel
```

Comprobar después: `systemctl is-enabled pm2-fjvel` debe responder `enabled`.

---

## 3. Variables de entorno

El fichero real es `.env` (no se versiona). `.env.production` tiene prioridad si
existe. Plantillas: `.env.example` y `.env.production.example`.

| Grupo | Variables | Notas |
|---|---|---|
| Aplicación | `NODE_ENV`, `HOST`, `PORT`, `APP_URL`, `APP_VERSION`, `NG_ALLOWED_HOSTS` | `NG_ALLOWED_HOSTS` nunca debe ser `*`. |
| Base de datos | `DB_PATH` | Por defecto `./data/mermelada.db`. |
| Autenticación | `AUTH_ENABLED`, `AUTH_SECRET`, `AUTH_TOKEN_TTL_SECONDS`, `AUTH_SEED_PASSWORD` | `AUTH_SEED_PASSWORD` solo aplica al sembrado inicial de los 5 usuarios demo. |
| UI | `UI_AUTH_ENABLED`, `UI_AUTH_USER`, `UI_AUTH_PASSWORD` | Usa `false` para mostrar el login de la app sin el cuadro Basic Auth del navegador. |
| Rate limiting | `RATE_LIMIT_ENABLED`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_LOGIN_WINDOW_MS`, `RATE_LIMIT_LOGIN_MAX` | En memoria; desactivado automáticamente con `NODE_ENV=test`. |
| Túnel | `TUNNEL_ENABLED`, `TUNNEL_MODE`, `TUNNEL_TOKEN`, `TUNNEL_PUBLIC_URL`, `TUNNEL_INTERNAL_TOKEN`, `TUNNEL_CLOUDFLARED` | `quick` cambia de URL al reiniciar; `token` requiere dominio en Cloudflare. |
| Correo | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_FROM_NAME`, `SMTP_BCC`, `SMTP_TO` | `SMTP_TO` solo siembra destinatarios la primera vez. |
| Backups | `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_REMOTE`, `BACKUP_REMOTE_RETENTION_DAYS`, `BACKUP_S3_*`, `BACKUP_GDRIVE_*` | Ver sección 5. |

Configura `UI_AUTH_ENABLED=false` para que al abrir o reiniciar el sitio se
muestre la página de login de la aplicación, sin el diálogo de usuario y
contraseña del navegador. `AUTH_ENABLED=true` mantiene la autenticación y los
permisos por rol de la API.

Tras modificar `.env`, reinicie con `--update-env` (PM2 no recarga variables
solo).

---

## 4. Usuarios, roles y auditoría

### 4.1. Crear un usuario

**Configuración → Usuarios → Nuevo Usuario**. Si deja la contraseña vacía, el
usuario recibe **`inicio123`** y debe cambiarla al primer ingreso. También puede
fijar una clave inicial concreta (mínimo 8 caracteres).

### 4.2. Desactivar vs. eliminar

| Situación | Acción |
|---|---|
| El usuario nunca registró actividad | Se puede eliminar. |
| Tiene ventas, inventario, producción, gastos, precios de proveedores o auditoría | **Desactivar** (estado inactivo). |

El backend valida esto en `deleteUser()` y devuelve `400` con los módulos donde
encontró actividad. Nunca borre filas de `auth_users` directamente en SQLite.

### 4.3. Roles

Los roles base (`admin`, `supervisor_planta`, `operator`, `analista_costos`,
`almacenista`) no se pueden eliminar. Los roles personalizados sí, siempre que
no tengan usuarios asignados. La matriz de permisos se edita por módulo y acción
(`view`, `create`, `edit`, `delete`, `export`).
El rol `admin` mantiene siempre las cinco acciones activas en todos los módulos:
la matriz las muestra seleccionadas y no permite desactivarlas; la autorización
también se aplica en el backend. Las obligaciones fiscales nuevas heredan esta
misma regla y, además, exigen `admin` directamente en la API.

### 4.4. Auditoría

`GET /api/audit-logs` y la vista **Auditoría** muestran los eventos con usuario,
rol, módulo y detalle. El log general conserva hasta 500 eventos recientes
tanto en memoria como en SQLite. El historial de decisiones de obligaciones
fiscales se almacena por separado y no usa ese límite.

---

## 5. Copias de seguridad

### 5.1. Configuración actual

- Script: `scripts/backup-db.mjs`; wrapper de cron: `scripts/backup-cron.sh`.
- Frecuencia: **dos veces al día** (`0 2,14 * * *`) y **una copia al arranque**
  del equipo (`@reboot`, con 90 s de espera). Cron no recupera ejecuciones
  perdidas si el equipo estaba apagado; la copia de arranque cubre ese hueco.
- Destino local: `backups/mermelada-<ISO>.db`, permisos `600`.
- Retención local: **15 días** (`BACKUP_RETENTION_DAYS=15`).
- Integridad: se ejecuta `PRAGMA integrity_check` antes de copiar y se aborta si
  no devuelve `ok`.
- Copia externa opcional: `BACKUP_REMOTE=none|s3|gdrive`. Un fallo remoto
  **no elimina** la copia local; el proceso termina con código 1 para que cron o
  el monitoreo alerten.

Crontab vigente:

```cron
0 2,14 * * * PATH=/home/fjvel/.nvm/versions/node/v24.21.0/bin:/usr/local/bin:/usr/bin:/bin /home/fjvel/proyectos/mermelada/scripts/backup-cron.sh
@reboot sleep 90 && PATH=/home/fjvel/.nvm/versions/node/v24.21.0/bin:/usr/local/bin:/usr/bin:/bin /home/fjvel/proyectos/mermelada/scripts/backup-cron.sh
```

### 5.2. Verificar

```bash
crontab -l
tail -n 30 logs/backup.log
ls -lh backups | tail

# Integridad de la copia más reciente
node -e "
const fs=require('fs');
const Database=require('better-sqlite3');
const f=fs.readdirSync('backups').filter(x=>x.endsWith('.db')).sort().pop();
const db=new Database('backups/'+f,{readonly:true});
console.log(f, db.pragma('integrity_check',{simple:true}));
"
```

### 5.3. Restaurar una copia

> Detenga la aplicación antes de restaurar. El backup es un fichero SQLite
> completo y consistente.

```bash
cd /home/fjvel/proyectos/mermelada
pm2 stop mermelada-erp

# Guarde la base actual por si la restauración no es la correcta
cp data/mermelada.db "data/mermelada.db.pre-restore-$(date +%F-%H%M)"
rm -f data/mermelada.db-wal data/mermelada.db-shm

# Elija la copia a restaurar
ls -lt backups | head
cp backups/mermelada-<FECHA>.db data/mermelada.db
chmod 600 data/mermelada.db

node -e "
const Database=require('better-sqlite3');
const db=new Database('data/mermelada.db',{readonly:true});
console.log(db.pragma('integrity_check',{simple:true}));
console.log('usuarios', db.prepare('SELECT COUNT(*) c FROM auth_users').get().c);
"

pm2 start mermelada-erp
curl -s http://127.0.0.1:4000/api/health
```

### 5.4. Copia externa

```dotenv
# S3 / R2 / MinIO / B2
BACKUP_REMOTE=s3
BACKUP_S3_BUCKET=mi-bucket
BACKUP_S3_REGION=us-east-1
BACKUP_S3_PREFIX=mermelada/backups
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
# BACKUP_S3_ENDPOINT=https://...   # solo S3 compatible
# BACKUP_S3_FORCE_PATH_STYLE=true  # MinIO

# Google Drive (service account con la carpeta compartida)
BACKUP_REMOTE=gdrive
BACKUP_GDRIVE_FOLDER_ID=...
BACKUP_GDRIVE_SERVICE_ACCOUNT_FILE=/ruta/service-account.json
```

Prueba manual (no espera a cron):

```bash
npm run backup:db
```

La copia remota solo purga ficheros `mermelada-*.db` con antigüedad mayor a
`BACKUP_REMOTE_RETENTION_DAYS`.

---

## 6. Túnel, URL pública y correo

### 6.1. URL vigente

Para consultar la URL del túnel en ejecución sin autenticarse en la API:

```bash
pm2 status
pm2 logs mermelada-tunnel --lines 50 --nostream
```

Busque la línea `[tunnel] public URL detected: https://...` (modo `quick`)
o `[tunnel] registered https://...` (modo `token`). También puede seguir los
logs en vivo con `pm2 logs mermelada-tunnel`.

```bash
curl -s http://127.0.0.1:4000/api/system/tunnel \
  -H "Authorization: Bearer <token-admin>" | jq
tail -n 50 logs/tunnel-out.log | grep -i "public URL"
```

En modo `quick` la URL cambia en cada reinicio del proceso
`mermelada-tunnel`. Para una URL fija, cree un túnel nombrado en Cloudflare
Zero Trust y configure `TUNNEL_MODE=token`, `TUNNEL_TOKEN` y
`TUNNEL_PUBLIC_URL`.

Cada vez que el túnel se inicia o reinicia, registra la nueva URL y envía el
correo a los destinatarios activos si SMTP está configurado. Reiniciar solo
`mermelada-erp` no cambia la URL ni genera otro correo. Para obtener y notificar
una URL nueva, reinicie el túnel:

```bash
pm2 restart mermelada-tunnel --update-env
```

### 6.2. Reenviar el correo con las URLs

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<clave-admin>"}' | jq -r .token)

curl -s -X POST http://127.0.0.1:4000/api/notifications/tunnel/resend \
  -H "Authorization: Bearer $TOKEN" | jq
```

Destinatarios: `GET/POST /api/notifications/recipients`. Historial y estado de
cada intento: `GET /api/notifications/log`. El estado `enviado` significa que
SMTP confirmó todos los destinatarios; `parcial` identifica los aceptados y
rechazados, y `fallido` indica que no se confirmó ninguno después de tres
intentos. Si SMTP no está configurado o no hay destinatarios activos, el envío
queda como `omitido` con su causa y el túnel se registra igual. Para un envío
fallido, corrija SMTP/destinatarios y use el endpoint de reenvío indicado arriba.

### 6.3. Recuperación y cambio de contraseña

El correo de recuperación se envía **al correo del propio usuario**, no a la
lista de destinatarios de alertas. El enlace usa el fragmento
`/login#reset=<token>`, por lo que el token no viaja al servidor ni en el
`Referer`, y también incluye el código manual. El enlace y el código vencen en
`AUTH_RESET_TTL_SECONDS` (30 minutos por defecto) y son de un solo uso.

El campo de acceso acepta **usuario o correo** (`fjvelazco` o
`fjvelazco@gmail.com`); el correo se compara sin distinguir mayúsculas. Tras 10
intentos fallidos para el mismo usuario e IP, el login se bloquea 15 minutos
(`RATE_LIMIT_LOGIN_MAX` / `RATE_LIMIT_LOGIN_WINDOW_MS`).

Requisitos:

- `SMTP_HOST`, `SMTP_FROM` y credenciales válidas.
- `SMTP_FROM` debe coincidir con `SMTP_USER` o con un alias «Enviar como»
  verificado; de lo contrario Gmail puede reescribir el remitente o rechazar el
  mensaje.
- `APP_URL` debe ser la URL pública real (por ejemplo
  `https://erp.tudominio.com`), porque de ahí sale el enlace. Si `APP_URL` está
  vacío, en `localhost` o en `127.0.0.1`, el sistema usa el origen público de la
  petición (`X-Forwarded-Host`/`Host`), lo que mantiene los enlaces válidos
  detrás de un túnel cuya URL cambia.
- En producción no configure `AUTH_RESET_EXPOSE_TOKEN=true`: el token solo se
  entrega por correo.

Comprobar el envío:

```bash
curl -s -X POST http://127.0.0.1:4000/api/auth/reset-password \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"usuario"}'

node -e "const D=require('better-sqlite3');const db=new D('./data/mermelada.db',{readonly:true});console.log(db.prepare(\"SELECT kind,status,recipients,error,created_at FROM notification_log WHERE kind IN ('password-reset','password-changed') ORDER BY created_at DESC LIMIT 5\").all());db.close()"
```

Estados: `enviado` (SMTP aceptó al usuario y al BCC), `parcial` (revisar
`error`), `fallido` (revisar credenciales/red) u `omitido` (SMTP incompleto).
Tras un cambio de contraseña autenticado se envía un aviso de seguridad
`password-changed` al mismo usuario.

### 6.4. Si el túnel no arranca

1. `pm2 logs mermelada-tunnel --lines 100`.
2. Verifique `cloudflared version` y `TUNNEL_CLOUDFLARED`.
3. Confirme que la app responde en `127.0.0.1:4000`.
4. `pm2 restart mermelada-tunnel --update-env`.

---

## 7. Endurecimiento de seguridad

Siempre activo en todas las respuestas:

- `X-Powered-By` eliminado.
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` restrictiva.
- `Strict-Transport-Security` solo sobre HTTPS (incluye peticiones con
  `X-Forwarded-Proto: https` del túnel).
- `Content-Security-Policy-Report-Only` (se valida antes de aplicarla).

Rate limiting en memoria:

- Global: 300 solicitudes/minuto por IP.
- Login: 10 intentos/15 minutos por IP + usuario.
- Respuesta `429` con `Retry-After` y cabeceras `RateLimit-*`.
- Exentos: `/api/health`, `/api/openapi.json`, `/api/docs`,
  `/api/internal/tunnel`.

Verificación rápida:

```bash
curl -sI http://127.0.0.1:4000/api/health | grep -iE 'x-powered-by|x-content-type|x-frame|referrer|permissions|rate-limit'

# Fuerza el límite: las últimas respuestas deben ser 429
for i in $(seq 1 12); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST \
    http://127.0.0.1:4000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"limite","password":"clave-invalida"}'
done; echo
```

Si algún día se ejecutan varias instancias, mueva el limitador a Redis: el
actual es por proceso.

---

## 8. Pruebas y despliegue

```bash
npm run test:server            # 200+ tests de integración
npm run test:server:coverage   # umbral: 80 % líneas/funciones/statements, 70 % ramas
npm run lint
npm run build

pm2 restart mermelada-erp --update-env
pm2 restart mermelada-tunnel --update-env
pm2 save

npm run smoke:prod             # health + OpenAPI + shell Angular (con Basic Auth si aplica)
```

Flujo recomendado: trabajar en `develop`, verificar los cuatro comandos y luego
`git push`. El repositorio remoto es
`https://github.com/fjvelazcop/-mermelada-mrp-app`.

---

## 9. Estado fiscal (issue #11)

El sistema ya emite facturas fiscales vinculadas a pedidos, notas de crédito y
débito, e informes mensuales de libros de Ventas y Compras. La representación
imprimible, las reglas tributarias y los reportes requieren validación de un
contador; esto **no equivale a homologación ni autorización del SENIAT**.

### 9.1. Configuración fiscal desde la interfaz (solo administrador)

Ruta: **Configuración → Datos Fiscales**. La pestaña solo aparece para el rol
`admin` y el endpoint de escritura `PUT /api/fiscal-settings` también exige ese
rol (la lectura se mantiene disponible para usuarios autenticados porque las
notas de entrega la necesitan).

Datos que se guardan en la tabla `fiscal_settings` de SQLite:

| Grupo | Campos |
|---|---|
| Emisor | razón social, RIF, dirección fiscal, teléfono, correo, actividad económica y régimen tributario |
| Sucursal | nombre y dirección del establecimiento |
| IVA y numeración | alícuota, prefijo/serie, siguiente número de factura, consecutivos de notas de crédito/débito, prefijo y siguiente número de control, autorización SENIAT y vigencia |
| Retenciones | condición de agente de IVA/ISLR y porcentajes aplicables |
| SPE y libros | Sujeto Pasivo Especial, formato de libros (XLSX/CSV/PDF/TXT) y tratamiento de órdenes históricas |
| Contabilidad (v14) | `accountingEnabled` (activo), `vatWithholdingEnabled` y `islrWithholdingEnabled` (ambos `false` hasta validar #13) |
| Facturación digital (v15) | casilla de preparación, proveedor, RIF del proveedor, URL/API, ambiente, etiqueta/serial y vencimiento del certificado, fecha prevista y notas; **no emite ni envía al SENIAT** |
| Impresión | leyendas legales que se imprimen en los documentos |

Cada guardado actualiza la base de datos de forma inmediata y genera un evento
de auditoría con actor, rol, campos modificados y valores anteriores/nuevos.
El código de autorización se redacta y no aparece en el detalle del evento.
Los cambios se consultan en `GET /api/audit-logs?module=ventas`; conserva hasta
500 eventos recientes, por lo que no debe tratarse como archivo legal inmutable.

**Transición a SPE:** el cambio real de `taxRegime` de `ordinario` a `especial`
ejecuta `updateFiscalSettings` en servidor y fuerza `specialTaxpayer=true`,
`vatWithholdingAgent=true` e `islrWithholdingAgent=true`. El evento de auditoría
incluye `autoSpecialTaxpayerTransition: true`. No se activan
`vatWithholdingEnabled` ni `islrWithholdingEnabled`. La reversión no desmarca
automáticamente estos campos: debe revisarse manualmente.

Antes de emitir documentos fiscales, el administrador debe confirmar estos
valores con el contador. Antes de habilitar emisión real, revise RIF del emisor/cliente,
alícuotas, tasa BCV, prefijos y consecutivos disponibles. El servidor verifica
el formato de RIF, que el documento coincida con la ficha del cliente, la tasa
positiva y que no se reutilicen números de factura/control. Los importes se
registran en USD y los equivalentes en Bs. se calculan con la tasa guardada en
el pedido.

### 9.2. Registro de obligaciones y validaciones (solo administrador)

Ruta: **Configuración → Datos Fiscales → Obligaciones y validaciones**. El rol
administrador mantiene acceso completo a todos los módulos y acciones; para los
demás roles, la sección no aparece y las rutas API de lectura y escritura
devuelven prohibido.

Seleccione una obligación y registre el resultado (**Pendiente**, **Aplica** o
**No aplica**), referencia normativa/evidencia, fecha de revisión y conclusión
del contador. Para confirmar “Aplica” o “No aplica”, la API exige fecha y
referencia u observaciones. Guarde cada decisión para agregarla al historial,
que muestra el estado anterior/nuevo y quién/cuándo la registró.

El historial se conserva en tablas dedicadas de SQLite y no tiene una acción
para editar o borrar eventos desde la interfaz. Inclúyalo en los respaldos
regulares. El registro documenta decisiones; **no calcula impuestos, no activa
retenciones ni integra facturación digital**. No cargue tokens, contraseñas ni
credenciales en referencias u observaciones. El contador externo no tiene una
cuenta de acceso predeterminada.

Estado de las fases:

| Fase (plan original) | Alcance | Estado |
|---|---|---|
| 0 | Datos fiscales validados, régimen de IVA, series y numeración | Implementado; falta confirmar datos reales con el contador |
| 1 | Factura fiscal imprimible, anulación y notas de crédito/débito | Implementado técnicamente; pendiente validación normativa |
| 2 | Libros mensuales de Ventas/Compras, conciliación, cierre y exportación | Implementado; CSV auditado con hash y cierre bloqueante |
| 3 | Contabilidad formal: plan de cuentas, Diario, Mayor, Inventarios y Balances/estados financieros | **En curso**: plan base, asientos, Diario, Mayor, Balances, Estado de resultados e Inventario disponibles como **borrador/prueba**; formatos y saldos pendientes en [#13](https://github.com/fjvelazcop/-mermelada-mrp-app/issues/13) |
| 4 | Retenciones de IVA/ISLR y comprobantes | Bloqueado hasta validación contable; flags en `false` |
| 5 | Facturación digital y migración a SNAT/2026/00093 | Configuración de **preparación** implementada (v15); sin emisión real ni envío al SENIAT; fecha límite 19/04/2027 |

El plan de ejecución ampliado usa ocho hitos (0–7): la **Fase 0** es el gate de
validación contable del issue #13 y la **Fase 1** (núcleo contable) ya está
implementada. Se han adelantado entregables no sensibles de las fases 2–7:
libros y reportes en modo **BORRADOR / PRUEBA** y la configuración de
facturación digital como preparación. La emisión digital real, las retenciones y
los consecutivos oficiales se ejecutarán solo después de cerrar ese gate.

La normativa vigente aplica hasta el **18/04/2027**; el nuevo régimen
(`SNAT/2026/00093`) entra en vigor el **19/04/2027**. Cualquier cambio fiscal
debe validarse con un contador público antes de producción.

### 9.5. Acciones y responsables del flujo fiscal

| Responsable | Acciones |
|---|---|
| Administrador del ERP | Coordinar validación con contador; completar y revisar datos fiscales; revisar datos maestros; consultar auditoría; resolver diferencias de libros; exportar; cerrar solo períodos conciliados; conservar respaldos. |
| Usuario con permiso de ventas | Verificar RIF/datos del cliente, montos, condición de venta y tasa antes de guardar el pedido. La factura se genera automáticamente si la emisión está habilitada. Si hay un bloqueo, no modificar configuración para eludirlo: escalarlo al administrador. |
| Administrador autorizado para documentos fiscales | Anular con motivo, crear notas justificadas, revisar duplicados, conciliar/exportar libros y cerrar períodos aprobados. No modificar facturas emitidas ni editar la base de datos directamente. |
| Contador/especialista externo | Confirmar régimen, obligaciones, tasas, leyendas y formato de documentos/libros; registrar las decisiones en el issue [#13](https://github.com/fjvelazcop/-mermelada-mrp-app/issues/13). No tiene un rol de aplicación por defecto. |
| Desarrollo/responsable técnico | Implementar requisitos ya confirmados, agregar pruebas y controles API/RBAC, actualizar este plan y manuales, y separar P1/P2 en issues de ejecución. |

No habilite retenciones, IGTF, SPE ni facturación digital basándose solo en los
campos de configuración existentes: estos campos no equivalen a módulos
funcionales ni acreditan la condición legal de la empresa.

### 9.3. Emisión y documentos relacionados

- La factura se crea automáticamente al registrar un pedido cuando `enabled`
  está activo. Mantenga el RIF del cliente en su ficha; el sistema usa la ficha
  como fuente y bloquea si el RIF del pedido no coincide.
- Las ventas se registran en USD. El backend calcula equivalentes en Bs. con la
  tasa positiva guardada en el pedido y no acepta importes Bs. manipulados desde
  el navegador.
- La validación de alícuota exige una tasa positiva en líneas gravadas; exento y
  no sujeto se identifican explícitamente.
- El número de factura debe estar libre dentro de la serie. El número de control
  no puede repetirse entre facturas ni notas. Los consecutivos no se reutilizan
  al anular.
- La anulación y la creación de notas están restringidas al administrador.
  Las notas de crédito no pueden superar el saldo original pendiente de acreditar
  por categoría/alícuota.

### 9.4. Libros mensuales, exportación y cierre

En **Facturación Fiscal → Libros fiscales mensuales**, seleccione el período y
consulte ventas, compras y conciliación. **Exportar CSV** entrega dos archivos
(Ventas y Compras); antes de generarlos, el sistema registra en auditoría el
usuario, período, totales y SHA-256 del mismo snapshot devuelto para descarga.
El cierre del período también queda auditado e incluye una huella SHA-256.

El cierre es definitivo desde la interfaz: bloquea nuevas facturas, notas y
altas/bajas de gastos cuya fecha pertenezca al mes cerrado. Revise las
diferencias, los documentos incluidos y los archivos descargados antes de
confirmar. Para corregir información tras el cierre debe seguirse el
procedimiento contable aplicable; no modifique SQLite directamente.

### 9.6. Núcleo contable (Fase 1 del plan ampliado)

**Migración v14.** Antes de aplicarla se creó
`backups/mermelada-2026-11-22T01-46-31-760Z.db`. La migración crea
`accounts`, `accounting_entries`, `accounting_entry_lines` y
`accounting_periods`, además de las columnas `accounting_enabled`,
`vat_withholding_enabled` e `islr_withholding_enabled` en `fiscal_settings`.
El plan base de 35 cuentas se siembra automáticamente incluso en bases
existentes; verifique con:

```bash
node -e "const D=require('better-sqlite3');const d=new D('data/mermelada.db',{readonly:true});console.log(d.prepare('SELECT MAX(version) v FROM schema_migrations').get(),d.prepare('SELECT COUNT(*) c FROM accounts').get());"
```

Resultado esperado: versión `14` y 35 cuentas (`is_system=1`).

**API y RBAC.** El módulo top-level `accounting` se protege con RBAC propio;
admin/master tienen todos los permisos. Confirmar/anular asientos y
cerrar/reabrir períodos están restringidos a esos roles. Las rutas
`/api/payables*` siguen protegidas por `expenses` y no cambiaron. Los 9 paths y
los esquemas `Account`, `AccountInput`, `AccountingEntry`,
`AccountingEntryInput`, `AccountingPeriod`, `AccountingBookRow`,
`AccountingBookMetadata` y `AccountingBookReport` están documentados en
`/api/openapi.json`.

**Reglas de asientos.** Todo asiento debe estar balanceado; las líneas no
pueden tener débito y crédito a la vez y deben referirse a cuentas activas. Los
asientos automáticos usan `sourceType + sourceId` como clave de idempotencia y
se confirman solos. Un período cerrado bloquea nuevos asientos de ese mes;
solo admin/master puede reabrirlo. La anulación conserva auditoría con motivo.

**Verificación de la Fase 1:** `npm run build`, `npm run lint`,
`npm test -- --watch=false` (74/74), `npm run test:server` (415/415), verificación
de `/api/openapi.json`, reinicio de PM2 y `GET /api/health` → 200 con DB v16.

### 9.7. Libros contables provisionales

Los libros no requieren migración: se calculan en memoria desde asientos,
facturación, cobros, pagos, gastos e inventario. El endpoint es
`GET /api/accounting/books?type=<tipo>&year=<yyyy>&month=<mm>`, protegido por el
módulo `accounting` (acción `view`). Devuelve `422` si el tipo, año o mes son
inválidos.

Tipos disponibles: `diario`, `mayor`, `balance_comprobacion`,
`balance_general`, `inventario`, `estado_resultados`, `compras`, `ventas`,
`retenciones`, `caja_banco`, `auxiliar_cxc` y `auxiliar_cxp`.

`inventario` valora el stock actual con las cuentas provisionales `1.03.01`
(Materia Prima) y `1.03.02` (Producto Terminado) del plan base. No es un
inventario formal: no incluye apertura auditada ni ajustes de cierre.

Cada respuesta incluye razón social, RIF, dirección fiscal, período, estado,
moneda USD y Bs. (columnas pareadas), tasa por documento con fallback a
`currentUsd`, columnas finales `Tasa Bs./USD` y `Origen de la tasa`, usuario,
saldo de control en ambas monedas, hash, leyenda
**BORRADOR / PRUEBA – PROVISIONAL – PENDIENTE DE VALIDACIÓN CONTABLE (#13)** y
firma. `retenciones` devuelve `SIN OPERACIONES`: las banderas
`vatWithholdingEnabled` e `islrWithholdingEnabled` siguen en `false`.

### 9.8. Configuración de facturación digital (preparación)

**Migración v15.** Backup previo:
`backups/mermelada-2026-11-22T03-42-01-675Z.db`. La migración añade columnas a
`fiscal_settings` para guardar proveedor autorizado, RIF del proveedor, URL/API,
ambiente (`pruebas`/`produccion`), etiqueta/serial y vencimiento del certificado,
fecha prevista de inicio y notas. No se almacenan claves privadas ni tokens.

La casilla «Configuración de facturación digital preparada / borrador» solo
marca que los datos están completos. Cuando está marcada, el backend exige
proveedor, RIF, URL, ambiente y fecha prevista; si está desmarcada, se pueden
guardar campos parciales como borrador. En ningún caso se emite un documento
digital ni se contacta al SENIAT. La transición a emisión real requiere licencia,
proveedor autorizado, integración y validación contable.

### 9.9. Fase 0: histórico de IVA/UT y parámetros pendientes

**Migración v16.** Backup previo:
`backups/mermelada-2026-11-22T04-41-19-913Z.db`. La migración crea
`fiscal_reference_values` e `accounting_book_settings` y siembra IVA 16% desde
`2020-01-01` y UT Bs. 43,00 desde `2025-06-02`, ambos en estado `referencia`,
`confirmedByAccountant=false`. IGTF queda confirmado como **no aplica**
(`false`) con referencia G.O.E. 6.687 / Decreto 4.972; no existe campo de
cálculo activo.

Ruta: **Configuración → IVA / UT e Historial (#13)** (solo admin/master).
Pestañas IVA/UT con:

- tabla de vigencias, valor, instrumento, gaceta, estado y confirmación;
- alta, edición y **anulación lógica con motivo** (sin borrado físico);
- cierre automático de la vigencia anterior al día previo, con auditoría;
- consulta del valor vigente por fecha;
- formulario de parámetros de libros: formato aprobado `xlsx,pdf`, CSV auxiliar,
  paginación, firma, política de tasa y notas.

Los valores son **solo referencia/consulta**: no modifican
`fiscalSettings.taxRatePercent`, retenciones ni cálculos de facturas/libros
hasta cerrar la Fase 0 / #13. Los eventos quedan en `GET /api/audit-logs`.

**Criterios confirmados por el usuario (2026-11-22)**, registrados también en
**Configuración → Datos Fiscales → Obligaciones y validaciones**:

- Contribuyente **ordinario**, giro **fabricación de mermelada**; SPE `no_aplica`
  mientras se mantenga esa condición.
- Retenciones **practicadas** `no_aplica` (`vatWithholdingEnabled=false` e
  `islrWithholdingEnabled=false`): no se retiene al pagar. Solo se contempla el
  **registro/control de comprobantes de retención recibidos de clientes SPE al
  cobrar**, sin cálculo real ni consecutivos hasta cerrar #13. El Libro de
  Retenciones se genera `SIN OPERACIONES` con la dirección `Recibida (cliente SPE)`.
- IGTF `no_aplica` (`false`), sin cálculo activo; revisar si cambia la condición
  de contribuyente o el manejo de divisas.
- IVA **16%** general por defecto para **mermelada procesada/envasada, azúcar,
  empaques/envases y gastos generales**. Exento **0%** previsto para materias
  primas agrícolas primarias en estado natural «según aplique»; **8%** solo para
  supuestos taxativos confirmados. Compras/Ventas separan base imponible,
  exento e impuesto, pero no calculan 0%/8% hasta cerrar #13.
- ISLR: catálogo de referencia de los seis rubros habituales del giro
  (honorarios profesionales, servicios técnicos/especializados, obras y
  servicios en general, fletes/transporte, publicidad y arrendamientos), con
  persona natural/jurídica y UT Bs. 43,00. Sustraendo y alícuotas del art. 9
  del Decreto 1.808 quedan **pendientes del contador**.
- El plan de cuentas base tiene **35 cuentas activas del sistema** (migración
  v14): `1.01.01` Caja, `1.01.02` Bancos, `1.02.01` Clientes, `2.01.01`
  Proveedores, `1.03.01` Materia Prima, `1.03.02` Producto Terminado,
  `1.04.01` Crédito Fiscal IVA, `2.02.01` IVA por Pagar y `2.02.02` Retenciones
  por Pagar (practicadas). No existe cuenta dedicada a **retenciones recibidas**
  de comprobantes que emitan clientes SPE al cobrar. Saldos de apertura, fecha
  de corte, formatos legales, firma definitiva y numeración de libro/página se
  ajustan con el contador al cerrar la Fase 0.
- Facturación digital: solo configuración/borrador, sin emisión real ni envío
  al SENIAT.

El catálogo de referencia se consulta con `GET /api/fiscal-reference-catalog`
(solo admin/master) y se muestra en la misma pantalla en dos tablas de **solo
lectura**. No tiene POST/PUT, no crea migración y no modifica `taxRatePercent`,
retenciones ni libros; se ajusta en código cuando el contador valide los
supuestos. Todas sus filas están en `referencia` con
`confirmedByAccountant=false`.

El plan de cuentas vigente se consulta en `GET /api/accounting/accounts` y en
**Contabilidad → Plan de cuentas**: 35 cuentas activas y del sistema, sembradas
en la migración v14, con caja/bancos, CxC, CxP, inventario e IVA ya presentes.
No se han creado cuentas nuevas ni modificado asientos por los criterios de
esta ronda. La cuenta para retenciones recibidas, la separación de IVA 8% y el
plan definitivo (base 35 frente a VEN-NIF de 167) quedan pendientes del
contador; si se aprueba una cuenta nueva se hará con migración v17 y backup
previo.

**Cierre formal pendiente (#13):** validación final de exentos/8% y conceptos
ISLR, cuenta contable para retenciones recibidas, saldos de apertura, fecha de
corte, formatos legales finales, firma y numeración de libro/página.

Formatos y columnas: `docs/PLANTILLAS-LIBROS.md`. Matriz de obligaciones y
cuestionario pendiente: `docs/MATRIZ-OBLIGACIONES-FISCALES.md` y
`docs/CUESTIONARIO-CONTADOR-ISSUE13.md`.

---

## 10. Solución de problemas

| Síntoma | Diagnóstico | Acción |
|---|---|---|
| `502`/página en blanco | App caída | `pm2 status`, `pm2 logs mermelada-erp` |
| `401` en la UI | Basic Auth mal configurado (solo si `UI_AUTH_ENABLED=true`) | Revise `UI_AUTH_USER`/`UI_AUTH_PASSWORD` y reinicie con `--update-env`, o desactive esa barrera |
| `503` en la UI | `UI_AUTH_ENABLED=true` sin credenciales | Defina ambas variables o desactive `UI_AUTH_ENABLED`; el sistema falla cerrado |
| La API no responde por el túnel | URL vieja, túnel caído o falta el token | `pm2 status`, `curl <URL>/api/health`, consulte la URL vigente en `GET /api/system/tunnel` y envíe `Authorization: Bearer <token>` |
| `401` en `/api/*` | Token ausente o expirado | Obtenga token en `/api/auth/login` (TTL 8 h) |
| `403` en el callback del túnel | `TUNNEL_INTERNAL_TOKEN` distinto | Iguale el secreto en backend y entorno del túnel |
| `429` | Rate limit | Espere la ventana o ajuste `RATE_LIMIT_*` |
| Correo `omitido` | SMTP incompleto | Configure `SMTP_*` y reenvíe |
| Backup no aparece | Cron o rutas | `tail logs/backup.log`, `crontab -l`, `BACKUP_DIR` |
| `database is locked` | Escritura concurrente o WAL bloqueado | Reinicie la app; no comparta el fichero por red |

---

## 11. Checklist de puesta en marcha

- [ ] `AUTH_ENABLED=true` y `AUTH_SECRET` propio.
- [ ] Contraseñas de los 5 usuarios demo cambiadas.
- [ ] Definir `UI_AUTH_ENABLED`: `true` para una barrera adicional con
      credenciales fuertes, o `false` si se prefiere evitar el doble login en el
      túnel (el login de la aplicación sigue siendo obligatorio).
- [ ] `RATE_LIMIT_*` con los valores esperados.
- [ ] `pm2 save` ejecutado.
- [ ] Servicio `pm2-fjvel` habilitado con `pm2 startup` (pendiente si no se ha
      ejecutado el comando con `sudo`).
- [ ] Cron de backup activo y `logs/backup.log` con ejecuciones recientes.
- [ ] Copia externa probada (si `BACKUP_REMOTE != none`).
- [ ] SMTP configurado y correo del túnel recibido.
- [ ] `GET /api/health` en verde desde la URL pública.
- [ ] Datos fiscales completados en **Configuración → Datos Fiscales** y
      revisados con el contador.
- [ ] RIF y datos de contacto de clientes/proveedores revisados; alícuotas y tasa
      USD/BCV verificadas.
- [ ] Serie, número de factura, números de notas y control revisados para evitar
      reutilizar consecutivos.
- [ ] Migración v14 aplicada con respaldo previo y 35 cuentas sembradas en
      `accounts`.
- [ ] Migración v15 aplicada con respaldo previo; columnas de facturación digital
      presentes en `fiscal_settings` y casilla en modo preparación.
- [ ] Módulo **Contabilidad** visible solo para roles con permiso; admin/master
      confirman/anulan asientos y cierran períodos.
- [ ] Plan de cuentas base, cuentas de control de IVA/retenciones y asientos
      automáticos revisados con el contador en el issue #13.
- [ ] Un período de libros exportado y conciliado en pruebas antes del primer
      cierre operativo.
- [ ] Revisión de documentos, leyendas, tasas y libros completada con el contador
      y documentada en el issue #13.
- [ ] Obligaciones de retenciones, SPE, IGTF y facturación digital confirmadas;
      abrir issues de implementación solo para las aplicables.
- [ ] Plan P1 aprobado y facturación digital/SNAT/2026/00093 priorizada para
      cumplir antes del 19/04/2027.
