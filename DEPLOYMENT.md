# Despliegue en producción

Esta guía cubre el build de producción, las variables de entorno, las tres
formas de supervisión soportadas (Docker Compose, PM2 y systemd), HTTPS,
monitoreo, backups, CI/CD y rollback.

> **Regla de oro:** `.env.production` contiene secretos y **no se commitea**.
> El repositorio solo incluye `.env.production.example`.

---

## 1. Requisitos

| Componente | Versión mínima | Notas |
|------------|----------------|-------|
| Node.js | 20.19 (recomendado 22 LTS) | El `package.json` declara `engines.node >= 20.19`. |
| Docker + Compose | Docker 24 / Compose v2.24 | Opción recomendada; incluye auto-restart y healthcheck. |
| PM2 | 5.x | Alternativa sin Docker (`npm i -g pm2`). |
| systemd | 249+ | Alternativa nativa en Linux. |
| Nginx o Caddy | — | Terminación TLS y dominio. |

El servidor escucha en `HOST`/`PORT` (por defecto `0.0.0.0:4000`). La base de
datos SQLite vive en `DB_PATH` (por defecto `./data/mermelada.db`) y **debe
persistir entre despliegues**.

---

## 2. Build de producción

```bash
npm ci
npm run lint
npm run test:server:coverage
npm test -- --watch=false
npm run build
```

El resultado queda en `dist/app/`:

- `dist/app/browser/` — assets del navegador.
- `dist/app/server/server.mjs` — entrypoint SSR + API.

Para una instalación sin dependencias de desarrollo:

```bash
npm prune --omit=dev
npm run start:prod
```

`npm run start:prod` ejecuta `node dist/app/server/server.mjs`.

---

## 3. Variables de entorno

```bash
cp .env.production.example .env.production
# Edita dominio, DB_PATH, secretos y credenciales
chmod 600 .env.production
```

| Variable | Ejemplo | Obligatoria | Descripción |
|----------|---------|-------------|-------------|
| `NODE_ENV` | `production` | Sí | Activa el modo producción. |
| `HOST` | `0.0.0.0` | No | Interfaz de escucha. |
| `PORT` | `4000` | No | Puerto HTTP interno. |
| `APP_PORT` | `4000` | No | Puerto del host que Compose expone a Nginx/Caddy (solo loopback). |
| `APP_VERSION` | `1.0.0` | No | Se muestra en `/api/health`. |
| `APP_URL` | `https://erp.example.com` | Sí | URL pública (enlaces y callbacks). |
| `NG_ALLOWED_HOSTS` | `erp.example.com,localhost` | Recomendada | Hosts permitidos por Angular SSR. Si falta, se usa el hostname de `APP_URL`; nunca uses `*`. |
| `DB_PATH` | `/app/data/mermelada.db` | Sí | Ruta absoluta o relativa del SQLite. |
| `AUTH_ENABLED` | `true` | Recomendada | Activa login/RBAC en `/api/*`. |
| `AUTH_SECRET` | `openssl rand -hex 32` | Sí con auth | Firma HMAC de los tokens. |
| `AUTH_SEED_PASSWORD` | contraseña fuerte | Sí con auth | Password inicial de los 5 usuarios demo. |
| `AUTH_TOKEN_TTL_SECONDS` | `28800` | No | Vida del token (8 h por defecto). |
| `UI_AUTH_ENABLED` | `true` | No | Basic Auth delante de la UI/SSR (la API conserva Bearer + RBAC). |
| `UI_AUTH_USER` | `erp-ui` | Si UI auth | Usuario compartido de la UI. |
| `UI_AUTH_PASSWORD` | `openssl rand -base64 24` | Si UI auth | Clave compartida de la UI. |
| `GEMINI_API_KEY` | `...` | No | Funciones de IA; vacío las desactiva. |
| `SMTP_HOST` | `smtp.example.com` | No | Servidor SMTP para el correo del túnel. |
| `SMTP_PORT` | `587` | No | Puerto SMTP. |
| `SMTP_SECURE` | `false` | No | `true` para TLS implícito (normalmente 465). |
| `SMTP_USER` | `erp@example.com` | No | Usuario SMTP. |
| `SMTP_PASSWORD` | `...` | No | Clave SMTP (`SMTP_PASS` también se acepta). |
| `SMTP_FROM` | `erp@example.com` | No | Remitente verificado. |
| `SMTP_FROM_NAME` | `Mermelada ERP` | No | Nombre visible del remitente. |
| `SMTP_BCC` | `auditoria@example.com` | No | Copia oculta fija en todos los avisos. |
| `SMTP_TO` | `admin@example.com,...` | No | Semilla de destinatarios; solo se usa si la tabla está vacía. |
| `SMTP_RETRY_DELAY_MS` | `1000` | No | Espera base entre los 3 intentos. |
| `TUNNEL_ENABLED` | `false`/`true` | No | Añade `mermelada-tunnel` al ecosistema PM2. |
| `TUNNEL_MODE` | `quick` | No | `quick` (gratis, URL aleatoria) o `token` (hostname estable). |
| `TUNNEL_TOKEN` | `...` | Si `token` | Token del túnel nombrado de Cloudflare. |
| `TUNNEL_PUBLIC_URL` | `https://erp.example.com` | Si `token` | URL pública estable del túnel nombrado. |
| `TUNNEL_INTERNAL_TOKEN` | `AUTH_SECRET` | No | Secreto del callback loopback del túnel. |
| `TUNNEL_HEALTHCHECK_INTERVAL_MS` | `60000` | No | Frecuencia del health check público; `0` lo desactiva. |
| `TUNNEL_HEALTHCHECK_FAILURES` | `3` | No | Fallos consecutivos antes de reiniciar cloudflared. |
| `TUNNEL_CLOUDFLARED` | `cloudflared` | No | Ruta absoluta del binario si no está en `PATH`. |
| `BACKUP_DIR` | `/app/backups` | No | Destino de los backups. |
| `BACKUP_RETENTION_DAYS` | `14` | No | Retención; `0` desactiva la purga. |
| `TZ` | `America/Bogota` | No | Zona horaria del contenedor. |

Genera secretos reales antes del primer arranque:

```bash
openssl rand -hex 32          # AUTH_SECRET
openssl rand -base64 24       # AUTH_SEED_PASSWORD
```

Si `AUTH_ENABLED=true`, cambia `AUTH_SEED_PASSWORD` **antes** de arrancar por
primera vez: los usuarios se siembran solo cuando la tabla `auth_users` está
vacía.

---

## 4. Opción A — Docker Compose (recomendada)

`Dockerfile` construye una imagen multi-stage y corre como usuario sin
privilegios (uid 1001). `docker-compose.yml` añade:

- `restart: unless-stopped` → **auto-reinicio** ante crash o reboot.
- `healthcheck` cada 30 s contra `/api/health`.
- Límite de logs (`10 MB × 5`) para no llenar el disco.
- Volumen persistente para SQLite.

```bash
# Preparar backups con el uid del contenedor
mkdir -p backups
sudo chown -R 1001:1001 backups

# --env-file es obligatorio para que Compose interpole IMAGE_NAME/APP_PORT
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps
curl -fsS http://127.0.0.1:4000/api/health
```

Una vez configurado `.env.production`, el arranque completo es un solo comando:

```bash
docker compose --env-file .env.production up -d --build
```

Si usas una imagen publicada por CI (GHCR), define en `.env.production`:

```dotenv
IMAGE_NAME=ghcr.io/TU_USUARIO/mermelada-mrp-app:latest
```

y ejecuta `docker compose --env-file .env.production pull app && docker compose --env-file .env.production up -d`.

Comandos habituales:

```bash
docker compose --env-file .env.production logs -f --tail=200 app
docker compose --env-file .env.production restart app
docker compose --env-file .env.production exec app node scripts/healthcheck.mjs
docker compose --env-file .env.production exec app node scripts/backup-db.mjs
npm run smoke:prod                 # o: SMOKE_BASE_URL=... node scripts/smoke-test.mjs
```

### Auto-reinicio y apagado limpio

| Supervisor | Mecanismo |
|------------|-----------|
| Docker Compose | `restart: unless-stopped` + `stop_grace_period: 15s`. |
| PM2 | `autorestart: true`, `max_memory_restart: 512M`, backoff exponencial. |
| systemd | `Restart=always`, `RestartSec=2`. |

En los tres casos el proceso recibe `SIGTERM`; `src/server.ts` deja de aceptar
conexiones, espera las peticiones en curso, cierra SQLite y sale con código 0
(tras 10 s fuerza la salida). Esto evita respuestas truncadas y archivos
`-wal`/`-shm` huérfanos.

> Docker marca el contenedor como `unhealthy` pero no lo reinicia por sí solo
> ante un cuelgue. El cron de vigilancia de la sección 8 (o un monitor externo
> con acción de reinicio) cubre ese caso; PM2 y systemd reinician el proceso
> cuando termina.

---

## 5. Opción B — PM2

```bash
npm ci
npm run build
npm prune --omit=dev

sudo npm i -g pm2
# ecosystem.config.cjs carga .env.production (o .env si no existe) de forma
# automática. Ajusta DB_PATH=/opt/mermelada/data/mermelada.db en ese fichero.
# Usa ENV_FILE=.env.otro para elegir un fichero distinto; las variables ya
# exportadas en la shell tienen prioridad.
mkdir -p logs data
pm2 start ecosystem.config.cjs --update-env
pm2 save
pm2 startup          # sigue la instrucción que imprime
```

Operación:

```bash
pm2 status
pm2 logs mermelada-erp --lines 200
pm2 logs mermelada-tunnel --lines 200
pm2 restart mermelada-erp --update-env
pm2 restart mermelada-tunnel --update-env
pm2 monit
```

`ecosystem.config.cjs` define `cwd`, logs en `logs/`, `kill_timeout: 15000` y
`max_memory_restart: 512M`. Si `TUNNEL_ENABLED=true` en el fichero de entorno,
también arranca `mermelada-tunnel`; con `false` solo se inicia la app.

### 5.1 Cloudflare Tunnel (gratis)

Instala `cloudflared` en el host y verifica que esté en `PATH`:

```bash
cloudflared version
# Si no está en PATH: TUNNEL_CLOUDFLARED=/usr/local/bin/cloudflared
```

Modo rápido (sin cuenta ni dominio, URL aleatoria que cambia en cada reinicio):

```dotenv
TUNNEL_ENABLED=true
TUNNEL_MODE=quick
# TUNNEL_INTERNAL_TOKEN se deriva de AUTH_SECRET si se deja vacío
```

Modo nombrado (hostname estable; requiere dominio en Cloudflare y túnel creado
en el dashboard de Zero Trust):

```dotenv
TUNNEL_ENABLED=true
TUNNEL_MODE=token
TUNNEL_TOKEN=token-del-tunel
TUNNEL_PUBLIC_URL=https://erp.example.com
```

Al ejecutar `pm2 start ecosystem.config.cjs --update-env`, PM2 carga el fichero
`.env.production` (o `.env` como respaldo) y levanta ambos procesos; no hace
falta exportar las variables a mano. El supervisor espera a `/api/health`,
arranca `cloudflared`, extrae la URL pública, la registra en
`tunnel_sessions` y dispara el correo. Si cloudflared cae o el health check
público falla 3 veces, PM2 lo reinicia.

La URL vigente se consulta (admin) en `GET /api/system/tunnel` y en
`logs/tunnel-out.log`; el histórico queda en la base de datos.

### 5.2 Protección de la UI y correo

- `UI_AUTH_ENABLED=true` exige Basic Auth para el shell Angular y los assets.
  La API sigue usando Bearer + RBAC. Para identidad por usuario se puede añadir
  **Cloudflare Access** (Zero Trust gratuito hasta 50 usuarios) delante del
  hostname; en ese caso el Basic Auth actúa como segunda barrera.
- Configura `SMTP_*`, `SMTP_FROM`, `SMTP_BCC` y `SMTP_TO` en `.env.production`.
  `SMTP_TO` solo siembra `notification_recipients` la primera vez; después los
  destinatarios se gestionan por API (`/api/notifications/recipients`) y
  sobreviven a los reinicios.
- Cada envío se registra en `notification_log` con hasta 3 intentos. Si SMTP
  aún no está configurado, el túnel se registra igualmente y el aviso queda
  como `omitido`; se puede reenviar con `POST /api/notifications/tunnel/resend`.
- Los túneles rápidos añaden automáticamente `*.trycloudflare.com` a los hosts
  permitidos de Angular SSR. En modo `token` se añade el host de
  `TUNNEL_PUBLIC_URL`.

> El túnel solo se integra con PM2 (Opción B). Docker Compose expone la app a
> través del proxy inverso y no arranca `scripts/tunnel.mjs`.

Rotación de logs de PM2:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

---

## 6. Opción C — systemd

```bash
sudo useradd --system --home /opt/mermelada --shell /usr/sbin/nologin mermelada
sudo mkdir -p /opt/mermelada/data /opt/mermelada/backups /etc/mermelada
sudo cp -r dist package.json node_modules scripts /opt/mermelada/
sudo install -m 600 .env.production /etc/mermelada/mermelada.env
sudo chown -R mermelada:mermelada /opt/mermelada/data /opt/mermelada/backups

sudo cp deploy/systemd/mermelada.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mermelada
sudo systemctl status mermelada
journalctl -u mermelada -f
```

> En instalación nativa ajusta en `/etc/mermelada/mermelada.env`:
> `DB_PATH=/opt/mermelada/data/mermelada.db` y
> `BACKUP_DIR=/opt/mermelada/backups`. Los valores `/app/...` son solo para
> Docker.

Backups diarios con timer:

```bash
sudo cp deploy/systemd/mermelada-backup.service /etc/systemd/system/
sudo cp deploy/systemd/mermelada-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mermelada-backup.timer
systemctl list-timers mermelada-backup.timer
```

---

## 7. HTTPS y dominio

Apunta el DNS (`A`/`AAAA`) al servidor y elige un proxy:

### Caddy (HTTPS automático)

```bash
sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile      # dominio y email
sudo systemctl reload caddy
```

### Nginx + Certbot

```bash
sudo apt install nginx certbot python3-certbot-nginx

# 1. Emite el certificado (Certbot configura TLS en el sitio por defecto).
#    El DNS del dominio debe apuntar ya al servidor.
sudo certbot --nginx -d erp.example.com

# 2. Instala la configuración final (proxy + TLS + headers).
sudo cp deploy/nginx/mermelada.conf /etc/nginx/sites-available/mermelada
sudo ln -s /etc/nginx/sites-available/mermelada /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Ambos proxies reenvían a `127.0.0.1:4000`; el contenedor publica el puerto solo
en loopback. Añade HSTS y renueva certificados automáticamente
(`certbot.timer` o Caddy).

---

## 8. Logs, monitoreo y health checks

- **Health:** `GET /api/health` → `200` con `status`, `version`, `environment`,
  `uptimeSeconds`, `authEnabled` y `database.connected`.
- **Script de health:** `node scripts/healthcheck.mjs` (usa `HEALTHCHECK_URL` o
  `http://127.0.0.1:$PORT/api/health`).
- **Smoke test:** `node scripts/smoke-test.mjs` verifica health, OpenAPI y el
  HTML SSR de Angular. Úsalo después de cada deploy.
- **Logs Docker:** `docker compose --env-file .env.production logs`; rotación configurada en Compose.
- **Logs PM2:** `logs/pm2-out.log` y `logs/pm2-error.log`.
- **Logs systemd:** `journalctl -u mermelada`.
- **Uptime externo:** configura Uptime Kuma, Better Stack, Pingdom o similar
  contra `https://erp.example.com/api/health`; alerta si el status != 200,
  `status != "ok"` o `database.connected != true`.
- **Recursos:** `docker stats`, `pm2 monit` o `systemctl status`.

Ejemplo de cron de vigilancia (reinicia si el health falla):

```bash
*/5 * * * * cd /opt/mermelada && curl -fsS --max-time 5 http://127.0.0.1:4000/api/health >/dev/null || docker compose --env-file .env.production -f /opt/mermelada/docker-compose.yml restart app
```

> El auto-reinicio ya lo cubre el supervisor; este cron es una red de seguridad
> adicional ante cuelgues que no terminan el proceso.

---

## 9. Backups y restauración

`scripts/backup-db.mjs` usa la API de backup de SQLite (copia consistente incluso
con WAL), valida `PRAGMA integrity_check` y purga copias antiguas.

```bash
# Manual
DB_PATH=./data/mermelada.db BACKUP_DIR=./backups node scripts/backup-db.mjs

# Docker
docker compose --env-file .env.production exec app node scripts/backup-db.mjs

# Backups diarios automáticos con el servicio opcional de Compose
docker compose --env-file .env.production --profile backup up -d
docker compose --env-file .env.production logs backup

# Cron diario en el host (02:30)
30 2 * * * cd /opt/mermelada && docker compose --env-file .env.production exec -T app node scripts/backup-db.mjs >> logs/backup.log 2>&1
```

Formato: `backups/mermelada-<ISO>.db`. Añade copia externa (S3, rclone,
restic) para protección ante pérdida del servidor:

```bash
rclone sync /opt/mermelada/backups remote:mermelada-backups
```

### Restauración (Docker)

```bash
docker compose --env-file .env.production stop app
# Elegir el backup
ls -lt backups/ | head
docker run --rm \
  -v mermelada-data:/data \
  -v "$PWD/backups":/backups:ro \
  alpine sh -c 'rm -f /data/mermelada.db* && cp /backups/mermelada-XXXX.db /data/mermelada.db && chown 1001:1001 /data/mermelada.db'
docker compose --env-file .env.production start app
curl -fsS http://127.0.0.1:4000/api/health
```

### Restauración (bare metal)

```bash
sudo systemctl stop mermelada
sudo cp backups/mermelada-XXXX.db /opt/mermelada/data/mermelada.db
sudo rm -f /opt/mermelada/data/mermelada.db-wal /opt/mermelada/data/mermelada.db-shm
sudo chown mermelada:mermelada /opt/mermelada/data/mermelada.db
sudo systemctl start mermelada
```

Prueba una restauración en staging al menos una vez por trimestre.

---

## 10. CI/CD (GitHub Actions)

### CI — `.github/workflows/ci.yml`

En cada push/PR a `develop` y `main`:

1. `npm ci`
2. `npm run lint`
3. `npm run test:server:coverage` (incluye tests funcionales de backup,
   healthcheck, smoke test y configuración PM2)
4. `npm test -- --watch=false`
5. `npm run build`
6. Build de la imagen Docker + arranque + health check real.

### CD — `.github/workflows/deploy.yml`

Se dispara con tags `v*` o manualmente (`workflow_dispatch`). Construye y publica
la imagen en GHCR, y opcionalmente despliega por SSH.

Configura en GitHub → Settings → Secrets and variables → Actions:

| Tipo | Nombre | Ejemplo |
|------|--------|---------|
| Variable | `CONTAINER_IMAGE` | `ghcr.io/tu-usuario/mermelada-mrp-app` |
| Variable | `DEPLOY_ENABLED` | `true` para activar el job de deploy |
| Variable | `DEPLOY_PATH` | `/opt/mermelada` |
| Variable | `APP_PORT` | `4000` |
| Secret | `DEPLOY_HOST` | `erp.example.com` |
| Secret | `DEPLOY_USER` | `deploy` |
| Secret | `DEPLOY_SSH_KEY` | clave privada SSH (sin passphrase) |
| Secret | `DEPLOY_PORT` | `22` (opcional) |

En el servidor, `.env.production` debe apuntar a la misma imagen:

```dotenv
IMAGE_NAME=ghcr.io/tu-usuario/mermelada-mrp-app:latest
```

Publicar una versión:

```bash
git tag v1.0.0
git push origin v1.0.0
```

El deploy hace backup previo, `docker compose --env-file .env.production pull`, recrea solo `app`, espera
hasta 60 s a que `/api/health` responda y falla con logs si no hay salud.

---

## 11. Rollback

### Imagen anterior (Docker)

Las etiquetas `sha-<commit>` y semver quedan en GHCR.

```bash
cd /opt/mermelada
cp .env.production .env.production.bak
sed -i 's|:latest|:sha-ABCDEFG|' .env.production   # o el tag anterior
docker compose --env-file .env.production pull app
docker compose --env-file .env.production up -d --no-deps app
curl -fsS http://127.0.0.1:4000/api/health
```

Si el problema es de datos, restaura el backup previo (sección 9). Para volver
a la versión estable, repite el proceso con `:latest` o el tag semver anterior.

### PM2 / systemd

```bash
git checkout <tag-anterior>
npm ci && npm run build && npm prune --omit=dev
pm2 restart mermelada-erp --update-env     # o systemctl restart mermelada
```

El rollback debe completarse en menos de 15 minutos; si no, restaura el backup y
documenta el incidente.

---

## 12. Verificación funcional post-deploy

```bash
BASE_URL=https://erp.example.com

# 1. Salud y base de datos
curl -fsS "$BASE_URL/api/health"

# 2. Documentación OpenAPI
curl -fsS "$BASE_URL/api/openapi.json" | head -c 200

# 3. Frontend SSR
curl -fsS "$BASE_URL/" | grep -q '<app-root' && echo "SSR OK"

# 4. Smoke test completo
SMOKE_BASE_URL="$BASE_URL" node scripts/smoke-test.mjs

# 5. Si AUTH_ENABLED=true, login y ruta protegida
TOKEN=$(curl -fsS -X POST "$BASE_URL/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"TU_PASSWORD"}' | jq -r .token)
curl -fsS "$BASE_URL/api/inventory/raw-materials" -H "Authorization: Bearer $TOKEN"

# 6. Persistencia: crea/edita un registro, reinicia el contenedor y verifica
docker compose --env-file .env.production restart app
```

Checklist de aceptación:

- [ ] `/api/health` responde `status: "ok"` y `database.connected: true`.
- [ ] El HTML SSR contiene `<app-root` y los assets cargan.
- [ ] `node scripts/smoke-test.mjs` pasa las 3 comprobaciones.
- [ ] El contenedor/servicio se reinicia solo tras `kill` o reboot.
- [ ] Los logs persisten/rotan y las alertas de uptime están activas.
- [ ] Un backup reciente existe y una restauración fue probada.
- [ ] `.env.production` no está en git (`git check-ignore .env.production`).
- [ ] El pipeline CI está en verde y el deploy por tag funciona.
