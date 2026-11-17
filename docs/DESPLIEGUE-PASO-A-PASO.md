# Puesta en producción — pasos copiar/pegar (estado actual)

Guía operativa para llevar **este punto exacto** del proyecto a un servidor de producción.
Complementa [DEPLOYMENT.md](../DEPLOYMENT.md) (referencia completa) y
[MANUAL-LICENCIA.md](./MANUAL-LICENCIA.md) (operación de la licencia).

## Estado de partida

| Concepto | Valor |
|---|---|
| Repositorio | `origin` → `fjvelazcop/-mermelada-mrp-app`, rama `develop` |
| Runtime actual | PM2 (`mermelada-erp` + `mermelada-tunnel`), puerto `4000`, `ENV_FILE=.env` |
| Base de datos | `./data/mermelada.db` (SQLite) |
| Licencia | `activa`, 30 días, titular `Francisco Velazco`, gracia 7 días |
| Usuario master | `fjvelazco` (oculto), password en `AUTH_MASTER_PASSWORD` |
| Clave pública | `keys/license-public.pem` (versionada) |
| Clave privada | `/home/fjvel/.mermelada-license/license-private.pem` (**solo licenciante**) |
| Docker | Validado en puerto alternativo `4100` |

> Los valores secretos reales **no** están en este documento. Se generan o se leen
> de `.env` / gestor de secretos en el servidor.

---

## 1. Mapa de carpetas

En el servidor (ejemplo `/opt/mermelada`):

```text
/opt/mermelada/
├── dist/                       # build Angular SSR + Express (OBLIGATORIO)
├── scripts/                    # CLI license.mjs, backup-db.mjs, healthcheck.mjs
├── keys/
│   └── license-public.pem      # SOLO la pública (OBLIGATORIO)
├── node_modules/               # se instala con npm ci, NO se copia
├── data/
│   └── mermelada.db            # BD: copiar solo si se migra el estado actual
├── backups/                    # copias de seguridad
├── .env                        # secretos + config (NO versionado)
├── .env.production.example     # plantilla de referencia (sí versionada)
├── package.json
├── package-lock.json
└── ecosystem.config.cjs        # definición de PM2
```

### Qué copiar / qué NO copiar

| ✅ Copiar | ❌ NO copiar |
|---|---|
| `dist/` | `keys/license-private.pem` (nunca) |
| `scripts/` | `node_modules/` (reinstalar) |
| `keys/license-public.pem` | `.git/`, `.angular/`, `coverage/` |
| `package.json`, `package-lock.json` | `logs/`, `backups/` (salvo migración explícita) |
| `ecosystem.config.cjs` | `*.db-wal`, `*.db-shm` (usar backup consistente) |
| `.env`/`.env.production` (fuera del repo, por canal seguro) | contraseñas/tokens en texto dentro del repo |
| `data/mermelada.db` **solo si** se migra licencia/usuarios actuales | |

---

## 2. Opción A — PM2 en el servidor (la usada actualmente)

### 2.1 Preparar el servidor

```bash
sudo mkdir -p /opt/mermelada/{data,backups,keys}
sudo chown -R "$USER:$USER" /opt/mermelada
node --version        # >= 22 recomendado (el host actual usa Node 24)
npm --version
npm i -g pm2
```

### 2.2 Copiar archivos desde la máquina de build

```bash
# Ejecutar en la máquina de build / desarrollo
APP=/home/fjvel/proyectos/mermelada
DEST=usuario@servidor:/opt/mermelada

# 1) Build fresco (si no se copia dist/)
cd "$APP" && npm ci && npm run build

# 2) Copiar código + clave pública + configuración
rsync -av \
  "$APP/dist/" "$DEST/dist/" \
  "$APP/scripts/" "$DEST/scripts/" \
  "$APP/keys/license-public.pem" "$DEST/keys/" \
  "$APP/package.json" "$APP/package-lock.json" "$APP/ecosystem.config.cjs" "$DEST/"
```

> `rsync` debe tener los directorios destino creados (paso 2.1). Para `scp`, el
> equivalente es `scp -r dist scripts keys package*.json ecosystem.config.cjs usuario@servidor:/opt/mermelada/`.

### 2.3 Migrar la base de datos (solo si se conserva el estado actual)

En el host de origen, generar un backup consistente y copiarlo:

```bash
cd "$APP"
node scripts/backup-db.mjs
ls -lh backups/          # elegir el .db más reciente
scp backups/<archivo>.db usuario@servidor:/opt/mermelada/data/mermelada.db
```

Si **no** se migra la BD, omitir este paso: la app siembra una BD nueva con una
licencia `prueba` de 30 días y habrá que emitir/aplicar un token (paso 2.6).

### 2.4 Configurar `.env` en el servidor

```bash
ssh usuario@servidor
cd /opt/mermelada
cp .env.production.example .env
nano .env
```

Generar secretos nuevos (no reutilizar los del host de desarrollo):

```bash
openssl rand -hex 32                         # → AUTH_SECRET
openssl rand -base64 24 | tr -d '/+=' ; echo 'A1!'   # → AUTH_SEED_PASSWORD
openssl rand -base64 24 | tr -d '/+=' ; echo 'A1!'   # → AUTH_MASTER_PASSWORD
```

Ajustar como mínimo:

```ini
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
APP_URL=https://erp.tudominio.com
NG_ALLOWED_HOSTS=erp.tudominio.com,localhost,127.0.0.1
DB_PATH=/opt/mermelada/data/mermelada.db
BACKUP_DIR=/opt/mermelada/backups

AUTH_ENABLED=true
AUTH_SECRET=<AUTH_SECRET>
AUTH_SEED_PASSWORD=<AUTH_SEED_PASSWORD>
AUTH_MASTER_PASSWORD=<AUTH_MASTER_PASSWORD>

LICENSE_ENABLED=true
LICENSE_ID=erp-mermelada
LICENSE_HOLDER="Francisco Velazco"
LICENSE_MAX_DAYS=30
LICENSE_GRACE_DAYS=7
LICENSE_ALERT_DAYS=3
LICENSE_ALERT_HOUR=9
LICENSE_ALERT_TIMEZONE=America/Caracas
LICENSE_CHECK_INTERVAL_MS=3600000
LICENSE_PUBLIC_KEY_PATH=./keys/license-public.pem

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<USUARIO_SMTP>
SMTP_PASSWORD=<APP_PASSWORD_SMTP>
SMTP_FROM=<CORREO_SMTP>
SMTP_FROM_NAME="Mermelada ERP"
SMTP_BCC=<CORREO_AUDITORIA>
SMTP_TO=<DESTINATARIO_INICIAL>
```

Proteger el archivo:

```bash
chmod 600 .env
chmod 644 keys/license-public.pem
test ! -e keys/license-private.pem && echo "OK: sin clave privada en el servidor"
```

### 2.5 Instalar dependencias y arrancar PM2

```bash
cd /opt/mermelada
npm ci --omit=dev

ENV_FILE=.env pm2 start ecosystem.config.cjs --update-env
pm2 save
pm2 startup        # ejecutar la línea que imprime para arranque automático
pm2 list
```

> ⚠️ `pm2 restart --update-env` **no** recarga variables del archivo. Para cambios de
> entorno usar siempre `ENV_FILE=.env pm2 start ecosystem.config.cjs --update-env`.

### 2.6 Verificar y aplicar la licencia

```bash
# 1) Salud
curl -s http://127.0.0.1:4000/api/health

# 2) Login master (usa la password de AUTH_MASTER_PASSWORD)
MASTER=$(curl -s -X POST http://127.0.0.1:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"fjvelazco","password":"<AUTH_MASTER_PASSWORD>"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).token")

# 3) Estado de la licencia
curl -s -H "Authorization: Bearer $MASTER" http://127.0.0.1:4000/api/system/license

# 4) Aplicar token firmado (si se migró BD con licencia vigente, omitir)
node scripts/license.mjs apply "<TOKEN_FIRMADO>" --actor despliegue-prod
node scripts/license.mjs status
```

### 2.7 Configurar destinatarios de alertas

```bash
curl -X POST http://127.0.0.1:4000/api/notifications/recipients \
  -H "Authorization: Bearer $MASTER" \
  -H 'Content-Type: application/json' \
  -d '{"email":"alertas@tudominio.com","name":"Alertas"}'

# Prueba de correo (no consume el aviso diario)
node scripts/license.mjs alerts --test
```

---

## 3. Opción B — Docker Compose (alternativa validada)

El build ya incluye `dist/`, `scripts/` y `keys/license-public.pem`; solo se necesita el
contexto del repo y `.env.production` en el host.

```bash
# 1) Preparar
sudo mkdir -p /opt/mermelada/{keys,data,backups}
cd /opt/mermelada

# 2) Copiar contexto de build (sin .env reales; .dockerignore los excluye)
rsync -av --exclude 'node_modules' --exclude '.git' --exclude 'data' \
  --exclude 'backups' --exclude 'logs' \
  /home/fjvel/proyectos/mermelada/ /opt/mermelada/

# 3) Ajustar .env.production (mismo bloque LICENSE_* del paso 2.4)
cp .env.production.example .env.production
nano .env.production
chmod 600 .env.production

# 4) Construir y arrancar
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps

# 5) Verificar
curl -s http://127.0.0.1:4000/api/health
docker compose --env-file .env.production logs -f --tail=200 app

# 6) Aplicar licencia dentro del contenedor
docker compose --env-file .env.production exec app \
  node scripts/license.mjs apply "<TOKEN_FIRMADO>" --actor despliegue-prod
docker compose --env-file .env.production exec app node scripts/license.mjs status
```

Si se migra la BD al volumen de Docker:

```bash
docker compose --env-file .env.production stop app
docker compose --env-file .env.production cp backups/<archivo>.db app:/app/data/mermelada.db
docker compose --env-file .env.production start app
```

Puerto host: `APP_PORT` en `.env.production` (por defecto `4000`). Para validar sin
chocar con otra instancia: `APP_PORT=4100 docker compose --env-file .env.production up -d`.

---

## 4. HTTPS y dominio

Terminar TLS en Caddy/Nginx y hacer proxy a `127.0.0.1:4000`. Ver
[DEPLOYMENT.md §7](../DEPLOYMENT.md#7-https-y-dominio). No exponer el puerto `4000`
directamente a Internet: `docker-compose.yml` ya lo enlaza solo a loopback.

Tras cambiar el dominio, actualizar `APP_URL` y `NG_ALLOWED_HOSTS` y reiniciar con el
comando del paso 2.5 (o `docker compose restart app`).

---

## 5. Checklist de verificación post-despliegue

| # | Comprobación | Esperado |
|---|---|---|
| 1 | `curl .../api/health` | `{"status":"ok", ...}` |
| 2 | Login `fjvelazco` | 200, `roleId: master` |
| 3 | `GET /api/auth/users` | El master **no** aparece |
| 4 | `GET /api/system/license` | `enabled:true`, modo `normal` o `aviso`, `readOnly:false` |
| 5 | `GET /api/system/license/events` con master | 200; con `admin` → 403 |
| 6 | `node scripts/license.mjs status` | Estado `activa`, días > 0 |
| 7 | Escritura de prueba | HTTP 2xx (no `402 LICENSE_EXPIRED`) |
| 8 | `alerts --test` | Correo recibido por destinatario + BCC |
| 9 | `pm2 list` / `docker compose ps` | Procesos `online` / `Up` |
| 10 | Backup manual | `node scripts/backup-db.mjs` genera archivo |
| 11 | Clave privada ausente | `test ! -e keys/license-private.pem` → OK |
| 12 | Renovación programada | Token actual vence `2026-12-17`; emitir uno nuevo antes |

---

## 6. Rollback rápido

```bash
# PM2
cd /opt/mermelada
git checkout <commit-anterior>
npm run build
ENV_FILE=.env pm2 start ecosystem.config.cjs --update-env

# Docker
docker compose --env-file .env.production down
git checkout <commit-anterior>
docker compose --env-file .env.production up -d --build
```

Antes de cualquier rollback que reemplace `data/`, restaurar el backup de la BD
([DEPLOYMENT.md §9](../DEPLOYMENT.md#9-backups-y-restauración)). La licencia vive en la BD:
si se restaura una BD antigua, vuelve a aplicar el token firmado.

---

## 7. Referencias

- [DEPLOYMENT.md](../DEPLOYMENT.md) — Docker, systemd, HTTPS, backups y CI/CD.
- [MANUAL-LICENCIA.md](./MANUAL-LICENCIA.md) — emisión, rotación y alertas de licencia.
- [MANUAL-ADMINISTRADOR.md](./MANUAL-ADMINISTRADOR.md) — usuarios, túnel y correo.
- Issue [#17](https://github.com/fjvelazcop/-mermelada-mrp-app/issues/17) — pendientes.
