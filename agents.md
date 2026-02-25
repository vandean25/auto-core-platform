---
trigger: always_on
---

# AI Assistant Instructions & Context: Auto Core Platform

This document provides a comprehensive overview of the Auto Core Platform project, including its architecture, technology stack, development conventions, critical instructions, and operational procedures.

## Project Overview

Auto Core Platform is a full-stack automotive parts management system designed for inventory tracking, purchase order processing, vendor management, sales invoicing, and financial reporting.

### Core Modules
- **Inventory**: Tracks automotive parts, storage locations, and stock levels with a full audit trail (ledger-based).
- **Purchase (Procurement)**: Manages purchase orders (POs) from draft to completion, including goods receipt and vendor billing.
- **Sales (CRM & Invoicing)**:
    - **CRM**: Customer management (Private/Company) with full order and vehicle history.
    - **Sales Orders**: Workflow from Draft -> Confirmed -> In Progress -> Completed -> Invoiced.
    - **Invoicing**: Generates final tax invoices from completed sales orders with real-time stock integration.
- **Finance**: Manages global fiscal settings (lock dates, numbering) and revenue categorization for accounting exports.
- **Brand (Master Data)**: Centralized management of vehicle makes and part manufacturers, enabling consistent categorization and smart filtering.
- **Vendor**: Management of external stakeholders and their associated data (brands, contact info).

## Technology Stack

### Backend (`apps/core-api`)
- **Framework**: NestJS (Node.js)
- **ORM**: Prisma
- **Database**: PostgreSQL
- **Validation**: class-validator & class-transformer
- **Testing**: Jest (Unit & E2E)

### Frontend (`apps/core-web`)
- **Framework**: React 19 (Vite 7)
- **Styling**: Tailwind CSS 4
- **UI Components**: shadcn/ui
- **State Management**: TanStack Query (v5)
- **Data Grid**: TanStack Table
- **Charts**: Recharts
- **Icons**: Lucide React
- **Notifications**: Sonner

## Architecture & Structure

```text
auto-core-platform/
├── apps/
│   ├── core-api/          # NestJS backend
│   │   ├── prisma/        # Schema and migrations
│   │   └── src/           # Modular services & controllers
│   │       ├── brand/     # Brand Master Data
│   │       ├── customer/  # CRM Module
│   │       ├── finance/   # Finance Settings & Revenue Groups
│   │       ├── inventory/ # Inventory & Ledger
│   │       ├── purchase/  # Procurement
│   │       ├── sales/     # Sales Orders & Invoices
│   │       └── vendor/    # Vendor Management
│   └── core-web/          # React frontend
│       ├── src/api/       # TanStack Query hooks & types
│       ├── src/components/# UI & Feature components
│       ├── src/hooks/     # Custom React hooks
│       ├── src/pages/     # Routed page components
│       └── src/index.css  # Tailwind theme config
```

## Critical Rules & Development Conventions

### TypeScript Configuration
- **Type Safety**: `verbatimModuleSyntax` is enforced in `apps/core-web`. Use `import type` for all type-only imports (recommended project-wide, required in frontend).
  ```typescript
  // ✅ Correct
  import type { InventoryItem, InventoryResponse } from './types'
  import { useQuery } from '@tanstack/react-query'
  
  // ❌ Wrong - can fail under verbatimModuleSyntax
  import { InventoryItem, InventoryResponse } from './types'
  ```

### Frontend Patterns
- **Tailwind v4**: All styling is defined in `@theme` blocks in `src/index.css`, NOT in `tailwind.config.js`. Utility classes are preferred.
- **shadcn/ui**: Components are located in `src/components/ui/`. Import from `@/components/ui/<component-name>`. Use the `cn()` utility from `@/lib/utils` for conditional classes. Use shadcn/ui primitives when possible.
- **Data Fetching**: Use **TanStack Query** for all API calls. Hooks go in `src/api/` (e.g., `useInventory`, `useInventoryHistory`). API types go in `src/api/types.ts`.
- **Components**: Page components in `src/pages/`, Reusable components in `src/components/`.
- **Navigation & Layout**: Defined in `src/App.tsx`. Navigation is grouped into domains (Sales, Inventory, Procurement, Workshop).
- **Settings**: All configuration (Finance, Revenue Groups, Brands, Storage Locations) is consolidated into a unified tabbed page at `src/pages/SettingsPage.tsx`, accessible via the gear icon.

### Page Layout Defaults
- **Main Container**: Wrap page content in `<div className="w-full max-w-7xl mx-auto p-6 space-y-6">` (adjust `space-y-` based on need, `space-y-6` or `space-y-8` is common).
- **Header Section**: Use a flex container for titles and actions:
  ```tsx
  <div className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-4"> {/* Optional gap for back button + title */}
          <div>
              <h1 className="text-2xl font-semibold tracking-tight">Page Title</h1>
              <p className="text-slate-500">Optional subtitle description.</p>
          </div>
      </div>
      <div className="flex gap-2"> {/* Optional container for multiple action buttons */}
          {/* Actions / Buttons go here */}
      </div>
  </div>
  ```
- **Typography/Colors**: Use `text-2xl font-semibold tracking-tight` for main page headers, and `text-slate-500` for subtitles instead of `text-muted-foreground`.
- **Lists / Tables**: Prefer using the shared `DataTable` component abstraction (`@/components/data-table/DataTable`) over constructing raw tables in `src/pages/` components for listing data.


### Backend Patterns
- **Services**: Business logic stays in services; controllers handle HTTP routing. Services go in feature modules (e.g., `src/inventory/inventory.service.ts`).
- **Prisma**: Use `PrismaService` for all DB operations. Schema uses `snake_case` via `@@map()`. Always run `npx prisma generate` after schema changes. Seed data is in `prisma/seed.ts`. Use `npx prisma migrate dev` for development migrations.
- **Validation**: Global `ValidationPipe` is enabled in `main.ts`.

### API Conventions
- **Prefix**: All endpoints are prefixed with `/api`.
- **Formatting**: List endpoints return `{ data, meta }` format for list endpoints. Use pagination with `page` and `limit` query params.
- **Proxy**: Vite handles `/api` proxying to backend `http://127.0.0.1:3000` in dev mode.

### API Contract Source of Truth
- **OpenAPI is authoritative**: Backend contract is generated to `apps/core-api/openapi/openapi.json`.
- **Frontend types are generated**: Use `apps/core-web/src/api/generated/openapi.ts` from OpenAPI instead of manually duplicating DTO contracts.
- **Required update flow when backend DTO/controller contract changes**:
  1. `npm --prefix apps/core-api run openapi:generate`
  2. `npm --prefix apps/core-web run api:types:generate`
  3. Commit both generated files.
- **CI enforcement**: PR workflow regenerates OpenAPI + frontend generated types and fails on drift.

### Testing Standards
- **Write integration tests for each feature module**:
  - Focus on end-to-end flows (e.g., creating a PO and receiving items, Customer -> Sales Order -> Invoice).
  - Backend tests go in `apps/core-api/test/` as `.e2e-spec.ts` files.
  - Use the established testing patterns (e.g., `test/purchase-receipt.e2e-spec.ts`).
  - Ensure tests cover both happy paths and error cases.

## Database Schema Highlights

- **Tables**: use snake_case via `@@map()` directive.
- **IDs**: are UUIDs.
- **Timestamps**: Use `createdAt` and `updatedAt` timestamps.
- **Supersession chains**: use self-referencing relations.
- **Centralized Brands**: Uses `Brand` entity to standardize vehicle makes and part manufacturers.
- **Ledger-based Inventory**: Every stock movement is recorded in `InventoryTransaction`.
- **Fiscal Security**: Transactions are validated against `FinanceSettings.lock_date`.
- **Purchase Orders**: follow a strict status workflow (DRAFT -> SENT -> PARTIAL -> COMPLETED).
- **Sales Workflow**:
  - `Customer` (Private/Company) -> `SalesOrder` (Draft) -> `Invoice` (Final).
  - Numbering: Sequential numbering for Sales Orders (`SO-2026-XXXX`) and Invoices (`RE-2026-XXXX`).
  - Invoice Snapshot: Invoices snapshot `revenue_group_name` and `unit_price` at the moment of sale.
- **Relations**:
  - `InventoryStock` is one-to-many with `CatalogItem` (allows multiple locations).
  - `SalesOrder` links to `Customer` and optionally `Vehicle`.

## Building and Running

### Prerequisites
- Node.js v20+ (v22 recommended)
- PostgreSQL v15+
- npm v9+

### Setup Commands
```bash
# Install dependencies (from root)
npm install --prefix apps/core-api
npm install --prefix apps/core-web

# Database Initialization
cd apps/core-api
npx prisma generate
npx prisma migrate dev
npx prisma db seed
```

### Development Servers & Common Commands
```bash
# Backend (Port 3000)
cd apps/core-api
npm run start:dev          # Start with hot reload
npx prisma studio          # Database GUI
npx prisma migrate dev     # Apply migrations
npx prisma db seed         # Seed sample data

# Frontend (Port 5173)
cd apps/core-web
npm run dev                # Start dev server
npm run build              # Production build
```

## Known Troubleshooting & Gotchas
1. **Blank page in browser?** Check Vite terminal for CSS errors / Tailwind Utility Errors (Check `@theme` block format in `index.css`).
2. **Import errors?** Ensure type-only imports use `import type`.
3. **Prisma errors / Type Errors?** Run `npx prisma generate` after pulling schema changes.
4. **API 404s?** Confirm backend is running on port 3000 and proxy is active.

## MCP Servers & Skills
This project uses the following MCP servers:
- **mcp-server-neon**: For managing the Neon PostgreSQL database (branching, migrations, etc.).
- **github-mcp-server**: For GitHub operations.
- **prisma-mcp-server**: For database schema management.

Use the `mcp-server-neon` skills for database operations like creating branches or running migrations.
