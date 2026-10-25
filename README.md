# Mermelada Guayaba ERP / MRP

**AI‑enhanced enterprise resource planning system for artisanal guava jam production.**

## Overview

This application manages inventory, production orders, sales, payroll, expenses, fiscal settings, and more for a small‑scale food‑production business. It is built with Angular (v21) and Express (SSR) and includes a set of **multi‑agents** that assist with planning, database operations, testing, cybersecurity, information gathering, memory, and documentation.

## Multi‑Agent Architecture

The system integrates the following specialized agents, each responsible for a distinct domain:

| Agent | Role |
|-------|------|
| **PlannerAgent** | Breaks down high‑level goals into actionable tasks and routes them to the appropriate specialist agent. |
| **DatabaseExpertAgent** | Provides typed, safe wrappers around the ERP database (`dbInstance`) for CRUD operations on raw materials, recipes, production orders, customers, sales, payroll, expenses, exchange rates, audit logs, etc. |
| **TestAgent** | Scaffolds Vitest test files, runs the test suite (`npm run test`), and can generate coverage reports. |
| **CybersecurityAgent** | Validates and sanitizes inputs, checks for SQL‑injection/XSS patterns, authorizes user roles, and logs security events. |
| **InformationGatheringAgent** | Collects data from the database and external sources, synthesizes summaries (e.g., low‑stock reports, exchange‑rate snapshots, production dashboards). |
| **MemoryAgent** | In‑memory key‑value store that can persist to `localStorage`/`sessionStorage`; useful for retaining context across agent calls within a session. |
| **DocumentationRegistrationAgent** | Scaffold markdown docs, register (write) them to disk, and generate a Table of Contents for the project's documentation folder. |

## How the Agents Interact

1. **PlannerAgent** receives a user goal (e.g., "Check low stock of raw materials") and produces a task list.
2. Each task is dispatched to the corresponding agent (e.g., `DatabaseExpertAgent` → `getRawMaterials`, `InformationGatheringAgent` → `getLowStockReport`).
3. The **MemoryAgent** can store intermediate results or session state so that later agents have access to previous context.
4. The **CybersecurityAgent** is invoked whenever external data enters the system to ensure validation before any DB or API call.
5. The **TestAgent** can be triggered to generate and run tests for new functionality.
6. The **DocumentationRegistrationAgent** writes markdown files and updates the project README with the latest doc markers.

## Getting Started

```bash
# Install dependencies
bun install   # or npm install

# Start the development server (Angular + Express SSR)
bun run dev

# Run the test suite
bun run test

# Build for production
bun run build
```

## API Endpoints

The Express server exposes a REST API under `/api/*`. See `src/server.ts` for the full list (inventory, production, sales, payroll, fiscal, exchange rates, audit logs, expenses, reports, etc.).

## Adding New Functionality

1. Define a new task in the **PlannerAgent** (`src/app/core/agents/planner-agent.ts`).
2. Implement the corresponding methods in **DatabaseExpertAgent** if the task involves data persistence.
3. Add validation via **CybersecurityAgent** before any DB write.
4. Write unit tests using **TestAgent** scaffolding.
5. If the feature requires memory, use **MemoryAgent** `set`/`get`.
6. Register documentation with **DocumentationRegistrationAgent** to keep the docs up‑to‑date.

## Future Enhancements

- Integrate a vector store for semantic memory (long‑term context).
- Connect the **InformationGatheringAgent** to external market APIs for price forecasts.
- Add role‑based access control using the **CybersecurityAgent** checks.

## Test Coverage

Get the latest test coverage badge from Vitest:

[![Coverage Status](https://img.shields.io/badge/coverage-??.??%25-blue)](https://github.com/your-org/mermelada/actions)

Run `bun run test -- --coverage` to generate the report (`coverage/` folder) and update the badge percentage.