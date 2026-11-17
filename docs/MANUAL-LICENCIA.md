# Manual de licencia del sistema — Mermelada ERP

Este documento describe la operación de la **licencia global del ERP**. Va dirigido al
licenciante (emisión de tokens) y al responsable técnico/aplicación en el servidor.

> La licencia es **una sola para todo el ERP**, no por cliente. `activation_records`
> sigue siendo el libro de pagos/control de activaciones y **no** es la licencia.

Índice:

1. [Conceptos](#1-conceptos)
2. [Roles y permisos](#2-roles-y-permisos)
3. [Claves Ed25519](#3-claves-ed25519)
4. [Instalación inicial](#4-instalación-inicial)
5. [CLI de licencia](#5-cli-de-licencia)
6. [Procedimientos](#6-procedimientos)
7. [API HTTP](#7-api-http)
8. [Interfaz de usuario](#8-interfaz-de-usuario)
9. [Alertas por correo](#9-alertas-por-correo)
10. [Solución de problemas](#10-solución-de-problemas)
11. [Pendientes y decisiones](#11-pendientes-y-decisiones)

---

## 1. Conceptos

| Concepto | Valor / regla |
|---|---|
| Identificador | `LICENSE_ID` (por defecto `erp-mermelada`) |
| Vigencia máxima | **30 días** (`LICENSE_MAX_DAYS`). El API y la CLI rechazan tokens mayores. |
| Gracia | **7 días** (`LICENSE_GRACE_DAYS`) tras el vencimiento antes de bloquear escrituras. |
| Avisos | Desde **3 días antes** (`LICENSE_ALERT_DAYS`) hasta el día 0, a las **09:00 America/Caracas**. |
| Formato del token | `mrm1.<payload-base64url>.<firma-base64url>`, firmado con **Ed25519**. |
| Almacenamiento | Tabla `system_license` (fila `id = 1`); historial en `license_events` y `license_alerts`. |

### Estados

| Estado | Significado |
|---|---|
| `prueba` | Estado inicial/por defecto mientras no se aplica un token. |
| `activa` | Token válido aplicado. |
| `suspendida` | Suspendida manualmente por el master (o por el licenciante vía CLI). |

### Modos

| Modo | Cuándo | Efecto |
|---|---|---|
| `normal` | Quedan más de `LICENSE_ALERT_DAYS` días. | Operación completa. |
| `aviso` | Quedan ≤ 3 días. | Operación completa + avisos diarios. |
| `gracia` | Venció pero no pasaron los 7 días de gracia. | Operación completa; requiere renovación urgente. |
| `solo_lectura` | Gracia agotada, suspendida o reloj manipulado. | **Solo lecturas**; escrituras devuelven `402 LICENSE_EXPIRED`. |

En modo `solo_lectura` siguen accesibles la autenticación, la salud, la documentación
de la API y los propios endpoints de licencia, para poder reactivar el sistema.

---

## 2. Roles y permisos

El rol `master` es **oculto** y hereda los permisos de `admin`:

- No aparece en la lista de usuarios (`GET /api/auth/users`).
- No aparece como rol seleccionable para usuarios no-master (`GET /api/auth/roles`).
- No puede asignarse al crear/editar usuarios.

Usuario master:

| Campo | Valor |
|---|---|
| Usuario | `fjvelazco` |
| C.I. | `1431651` |
| Correo | `fjvelazco@gmail.com` |
| Nombre | Francisco Velazco |
| Contraseña | En `AUTH_MASTER_PASSWORD` del entorno (ver [§6.7](#67-cambiar-la-contraseña-master)). |

Permisos de licencia:

| Acción | Quién puede |
|---|---|
| Ver estado (`GET /api/system/license`) | Cualquier usuario autenticado |
| Aplicar token, suspender, ver eventos/alertas, probar/check de alertas | **Solo `master`** |

Un `admin` que intente aplicar un token recibe `403 FORBIDDEN` con
`details.requiredRoles: ["master"]`.

---

## 3. Claves Ed25519

El licenciante firma los tokens con la **clave privada**; el servidor solo necesita la
**clave pública**. Así, acceso a la base de datos o a la shell del servidor no permite
extender la licencia.

| Archivo | Ubicación | Quién lo tiene | Permisos |
|---|---|---|---|
| Privada | `~/.mermelada-license/license-private.pem` (fuera del repo) | **Solo el licenciante** | `600`, directorio `700` |
| Pública | `keys/license-public.pem` (versionada) | Servidor / imagen Docker | `644` |

Generar el par (solo una vez; en la máquina del licenciante):

```bash
node scripts/license-keygen.mjs --out ~/.mermelada-license
chmod 700 ~/.mermelada-license
chmod 600 ~/.mermelada-license/license-private.pem
```

Copiar **solo la pública** al servidor:

```bash
scp ~/.mermelada-license/license-public.pem usuario@servidor:/ruta/app/keys/license-public.pem
```

> ⚠️ **Nunca** copiar `license-private.pem` al servidor ni commitearlo.
> `.gitignore` y `.dockerignore` ya lo excluyen. Hoy la privada está en el mismo host
> que el ERP; para separación estricta debe moverse a la máquina offline del licenciante.

El servidor la lee desde `LICENSE_PUBLIC_KEY_PATH` (por defecto
`./keys/license-public.pem`). Alternativamente puede usarse `LICENSE_PUBLIC_KEY` con el
PEM en línea (`\n` o base64). Los valores con comillas se normalizan automáticamente.

### Rotación de claves

1. Generar un nuevo par con `--force` en la máquina del licenciante.
2. Desplegar la nueva **pública** en `keys/license-public.pem` del servidor.
3. Reiniciar el proceso (`pm2 restart mermelada-erp` o `docker compose restart app`).
4. Emitir y aplicar un token nuevo con la nueva privada.
5. La privada antigua puede archivarse cifrada; los tokens ya aplicados siguen vigentes
   porque el servidor guarda el estado, no reverifica el token en cada petición.

---

## 4. Instalación inicial

1. Configurar `LICENSE_*` en `.env` (PM2/systemd) o `.env.production` (Docker). Ver
   [`.env.production.example`](../.env.production.example).
2. Colocar la clave pública en `keys/license-public.pem`.
3. Arrancar la app. En la primera creación se siembra una licencia `prueba` a 30 días
   con `LICENSE_HOLDER` y `LICENSE_GRACE_DAYS`.
4. Emitir un token de 30 días y aplicarlo (ver [§6](#6-procedimientos)).
5. Verificar con `GET /api/system/license` que el modo sea `normal`.

---

## 5. CLI de licencia

Se ejecuta desde el directorio del proyecto (`node_modules` presente). Carga
automáticamente `.env` y `.env.production`.

```text
node scripts/license.mjs <comando> [opciones]

  issue      Emite un token firmado (máx. 30 días)
  apply      Aplica un token firmado
  verify     Verifica un token sin aplicarlo
  status     Muestra el estado actual
  suspend    Suspende la licencia (solo lectura)
  events     Lista el historial de eventos
  alerts     Lista las alertas; --test envía un correo de prueba
```

Opciones principales de `issue`:

| Opción | Descripción |
|---|---|
| `--days 30` | Días de vigencia (máx. 30) |
| `--expires-at FECHA` | Fecha exacta de vencimiento |
| `--grace-days 7` | Días de gracia |
| `--holder TEXTO` | Titular |
| `--license-id ID` | Identificador |
| `--private-key RUTA` | Clave privada |
| `--out RUTA` | Guarda el token en un archivo |

Variables relevantes: `DB_PATH`, `LICENSE_PRIVATE_KEY_PATH`, `LICENSE_PUBLIC_KEY_PATH`,
`LICENSE_MAX_DAYS`, `LICENSE_GRACE_DAYS` y `SMTP_*` (para `alerts --test`).

---

## 6. Procedimientos

### 6.1 Emitir un token (máquina del licenciante)

```bash
LICENSE_PRIVATE_KEY_PATH=~/.mermelada-license/license-private.pem \
  node scripts/license.mjs issue --days 30 \
  --holder "Francisco Velazco" --out /tmp/license-token.txt
```

El token se imprime y se guarda en el archivo. Un token de 31 días es rechazado:

```text
Error: la vigencia máxima permitida es 30 días (LICENSE_MAX_DAYS)
```

### 6.2 Verificar el token antes de enviarlo

```bash
node scripts/license.mjs verify "$(cat /tmp/license-token.txt)"
```

Debe mostrar `Token válido`, titular, vencimiento, gracia y el *token ID* (hash SHA-256
del token, 16 caracteres).

### 6.3 Aplicar el token en el servidor (SSH)

```bash
ssh usuario@servidor 'cd /ruta/app && node scripts/license.mjs apply "<TOKEN_FIRMADO>"'
```

O como master desde la UI: **Activación → Licencia del sistema → Aplicar token**.

Tras aplicar: estado `activa`, modo `normal`, días restantes = 30 y la escritura habilitada.

### 6.4 Renovación antes del vencimiento

Repetir [6.1](#61-emitir-un-token-máquina-del-licenciante) y
[6.3](#63-aplicar-el-token-en-el-servidor-ssh). Se puede aplicar en cualquier momento;
el nuevo token reemplaza al anterior y se registra un evento `apply`.

### 6.5 Suspensión temporal y reactivación

```bash
# Suspender (solo lectura)
node scripts/license.mjs suspend --reason "Mantenimiento"

# Reactivar aplicando un token válido
node scripts/license.mjs apply "$(cat /tmp/license-token.txt)" --actor licenciante
```

También existe `POST /api/system/license/suspend` para el master.

### 6.6 Consultar estado e historial

```bash
node scripts/license.mjs status
node scripts/license.mjs events
node scripts/license.mjs alerts
```

### 6.7 Cambiar la contraseña master

`AUTH_MASTER_PASSWORD` solo se aplica **al crear** la cuenta. En una base de datos
existente:

```bash
curl -X POST http://127.0.0.1:4000/api/auth/change-password \
  -H "Authorization: Bearer <TOKEN_MASTER>" \
  -H 'Content-Type: application/json' \
  -d '{"currentPassword":"<ACTUAL>","newPassword":"<NUEVA>"}'
```

Respuesta: `{"success":true,"requiresLogin":true}`. Hay que volver a iniciar sesión.

### 6.8 Al vencimiento

1. Si quedan días de gracia, el ERP sigue funcionando en modo `gracia`.
2. Agotada la gracia, pasa a `solo_lectura`: las escrituras devuelven
   `402 LICENSE_EXPIRED`.
3. Emitir y aplicar un token nuevo ([6.1](#61-emitir-un-token-máquina-del-licenciante) y
   [6.3](#63-aplicar-el-token-en-el-servidor-ssh)). La escritura se restaura sin reiniciar.

---

## 7. API HTTP

Todas requieren autenticación Bearer.

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/api/system/license` | autenticado | Estado + headers `X-License-*` |
| GET | `/api/system/license/events` | `master` | Historial (`:limit`) |
| GET | `/api/system/license/alerts` | `master` | Alertas (`:limit`) |
| POST | `/api/system/license/apply` | `master` | Aplica `{ token }` |
| POST | `/api/system/license/suspend` | `master` | Suspende con `{ reason? }` |
| POST | `/api/system/license/alerts/test` | `master` | Envía correo de prueba |
| POST | `/api/system/license/alerts/check` | `master` | Ejecuta la revisión diaria |

Ejemplo:

```bash
curl -X POST http://127.0.0.1:4000/api/system/license/apply \
  -H "Authorization: Bearer <TOKEN_MASTER>" \
  -H 'Content-Type: application/json' \
  -d '{"token":"<TOKEN_FIRMADO>"}'
```

---

## 8. Interfaz de usuario

El módulo **Activación** es visible solo para `master` y contiene:

- **Licencia del sistema**: estado, titular, vencimiento, días restantes, modo, gracia,
  token aplicado y última revisión.
- **Aplicar token**: campo para pegar el token firmado. Se muestra la plantilla SSH
  con `<TOKEN_FIRMADO>` como marcador de posición.
- **Acciones master**: suspender y probar/check de alertas.
- **Historial**: eventos y alertas de licencia.

`activation_records` (libro de pagos) se gestiona en el mismo módulo, pero es independiente.

---

## 9. Alertas por correo

El programador (`startLicenseAlertScheduler()`) se inicia con la app y se detiene en el
apagado limpio. Cada hora comprueba si toca enviar; la clave única
`(license_id, alert_date)` garantiza idempotencia.

- **Ventana**: de `LICENSE_ALERT_DAYS` (3) días antes al día 0, inclusive.
- **Hora**: `LICENSE_ALERT_HOUR` (9) en `LICENSE_ALERT_TIMEZONE` (`America/Caracas`).
- **Destinatarios**: todos los registros **activos** de `notification_recipients` +
  `SMTP_BCC` como copia oculta.
- **Resultados**: `sent`, `duplicate`, `skipped` (`outside_alert_window`), `partial`,
  `failed` o `disabled`.

Gestión de destinatarios: `GET/POST /api/notifications/recipients` (y `DELETE /:id`).

Envío manual (no consume el cupo diario):

```bash
node scripts/license.mjs alerts --test
curl -X POST http://127.0.0.1:4000/api/system/license/alerts/test \
  -H "Authorization: Bearer <TOKEN_MASTER>" -H 'Content-Type: application/json' -d '{}'
```

Revisión manual (idempotente):

```bash
curl -X POST http://127.0.0.1:4000/api/system/license/alerts/check \
  -H "Authorization: Bearer <TOKEN_MASTER>" -H 'Content-Type: application/json' -d '{}'
```

---

## 10. Solución de problemas

| Síntoma | Causa | Acción |
|---|---|---|
| `LICENSE_PUBLIC_KEY_MISSING` | Falta `keys/license-public.pem` o la variable de clave | Copiar la pública y reiniciar |
| `la firma del token no es válida` | Token alterado o firmado con otra clave | Emitir uno nuevo con la privada correcta |
| `la vigencia máxima permitida es 30 días` | `--days` > 30 | Emitir con 30 días o menos |
| `402 LICENSE_EXPIRED` al escribir | Licencia vencida/suspendida, sin gracia | Aplicar un token válido |
| No aparece el módulo Activación | Usuario no-master | Ingresar con el usuario master |
| `403` al aplicar token | Rol distinto de `master` | Usar el usuario master |
| Titular con comillas (`"..."`) | Loader que no quita comillas | El código ya las normaliza; reiniciar |
| No llegan correos | Sin destinatarios activos / SMTP mal configurado | Revisar `notification_recipients` y `SMTP_*` |
| `/alerts/check` dice `outside_alert_window` | Quedan más de 3 días | Comportamiento esperado |

> Nota PM2: `pm2 restart --update-env` **no** recarga variables del archivo. Usar:
> ```bash
> ENV_FILE=.env pm2 start ecosystem.config.cjs --update-env
> ```

---

## 11. Pendientes y decisiones

Ver el issue [#17](https://github.com/fjvelazcop/-mermelada-mrp-app/issues/17).
La gracia quedó confirmada en **7 días**. Siguen pendientes: separación física de la
clave privada, definición del mecanismo de secretos en producción, rotación documentada
en entorno real, alerta manual/inmediata y smoke test de Docker en CI.

Para el procedimiento de despliegue copiar/pegar ver
[DESPLIEGUE-PASO-A-PASO.md](./DESPLIEGUE-PASO-A-PASO.md).
