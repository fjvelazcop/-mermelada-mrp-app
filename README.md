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
- **Auto‑save:** every mutating operation on `dbInstance` writes the new state to SQLite (via a Proxy that wraps `ErpDatabase`).
- **Health check:** `GET /api/health` verifies the SQLite connection and returns the database path.

To start fresh, delete `data/mermelada.db` (and the `-wal`/`-shm` files) or call `POST /api/system/reset`.

---

## 🚀 Getting Started

```bash
# 1️⃣ Install dependencies
bun install      # or npm install

# 2️⃣ Start the development server (Angular + Express SSR)
bun run dev      # runs on http://localhost:4000 (default) or PORT env var

# 3️⃣ Run the test suite
bun run test     # Vitest, see coverage in coverage/

# 4️⃣ Build for production
bun run build    # Angular SSR build → dist/
```

### Default ports

- **Angular dev server**: `http://localhost:4200` (controlled by Angular CLI)
- **Express SSR**: `http://localhost:4000` (or `PORT` env var)

The Angular app bootstraps with `provideHttpClient(withFetch())` and the `AgentsService` is automatically available for injection.

---

## 🔌 API Endpoints (Express)

The server (`src/server.ts`) exposes a RESTful API under `/api/*`. The most frequently used groups are:

| Category | Key Endpoints |
|----------|---------------|
| **Inventory → Raw Materials** | `GET /api/inventory/raw-materials`, `POST /api/inventory/raw-materials`, `PUT /api/inventory/raw-materials/:id` |
| **Inventory → Movements** | `GET /api/inventory/movements`, `POST /api/inventory/movements` |
| **Finished Goods** | `GET /api/inventory/finished-goods`, `PUT /api/inventory/finished-goods/:id` |
| **Recipes / BOM** | `GET /api/recipes`, `POST /api/recipes` |
| **Production Orders (MTO)** | `GET /api/production-orders`, `POST /api/production-orders`, `POST /api/production-orders/:id/process` |
| **Customers** | `GET /api/sales/customers`, `POST /api/sales/customers` |
| **Sales Orders** | `GET /api/sales/orders`, `POST /api/sales/orders`, `PUT /api/sales/orders/:id/status` |
| **Delivery Notes** | `POST /api/sales/orders/:id/create-delivery-note`, `GET /api/sales/delivery-notes` |
| **Payroll & Employees** | `GET /api/payroll/weeks`, `POST /api/payroll/weeks`, `GET /api/payroll/employees`, `POST /api/payroll/employees` |
| **Costing / Margins** | `GET /api/costing/summary`, `POST /api/costing/simulate` |
| **Expenses** | `GET /api/expenses`, `POST /api/expenses`, `DELETE /api/expenses/:id` |
| **Fiscal Settings** | `GET /api/fiscal-settings`, `PUT /api/fiscal-settings` |
| **Exchange Rates** | `GET /api/exchange-rates`, `POST /api/exchange-rates/update`, `POST /api/exchange-rates/refresh` |
| **Audit Logs** | `GET /api/audit-logs`, `POST /api/audit-logs` |
| **System** | `POST /api/system/reset` (reset demo data) |
| **Dashboard Report** | `GET /api/reports/dashboard` |

All endpoints return JSON. Error handling follows the pattern `{ error: "description" }` with appropriate HTTP status codes (400, 404, 500).

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

The project uses **Vitest**. Run the suite:

```bash
bun run test          # runs all tests
bun run test -- --coverage   # generates coverage report in `coverage/`
```

A **badge** is embedded in the README (see the "Test Coverage" section). After running with `--coverage`, update the badge percentage manually or via a CI job.

---

## 🔮 Future Enhancements (roadmap)

- **Vector store for semantic memory** – long‑term context across sessions (e.g., Pinecone, Qdrant).
- **External market APIs** – connect `InformationGatheringAgent` to price‑forecast services for guava derivatives.
- **Role‑based access control** – refine `CybersecurityAgent.isAuthorized` with granular permissions per route.
- **PDF/Excel report generation** – leverage `jsPDF` + `jspdf-autotable` (already a dependency) to export dashboards.
- **Persistent session memory** – `MemoryAgent.persistToLocalStorage()` / `loadFromLocalStorage()` to survive page reloads.
- **CI/CD integration** – GitHub Actions to run tests, build, and auto‑update the README badge on each push.

---

## 📄 License

This project is private and intended for internal use by *Mermeladas Artesanales del Valle C.A*. All code is TypeScript‑strict, Angular 21‑compatible, and follows the project's ESLint/Prettier configuration.

---

*Generated on Mon Oct 26 2026* – this README reflects the current state of the multi‑agent architecture, agent interactions, and ready‑to‑use APIs.