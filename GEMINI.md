# GEMINI Context: Auto Core Platform

This document provides a comprehensive overview of the Auto Core Platform project, including its architecture, technology stack, development conventions, and operational procedures.

## Project Overview

Auto Core Platform is a full-stack automotive parts management system designed for inventory tracking, purchase order processing, vendor management, sales invoicing, and financial reporting.

### Core Modules
- **Inventory**: Tracks automotive parts, storage locations, and stock levels with a full audit trail (ledger-based).
- **Purchase (Procurement)**: Manages purchase orders (POs) from draft to completion, including goods receipt and vendor billing.
- **Sales**: Handles customer invoicing with real-time stock integration and revenue snapshotting.
- **Finance**: Manages global fiscal settings (lock dates, numbering) and revenue categorization for accounting exports.
- **Brand (Master Data)**: Centralized management of vehicle makes and part manufacturers, enabling consistent categorization and smart filtering.
- **Vendor & Customer**: Management of external stakeholders and their associated data (vehicles, contact info).

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

```
auto-core-platform/
├── apps/
│   ├── core-api/          # NestJS backend
│   │   ├── prisma/        # Schema and migrations
│   │   └── src/           # Modular services & controllers
│   └── core-web/          # React frontend
│       ├── src/api/       # TanStack Query hooks & types
│       ├── src/components/# UI & Feature components
│       └── src/pages/     # Routed page components
```

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

### Development Servers
```bash
# Backend (Port 3000)
cd apps/core-api
npm run start:dev

# Frontend (Port 5173)
cd apps/core-web
npm run dev
```

## Development Conventions

### TypeScript & Style
- **Type Safety**: Enforced `verbatimModuleSyntax`. **ALWAYS** use `import type` for type-only imports.
- **Tailwind v4**: All styling is defined in `@theme` blocks in `src/index.css`. Utility classes are preferred.
- **shadcn/ui**: Components are in `src/components/ui/`. Use the `cn()` utility for conditional classes.

### Backend Patterns
- **Services**: Business logic stays in services; controllers handle HTTP routing.
- **Prisma**: Use `PrismaService` for all DB operations. Schema uses `snake_case` via `@@map()`.
- **Validation**: Global `ValidationPipe` is enabled in `main.ts`.

### Testing Standards
- **Integration Tests**: Required for each feature module (`apps/core-api/test/*.e2e-spec.ts`).
- **Flow Focus**: Tests must cover end-to-end business flows (e.g., PO -> Receipt -> Bill).

### API Conventions
- **Prefix**: All endpoints are prefixed with `/api`.
- **Formatting**: List endpoints return `{ data, meta }`.
- **Proxy**: Vite handles `/api` proxying to backend in dev mode.

## Database Schema Highlights

- **Centralized Brands**: Uses `Brand` entity to standardize vehicle makes and part manufacturers across vendors and catalog items.
- **Ledger-based Inventory**: Every stock movement is recorded in `InventoryTransaction`.
- **Fiscal Security**: Transactions are validated against `FinanceSettings.lock_date`.
- **Snapshotting**: Invoices snapshot `revenue_group_name` and `unit_price` at the moment of sale to preserve historical accuracy.
- **Workflow State**:
  - Purchase Orders: `DRAFT` → `SENT` → `PARTIAL` → `COMPLETED`
  - Invoices: `DRAFT` → `FINALIZED` → `PAID` → `CANCELLED`

## Known Troubleshooting
- **Tailwind Utility Errors**: Check `@theme` block format in `index.css`.
- **Prisma Type Errors**: Ensure `npx prisma generate` was run after schema changes.
- **API 404s**: Confirm backend is running on port 3000 and proxy is active.
