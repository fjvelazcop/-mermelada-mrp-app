# syntax=docker/dockerfile:1.7
# Production image for the Angular 21 SSR + Express API.
# Build:  docker build -t mermelada-erp:latest .
# Run:    docker compose up -d   (see docker-compose.yml)

FROM node:22-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 ships prebuilds for common platforms, but keep a compiler
# toolchain available so the image also builds on platforms without prebuilds.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund


FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build \
  && npm prune --omit=dev \
  && npm cache clean --force


FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DB_PATH=/app/data/mermelada.db \
    BACKUP_DIR=/app/backups

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 mermelada \
  && useradd --system --uid 1001 --gid mermelada --home-dir /app mermelada

COPY --from=build --chown=mermelada:mermelada /app/node_modules ./node_modules
COPY --from=build --chown=mermelada:mermelada /app/dist ./dist
COPY --from=build --chown=mermelada:mermelada /app/scripts ./scripts
COPY --chown=mermelada:mermelada package.json ./

RUN mkdir -p /app/data /app/backups \
  && chown -R mermelada:mermelada /app/data /app/backups

USER mermelada
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]

CMD ["node", "dist/app/server/server.mjs"]
