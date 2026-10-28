# Mermelada Guayaba ERP / MRP

**AI‑enhanced enterprise resource planning system for artisanal guava jam production.**

---

## 📖 Overview

This application manages inventory, production orders, sales, payroll, expenses, fiscal settings, and more for a small‑scale food‑production business. It is built with **Angular 21** (standalone components + SSR) and **Express** (Node SSR) and includes a **multi‑agent architecture** that assists with planning, data operations, testing, cybersecurity, information gathering, memory, and documentation.

The system is designed to be modular and extensible: each domain‑specific responsibility is encapsulated in an independent **agent** that can be invoked programmatically or through the Angular router. A **PlannerAgent** interprets high‑level goals and dispatches tasks to the appropriate specialist, while a **MemoryAgent** provides session‑scoped caching, and a **DocumentationRegistrationAgent** keeps project markdown files in sync.

---

## 🏗️ Architecture

### Agents (core/domain layers)

| Agent | Primary Responsibility |
|-------|------------------------|
| **PlannerAgent** | Receives a user goal (natural‑language or keyword‑based) and breaks it into an ordered task list. It routes each task to the appropriate specialist based on keyword matching or explicit registration. |
| **DatabaseExpertAgent** | Typed wrapper around the in‑memory `dbInstance` ERP database. Exposes CRUD methods for raw materials, recipes, production orders, customers, sales, payroll, expenses, exchange rates, audit logs, etc. All methods are safe (return copies, validate IDs) and are the single point of data access for other agents. |
| **CybersecurityAgent** | Validates and sanitises every inbound payload. Detects SQL‑injection, XSS, and other patterns. Provides `isAuthorized(userRole, allowedRoles)` for route protection. Logs security events to the audit‑log store. |
| **TestAgent** | Scaﬀolds Vitest test files, runs the project test suite (`bun run test`), and can generate coverage reports. |
| **InformationGatheringAgent** | Collects data from the database and, when available, external APIs (e.g., exchange‑rate service). Provides cached summaries: low‑stock reports, exchange‑rate snapshots, production dashboards. Uses the internal **MemoryAgent** to avoid redundant calls. |
| **MemoryAgent** | Simple key‑value store (in‑memory). Optionally persists to `localStorage`/`sessionStorage` via `persistToLocalStorage()` / `loadFromLocalStorage()`. Used by other agents to cache results, store session state, or share data across calls. |
| **DocumentationRegistrationAgent** | Scaﬀolds markdown documents, writes them to disk under `docs/`, and can generate a **Table of Contents** for the docs folder. Helps keep the README and project guides up‑to‑date. |

### High‑level data flow

1. **User request** (UI button, API call, or Planner‑triggered goal).  
2. **PlannerAgent** decides which agent(s) to involve.  
   * Example: “Show dashboard” → tasks: `getLowStockReport`, `getExchangeSummary`, `getProductionSummary`.  
3. **CybersecurityAgent** validates any external data *before* it touches the database (e.g., payload from a form).  
4. **DatabaseExpertAgent** performs the actual CRUD or read operations against `dbInstance`.  
5. **InformationGatheringAgent** may wrap DB calls, add caching via **MemoryAgent**, and optionally call external APIs (exchange rates).  
6. Results are returned to the caller (component, route guard, or directly to the UI).  
7. **MemoryAgent** stores any intermediate results under short‑lived keys so subsequent calls in the same session can reuse them.  
8. **DocumentationRegistrationAgent** can be invoked after a feature is merged to auto‑generate markdown docs and update the README badge section.

All agents are **Angular injectables** (provided in the root), except the **PlannerAgent** which is stateless and can be instantiated anywhere. The top‑level service that aggregates them is **AgentsService** (see `src/app/core/agents.service.ts`).

### Persistence (SQLite)

The server persists the full ERP state in a real SQLite database using `better-sqlite3`:

- **Database file:** `data/mermelada.db` (created automatically on first run).
- **Path override:** set the `DB_PATH` environment variable to any path.
- **Migrations:** managed in `src/server/database/persistence.ts` (`schema_migrations` table).
- **Normalized schema:** every entity has its own table and 1:N relations use child tables:

  | Domain | Tables |
  |--------|--------|
  | Inventory | `raw_materials`, `inventory_movements`, `finished_goods` |
  | Recipes / BOM | `recipes`, `recipe_items` |
  | Production | `production_orders`, `production_order_materials` |
  | Sales | `customers`, `sales_orders`, `sales_order_items`, `delivery_notes`, `delivery_note_items` |
  | Payroll | `employees`, `payroll_weeks`, `payroll_payments` |
  | Expenses | `expenses`, `expense_categories` |
  | Configuration | `fiscal_settings`, `exchange_rates`, `exchange_rate_history`, `audit_logs` |
  | Security | `auth_users` (scrypt password hashes + role), `auth_roles`, `auth_role_permissions`, `password_reset_tokens` |
  | Infrastructure | `tunnel_sessions` (public URL history), `notification_recipients`, `notification_log` |

- **Auto‑save:** every mutating operation on `dbInstance` writes the new snapshot to the relational tables in a single transaction (via a Proxy that wraps `ErpDatabase`). See `src/server/database/relational-persistence.ts`.
- **Legacy migration:** databases created before the relational schema are imported once from the old `app_state` JSON table.
- **Health check:** `GET /api/health` verifies the SQLite connection and returns the database path, version, environment and uptime.

To start fresh, delete `data/mermelada.db` (and the `-wal`/`-shm` files) or call `POST /api/system/reset`.

### Authentication & RBAC

Authentication is **opt-in** so the demo keeps working without a login screen:

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTH_ENABLED` | `false` | When `true`, every `/api/*` route (except health, login and docs) requires `Authorization: Bearer <token>`. |
| `AUTH_SECRET` | dev secret | HMAC‑SHA256 key used to sign tokens. **Change it in production.** |
| `AUTH_TOKEN_TTL_SECONDS` | `28800` (8 h) | Token lifetime. |
| `AUTH_SEED_PASSWORD` | `mermelada123` | Password assigned to the five demo users on first run. |

Demo users (seeded into `auth_users` once): `admin` (admin), `supervisor` (supervisor_planta), `operador` (operator), `costos` (analista_costos) and `almacen` (almacenista).

```bash
# Obtain a token
curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"mermelada123"}'

# Use it on protected routes
curl http://localhost:4000/api/inventory/raw-materials \
  -H "Authorization: Bearer <token>"
```

Passwords are hashed with Node's `scrypt` (random salt, timing‑safe comparison) and tokens are stateless `base64url(payload).base64url(HMAC-SHA256)`.

#### Roles & permissions (stored in SQLite)

The role catalog and the full role × module permission matrix live in the
database, not only in code:

- `auth_roles` stores built-in and custom roles (`id`, `name`, `description`, `color`, `is_system`).
- `auth_role_permissions` stores one row per role and module with the `can_view`, `can_create`, `can_edit`, `can_delete` and `can_export` flags.
- On first startup the five built-in roles (`admin`, `supervisor_planta`, `operator`, `analista_costos`, `almacenista`) and their current matrices (50 rows) are seeded with `INSERT OR IGNORE`. Restarting the server never overwrites permissions edited from the UI.
- `authorizeRequest` resolves permissions from `auth_role_permissions` on every request, so a change applies immediately to all users with that role.
- New users inherit the permissions of whichever role is assigned to them (built-in or custom). Custom roles can be created, edited and deleted from **Configuración & Permisología**; built-in roles and roles still assigned to users are protected from deletion.
- `admin` keeps unrestricted access and its matrix cannot be restricted.

#### Password changes

Authenticated users can change their own password from the header (**Clave**) or
the mobile menu. The form asks for the current and new password, verifies the
current one, rotates the scrypt hash and invalidates every older JWT (the token
`iat` is compared against `auth_users.password_changed_at`). Outstanding
password-reset links are also invalidated. After a successful change the client
clears the local session and asks the user to sign in again.

| Endpoint | Access | Purpose |
|----------|--------|---------|
| `POST /api/auth/change-password` | authenticated | Change own password (`currentPassword`, `newPassword`). |
| `GET /api/auth/roles` | authenticated | List roles with their permission matrix. |
| `POST /api/auth/roles` | admin | Create a custom role. |
| `PUT /api/auth/roles/:id` | admin | Update role name/description/colour. |
| `PUT /api/auth/roles/:id/permissions` | admin | Update one module's permissions for a role. |
| `DELETE /api/auth/roles/:id` | admin | Delete an unused custom role. |
| `GET /api/auth/users` | admin | List users with their role. |
| `POST /api/auth/users` | admin | Create a user, assign a role and optional initial password. |
| `PUT /api/auth/users/:id` | admin | Update a user (a new password rotates the hash). |
| `DELETE /api/auth/users/:id` | admin | Delete a user (the last active admin is protected). |

### Cloudflare tunnel, UI protection and email notifications

The tunnel supervisor (`scripts/tunnel.mjs`) is an independent PM2 app. It waits
for `/api/health`, starts `cloudflared`, extracts the public URL and reports it
to the loopback-only callback `POST /api/internal/tunnel`. The server stores
each session in `tunnel_sessions` and sends the notification email.

- **Quick tunnel (free):** no Cloudflare account is required. The URL looks like
  `https://<random>.trycloudflare.com` and changes on every restart; the history
  is kept in SQLite.
- **Named tunnel:** set `TUNNEL_MODE=token`, `TUNNEL_TOKEN` and
  `TUNNEL_PUBLIC_URL` for a stable hostname from a domain managed in Cloudflare.
- **UI protection:** `UI_AUTH_ENABLED=true` adds HTTP Basic Auth in front of the
  Angular shell and static assets. The API keeps its bearer-token + RBAC flow.
  Cloudflare Access (Zero Trust free tier) can be added on top for per-email
  identity and OTP/SSO.
- **Email:** SMTP credentials and `SMTP_BCC` come from the environment. Destinations
  live in `notification_recipients`; `SMTP_TO` only seeds that table on the first
  startup, so later changes from the API survive restarts. Every attempt is
  recorded in `notification_log` with retries (3 attempts).

| Variable | Default | Purpose |
|----------|---------|---------|
| `UI_AUTH_ENABLED` | `false` | Enables Basic Auth for the UI (fails closed if credentials are missing). |
| `UI_AUTH_USER` / `UI_AUTH_PASSWORD` | — | Shared UI credentials. |
| `TUNNEL_ENABLED` | `false` | Adds `mermelada-tunnel` to the PM2 ecosystem. |
| `TUNNEL_MODE` | `quick` | `quick` (`*.trycloudflare.com`) or `token` (named tunnel). |
| `TUNNEL_TOKEN` | — | Cloudflare tunnel token for `token` mode. |
| `TUNNEL_PUBLIC_URL` | — | Stable public URL for `token` mode. |
| `TUNNEL_INTERNAL_TOKEN` | `AUTH_SECRET` | Shared secret for the loopback callback. |
| `TUNNEL_CLOUDFLARED` | `cloudflared` | Path to the cloudflared binary. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | — / `587` / auto | SMTP server. |
| `SMTP_USER` / `SMTP_PASSWORD` | — | SMTP credentials (`SMTP_PASS` is also accepted). |
| `SMTP_FROM` / `SMTP_FROM_NAME` | — | Verified sender. |
| `SMTP_BCC` | — | Hidden copy added to every notification. |
| `SMTP_TO` | — | Comma-separated seed recipients for the first start. |
| `SMTP_RETRY_DELAY_MS` | `1000` | Base delay between the three attempts. |

| Endpoint | Access | Purpose |
|----------|--------|---------|
| `POST /api/internal/tunnel` | loopback + internal token | Register/close a tunnel session and trigger the email. |
| `GET /api/system/tunnel` | admin | Latest public URL, history and whether SMTP is configured. |
| `GET /api/notifications/recipients` | admin | List email recipients. |
| `POST /api/notifications/recipients` | admin | Add a recipient (`email`, optional `name`, `active`). |
| `PUT/DELETE /api/notifications/recipients/:id` | admin | Update or remove a recipient. |
| `GET /api/notifications/log` | admin | Recent email attempts and their status. |
| `POST /api/notifications/tunnel/resend` | admin | Re-send the email for the latest stored URL. |

```bash
# Latest public URL (admin token required when AUTH_ENABLED=true)
curl http://localhost:4000/api/system/tunnel \
  -H "Authorization: Bearer <token>"

# Add a recipient
curl -X POST http://localhost:4000/api/notifications/recipients \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{"email":"ops@example.com","name":"Operaciones"}'
```

### Server tests

```bash
npm run test:server            # backend integration tests
npm run test:server:watch      # watch mode
npm run test:server:coverage   # coverage report (threshold: 80% lines/functions/statements, 70% branches)
```

The backend suite (`src/server/**/*.spec.ts`, Vitest) uses a real temporary SQLite file and covers:

- creation of the normalized schema and migration history,
- relational roundtrip of the full seed state,
- persistence of mutations and reload after a simulated restart,
- HTTP API integration tests (health, auth/RBAC, validation, CRUD, docs, reset),
- role seeding, custom roles, role deletion protection and immediate permission changes,
- new-user role inheritance, admin-only user/role management and password rotation/token invalidation,
- payload validation errors (HTTP 422) and uniform error responses.

---

## 🚀 Getting Started

```bash
# 1️⃣ Install dependencies
bun install      # or npm install

# 2️⃣ Start the development server (Angular + Express SSR)
bun run dev      # runs on http://localhost:4000 (default) or PORT env var

# 3️⃣ Run the test suites
bun run test             # Angular unit tests
npm run test:server      # backend integration tests (SQLite + API)

# 4️⃣ Build for production
bun run build    # Angular SSR build → dist/
```

### Default ports

- **Angular dev server**: `http://localhost:4200` (controlled by Angular CLI)
- **Express SSR**: `http://localhost:4000` (or `PORT` env var)

The Angular app bootstraps with `provideHttpClient(withFetch())` and the `AgentsService` is automatically available for injection.

---

## 📦 Production deployment

Production artifacts are included in the repository:

| File | Purpose |
|------|---------|
| `Dockerfile` / `docker-compose.yml` | Multi-stage image, non-root runtime, `restart: unless-stopped`, healthcheck and log rotation. |
| `ecosystem.config.cjs` | PM2 supervisor with `autorestart`, memory limit and exponential backoff. |
| `deploy/systemd/` | Native systemd service + daily backup timer. |
| `deploy/nginx/`, `deploy/caddy/` | HTTPS reverse-proxy examples. |
| `.env.production.example` | Production environment template (secrets stay out of git). Set `NG_ALLOWED_HOSTS` to your domain so Angular SSR accepts the public Host header. |
| `scripts/backup-db.mjs` | Consistent SQLite backup with integrity check and retention. |
| `scripts/backup-cron.sh` | Cron wrapper: loads `.env`/`.env.production`, backs up and prunes old copies. |
| `scripts/healthcheck.mjs` | Container/uptime health probe. |
| `scripts/smoke-test.mjs` | Post-deploy functional smoke test. |
| `.github/workflows/` | CI (lint, tests, build, Docker) and tag-based CD to GHCR + SSH deploy. |

```bash
# Build once
npm ci && npm run build

# Run the compiled server
npm run start:prod

# Operations
npm run backup:db
npm run healthcheck
npm run smoke:prod
```

Graceful shutdown (`SIGTERM`/`SIGINT`) drains in-flight requests and closes
SQLite before the process exits, so Docker/PM2/systemd can restart it safely.
See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full step-by-step procedure,
backups/restore, HTTPS, monitoring, CI/CD secrets and rollback.

---

## 🔌 API Endpoints (Express)

The server (`src/server.ts` + `src/server/api.ts`) exposes a RESTful API under `/api/*`. The most frequently used groups are:

| Category | Key Endpoints |
|----------|---------------|
| **Docs** | `GET /api/openapi.json` (OpenAPI 3.0), `GET /api/docs` (Swagger UI) |
| **Auth** | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/change-password`, `POST /api/auth/reset-password`, `POST /api/auth/reset-password/confirm` |
| **Security (RBAC)** | `GET /api/auth/roles`, `POST /api/auth/roles`, `PUT/DELETE /api/auth/roles/:id`, `PUT /api/auth/roles/:id/permissions`, `GET/POST /api/auth/users`, `PUT/DELETE /api/auth/users/:id` |
| **Inventory → Raw Materials** | `GET /api/inventory/raw-materials`, `POST /api/inventory/raw-materials`, `PUT /api/inventory/raw-materials/:id` |
| **Inventory → Movements** | `GET /api/inventory/movements`, `POST /api/inventory/movements` |
| **Finished Goods** | `GET /api/inventory/finished-goods`, `PUT /api/inventory/finished-goods/:id` |
| **Recipes / BOM** | `GET /api/recipes`, `POST /api/recipes` |
| **Production Orders (MTO)** | `GET /api/production-orders`, `POST /api/production-orders`, `POST /api/production-orders/:id/process` |
| **Customers** | `GET /api/sales/customers`, `POST /api/sales/customers` |
| **Sales Orders** | `GET /api/sales/orders`, `POST /api/sales/orders`, `PUT /api/sales/orders/:id/status`, `POST /api/sales/orders/:id/create-production-order`, `POST /api/sales/orders/:id/create-delivery-note` |
| **Delivery Notes** | `GET /api/sales/delivery-notes` |
| **Payroll & Employees** | `GET /api/payroll/weeks`, `POST /api/payroll/weeks`, `GET /api/payroll/employees`, `POST /api/payroll/employees` |
| **Costing / Margins** | `GET /api/costing/summary`, `POST /api/costing/simulate` |
| **Expenses** | `GET /api/expenses`, `POST /api/expenses`, `DELETE /api/expenses/:id`, `GET/POST /api/expenses/categories`, `PUT/DELETE /api/expenses/categories/:id` |
| **Fiscal Settings** | `GET /api/fiscal-settings`, `PUT /api/fiscal-settings` |
| **Exchange Rates** | `GET /api/exchange-rates`, `POST /api/exchange-rates/update`, `POST /api/exchange-rates/refresh` |
| **Audit Logs** | `GET /api/audit-logs`, `POST /api/audit-logs` |
| **System** | `POST /api/system/reset` (reset demo data, admin only when auth is enabled), `GET /api/system/tunnel` (latest public URL + history, admin) |
| **Notifications** | `GET/POST /api/notifications/recipients`, `PUT/DELETE /api/notifications/recipients/:id`, `GET /api/notifications/log`, `POST /api/notifications/tunnel/resend` (admin) |
| **Dashboard Report** | `GET /api/reports/dashboard` |

All endpoints return JSON. Payloads are validated with **zod**; invalid input returns **422** with `{ error, code: "VALIDATION_ERROR", details: { issues: [{ path, message }] } }`. Unknown API routes return a JSON **404**, and every other error uses `{ error, code, details? }` with status 400/401/403/404/500. OpenAPI documentation is generated from `src/server/openapi.ts`.

---

## 🛠️ Adding New Functionality

1. **Define a task** in the **PlannerAgent** (`src/app/core/agents/planner-agent.ts`) – add a keyword pattern or extend the `planGoal` method.  
2. **Implement the operation** in **DatabaseExpertAgent** if it involves data persistence (CRUD, queries).  
3. **Add validation** via **CybersecurityAgent** (`validateInput`, `isAuthorized`) before any DB write.  
4. **Write unit tests** using **TestAgent** scaffolding (`scaffoldTestFile`, `runSuite`).  
5. **If the feature needs shared state**, use **MemoryAgent** `set` / `get` / `remember` / `recall`.  
6. **Register documentation** with **DocumentationRegistrationAgent** to create a markdown file and update the README section markers.  

*Example skeleton* (add to `planner-agent.ts`):

```ts
if (/nueva.*funcionalidad/i.test(lower)) {
  this.taskQueue = [
    'DatabaseExpertAgent: fetch new data',
    'CybersecurityAgent: validate payload',
    'InformationGatheringAgent: generate summary',
  ];
}
```

---

## 📦 Using the Agents in Your Code

### Via `AgentsService` (recommended)

```ts
import { inject } from '@angular/core';
import { AgentsService } from './core/agents.service';

constructor(@Inject(AgentsService) public agents: AgentsService) {}

async loadDashboard() {
  const summary = await this.agents.informationAgent.getDashboardSummary();
  console.log(summary);
}
```

### Direct injection (if you need only one agent)

```ts
import { inject } from '@angular/core';
import { InformationGatheringAgent } from './core/agents/information-gathering-agent';

constructor(@Inject(InformationGatheringAgent) public info: InformationGatheringAgent) {}
```

### From the Planner (automatic routing)

When a user types or speaks a goal containing keywords, the `PlannerAgent` can be invoked:

```ts
const tasks = this.agents.plannerAgent.planGoal('mostrar resumen de stock bajo');
/* tasks → [
   'InformationGatheringAgent: getLowStockReport',
   '...'
] */
```

---

## 📊 Test Coverage

The project uses **Vitest** for the Angular unit tests and for the backend integration suite:

```bash
npm run test                 # Angular unit tests
npm run test:server          # backend integration tests
npm run test:server:coverage # backend coverage (HTML + lcov in coverage/server/)
```

Backend coverage includes `src/server/**/*.ts` (excluding specs) and enforces thresholds of **80% lines/functions/statements** and **70% branches**. The report is generated in `coverage/server/`.

---

## 🔮 Future Enhancements (roadmap)

- **Vector store for semantic memory** – long‑term context across sessions (e.g., Pinecone, Qdrant).
- **External market APIs** – connect `InformationGatheringAgent` to price‑forecast services for guava derivatives.
- **PDF/Excel report generation** – leverage `jsPDF` + `jspdf-autotable` (already a dependency) to export dashboards.
- **Persistent session memory** – `MemoryAgent.persistToLocalStorage()` / `loadFromLocalStorage()` to survive page reloads.
- **CI/CD integration** – GitHub Actions to run tests, build, and enforce backend coverage on each push.

---

## 📄 License

This project is private and intended for internal use by *Mermeladas Artesanales del Valle C.A*. All code is TypeScript‑strict, Angular 21‑compatible, and follows the project's ESLint/Prettier configuration.

---

*Generated on Mon Oct 26 2026* – this README reflects the current state of the multi‑agent architecture, agent interactions, and ready‑to‑use APIs.