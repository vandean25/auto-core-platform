[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

# Auto Core Platform

A multi-tenant workshop operations platform: parts inventory, procurement, sales, workshop jobs, vehicle stock, and finance. NestJS 11 API and React 19 + Vite 8 frontend.

## Modules

| Module | What it covers |
|--------|----------------|
| **Inventory** | Catalog items, storage locations, and ledger-based parts stock |
| **Procurement** | Purchase orders, goods receipt, vendors, and vendor bills |
| **Sales** | Customers, sales orders, and tax invoices |
| **Workshop** | Intake, job cards, board, parts pick, and mechanic queue |
| **Vehicle stock** | Dealer-owned vehicles, purchases, sales, and vehicle ledger (not parts inventory) |
| **Finance** | Fiscal lock date, sequential numbering, and revenue groups |
| **Auth/tenancy** | Firebase Auth, JWT guard, row-level `tenant_id` isolation, tenant members, and platform admin |

## Project Structure

```
auto-core-platform/
├── apps/
│   ├── core-api/          # NestJS 11 backend API
│   │   ├── prisma/        # Database schema & migrations (Prisma 7)
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts    # Seeds the default-workshop tenant + sample catalog
│   │   └── src/
│   │       ├── auth/           # Firebase JWT + session (`/api/auth`)
│   │       ├── tenant-member/  # Tenant membership & invites
│   │       ├── platform-admin/ # Super-admin tenant directory
│   │       ├── inventory/      # Parts inventory & ledger
│   │       ├── purchase/       # Procurement (POs, vendor bills)
│   │       ├── sales/          # Sales orders & invoices
│   │       ├── workshop/       # Workshop orders, board, pick
│   │       ├── vehicle-stock/  # Dealer vehicle stock
│   │       ├── finance/        # Fiscal settings & revenue groups
│   │       ├── customer/       # CRM
│   │       ├── vendor/         # Vendors
│   │       └── prisma/         # Prisma service + tenant query helpers
│   │
│   └── core-web/          # React 19 + Vite 8 frontend
│       ├── src/
│       │   ├── api/       # TanStack Query hooks & generated OpenAPI types
│       │   ├── auth/      # Firebase Auth provider
│       │   ├── components/# Reusable UI components
│       │   ├── pages/     # Page components (incl. workshop/, vehicle-stock/)
│       │   └── hooks/     # Custom React hooks
│       └── components.json # shadcn/ui configuration
```

---

## Prerequisites

- **Node.js** v20+ (recommended: v22)
- **PostgreSQL** v15+ (or use Docker)
- **npm** v9+

---

## Quick Start

### 1. Clone and Install Dependencies

This repo is an npm workspaces monorepo (`apps/*`). Install once at the root:

```bash
# Clone the repository
git clone <repository-url>
cd auto-core-platform

# Install backend and frontend workspace dependencies
npm install
```

From the root you can then run both apps with `npm run lint`, `npm test`, `npm run build`, or `npm run ci`.

### 2. Database Setup

The backend uses **Prisma** with **PostgreSQL**.

#### Option A: Neon PostgreSQL (Recommended)
This project uses **Neon** for the database.
Check `apps/core-api/.env` and ensure `DATABASE_URL` is set to your Neon connection string.

#### Option B: Local PostgreSQL
Create a `.env` file in `apps/core-api/`:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/auto_core?schema=public"
```

#### Option C: Docker PostgreSQL

```bash
docker run -d \
  --name auto-core-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=auto_core \
  -p 5432:5432 \
  postgres:15
```

Then set your `.env`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auto_core?schema=public"
```

#### Run Migrations

```bash
cd apps/core-api

# Generate Prisma client
npx prisma generate

# Apply migrations (creates tables)
npx prisma migrate dev

# Seed sample data (default-workshop tenant, ~50 parts, warehouses)
npx prisma db seed

# Optional: link a Firebase user as a tenant member or platform admin
npm run db:seed:tenant-member
npm run db:seed:platform-admin
```

### 3. Shared Secrets via Google Secret Manager (Recommended)

Use GSM so all machines/agents pull the same credentials without committing secrets.

1. Authenticate and set project:

```bash
gcloud auth login
gcloud config set project auto-core-platform
```

2. Create local mapping file from template:

```powershell
Copy-Item secrets/gsm-mapping.example.json secrets/gsm-mapping.json
```

```bash
# macOS/Linux
cp secrets/gsm-mapping.example.json secrets/gsm-mapping.json
```

3. Update `secrets/gsm-mapping.json` with your real GSM secret names.

4. Pull secrets:

```bash
# Backend -> apps/core-api/.env
npm --prefix apps/core-api run secrets:pull

# Frontend -> apps/core-web/.env.local
npm --prefix apps/core-web run secrets:pull
```

Detailed reference: `docs/google-secret-manager.md`

---

## Development

### Start Backend (NestJS)

```bash
cd apps/core-api
npm run start:dev
```

The API runs at **http://localhost:3000**

### Start Frontend (Vite + React)

```bash
cd apps/core-web
npm run dev
```

The frontend runs at **http://localhost:5173**

> **Note:** The frontend proxies `/api` requests to `http://localhost:3000` automatically.

---

## Frontend List UI Standard

Use this as the default blueprint whenever creating or refactoring list pages.

- **Container/layout**: `w-full max-w-7xl mx-auto p-6` with standard header spacing (`mb-8`).
- **Header typography**: title uses `text-2xl font-semibold tracking-tight`; subtitle uses `text-slate-500`.
- **Top-right create action**: use plus icon with entity-only label format `+ <Entity>` (examples: `+ Customer`, `+ Vendor`, `+ Order`, `+ Purchase Order`). Do not use `Add`, `New`, or `Create` in the button label.
- **Table implementation**: use shared `DataTable` + `DataTableColumnHeader` patterns instead of ad-hoc tables for list views.
- **Search behavior**: each list must provide search and it should match against all relevant visible row fields (same behavior expected as the Item list).
- **Sorting behavior**: sortable columns should use the shared header sort behavior for consistency across modules.
- **Column sizing**: keep column widths aligned across lists using the Item list proportions as the baseline.
- **Status UI**: render statuses with shared `StatusBadge` (`@/components/status/StatusBadge`) to keep size, typography, and color mapping consistent app-wide.
- **Row interaction**: clicking a row should open that entity's detail page/card; avoid separate inline edit/detail icon buttons in list rows.
- **Right-click action**: right-clicking a row should expose a `Delete` action where the backend supports deletion for that entity.

---

## Entity Deletion Policy

Deletion rules are defined centrally in [docs/deletion-policy.md](docs/deletion-policy.md).

- Use delete only where policy allows.
- Prefer cancel/archive/status transitions for transactional and financial entities.
- Backend guards are the source of truth; frontend should hide clearly disallowed actions and display backend error messages.

---

## Production Hosting & Auth

### Firebase Project

- **Backend + Cloud Build + Hosting + Firebase Auth Project**: `auto-core-platform-vande`

The application now uses a single Firebase/GCP project for backend deployment, frontend hosting, and Firebase Authentication.

### Firebase Auth (Frontend)

The frontend uses Firebase Authentication and supports:

- Email/Password
- Google Sign-In

All app routes are protected behind login in production.

### Auth & Tenancy (Backend)

API routes are behind a global `JwtAuthGuard`. The bearer token is a Firebase ID token (or a locally signed test JWT when `NODE_ENV=test`). Authorization is resolved from Postgres `User` + `TenantMember` rows, not from token `tenantId` / `role` claims.

- `GET /api/auth/me` — current session (active tenant, memberships, platform role)
- `POST /api/auth/switch-tenant` — switch the user's active tenant
- `TenantContextMiddleware` sets the request tenant; tenant-scoped Prisma queries must include `tenant_id`
- Roles: `OWNER`, `ADMIN`, `TECH`, `SALES` on `TenantMember`; `SUPER_ADMIN` on `PlatformAdmin`
- Mechanic (tablet) sessions (`TECH`) may only call endpoints marked `@MechanicAccessible()`

Seed helpers: `npm run db:seed:tenant-member` and `npm run db:seed:platform-admin` in `apps/core-api`.

### Frontend Environment Variables

Set these in the build/deploy environment for `apps/core-web`:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

Production does not require `VITE_API_BASE_URL`. Cloud Build intentionally
leaves it unset so the browser keeps API requests relative to the Firebase
Hosting origin. Firebase Hosting rewrites `/api/**` to the `core-api` Cloud Run
service in `europe-west3`; REST calls use `/api/...` and the production
Socket.IO path is `/api/socket.io`. In local development, Vite proxies REST
requests through `/api` and Socket.IO through `/socket.io` to the local API.

Firebase Hosting Cloud Run rewrites resolve `serviceId` in the same GCP project
as the Hosting site. Before deploying this rewrite, ensure the Cloud Run
service and Hosting site are project-aligned; the current pipeline declares
`auto-core-platform` as `_BACKEND_PROJECT` and
`auto-core-platform-vande` as `_FRONTEND_PROJECT`. Same-organization IAM alone
does not make a rewrite cross-project, so otherwise use a same-project proxy
or align the deployment projects. Do not replace the NestJS service with
Cloud Functions.

For local development, create `apps/core-web/.env.local` (already gitignored by `*.local`) and set at least:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
```

After editing env values, restart the Vite dev server.

Before relying on realtime connections in production, verify the Socket.IO
WebSocket upgrade on a staging Hosting channel. Cloud Run supports WebSockets
directly, but Hosting Cloud Run rewrites are documented primarily for HTTP
requests and must be validated for this upgrade. If Hosting cannot proxy the
upgrade reliably, use an explicitly configured direct Cloud Run origin as a
temporary deployment fallback; do not move NestJS to Cloud Functions. Keep
`VITE_API_BASE_URL` empty in the normal production build so REST remains
same-origin.

### Create Login User (Email/Password)

If Firebase Email/Password is enabled but you do not have a user yet, create one with the Identity Toolkit API:

```bash
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<VITE_FIREBASE_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@your-domain.com","password":"StrongPassword123!","returnSecureToken":true}'
```

You can also create users from Firebase Console:
Authentication -> Users -> Add user.

### Firebase Console Requirements

In Firebase project `auto-core-platform-vande`:

1. Enable Authentication providers you use (`Email/Password`, `Google`).
2. Ensure authorized domains include your hosting domains.
3. Create/allow users who should sign in.

---

## CI/CD (Tag Trigger)

The release trigger deploys on tags matching `^v.*$`.

- Build file: `cloudbuild.yaml`
- Hosting config: `firebase.json` (site set to `auto-core-platform-vande`)

Tag-triggered Cloud Build runs `prisma migrate deploy` and fails the release on any non-zero exit, including Prisma `P3005` (schema not empty / not baselined). Do not skip `P3005` in that pipeline.

If a non-empty database has never been baselined, run a **manual one-shot** outside the production deploy:

```bash
npm --prefix apps/core-api run db:baseline -- --applied <migration_name>
```

Release Firebase substitutions in `cloudbuild.yaml` must match the GSM-backed `core-web` values for `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID`.

### Required APIs

In project `auto-core-platform-vande`:

- `cloudbuild.googleapis.com`
- `firebase.googleapis.com` (Firebase Management API)
- `firebasehosting.googleapis.com` (Firebase Hosting API)
- `identitytoolkit.googleapis.com`


### Required IAM for build service account

Cloud Build service account used by trigger (currently `cbuild-deployer@auto-core-platform.iam.gserviceaccount.com`) needs access on `auto-core-platform-vande`:

- `roles/firebase.admin`
- `roles/firebasehosting.admin`
- `roles/serviceusage.apiKeysViewer`

---

## Available Commands

### Repository root

| Command | Description |
|---------|-------------|
| `npm install` | Install all workspace dependencies (`apps/core-api` and `apps/core-web`) |
| `npm run lint` | Lint both apps |
| `npm test` | Run unit tests for both apps |
| `npm run build` | Build both apps |
| `npm run ci` | Lint, test, then build both apps |

Workspace-specific scripts still work from the root with `--workspace=<name>` (for example `npm run start:dev --workspace=core-api`).

### Backend (`apps/core-api`)

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start development server with hot reload |
| `npm run build` | Build for production |
| `npm run start:prod` | Run production build |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run lint` | Lint code (no auto-fix; used by PR CI) |
| `npm run lint:fix` | Lint and auto-fix code |
| `npm run openapi:generate` | Generate OpenAPI spec to `openapi/openapi.json` |
| `npm run openapi:check` | Regenerate OpenAPI and fail if spec drift is uncommitted |
| `npx prisma studio` | Open Prisma Studio (database GUI) |
| `npx prisma migrate dev` | Apply pending migrations |
| `npm run db:baseline -- --applied <migration>` | One-shot Prisma baseline (`migrate resolve --applied`); not used by Cloud Build |
| `npx prisma db seed` | Seed `default-workshop` tenant and sample catalog |
| `npm run db:seed:tenant-member` | Link a Firebase user as an active tenant member |
| `npm run db:seed:platform-admin` | Link a Firebase user as a platform super-admin |
| `npm run lint:prisma-tenant` | Lint tenant-scoped Prisma queries for missing `tenant_id` |

### Frontend (`apps/core-web`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run test` | Run Vitest unit tests |
| `npm run test:e2e` | Run Playwright end-to-end tests |
| `npm run lint` | Lint code |
| `npm run api:types:generate` | Generate API types from backend OpenAPI |
| `npm run api:types:check` | Regenerate API types and fail if drift is uncommitted |

---

## API Contract Workflow (Long-Term)

The project now treats backend OpenAPI as the source of truth for API contracts.

1. Generate backend spec:
   - `npm --prefix apps/core-api run openapi:generate`
2. Generate frontend API types from that spec:
   - `npm --prefix apps/core-web run api:types:generate`
3. Commit updated artifacts when API contracts change:
   - `apps/core-api/openapi/openapi.json`
   - `apps/core-web/src/api/generated/openapi.ts`

PR checks enforce this by regenerating both files and failing if there is uncommitted drift.

---

## API Endpoints

### Inventory

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/inventory` | List inventory items (paginated) |
| `GET` | `/api/inventory/:id` | Get single inventory item |
| `GET` | `/api/inventory/:id/history` | Get item transaction history |

### CRM & Sales

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/customers` | List customers (searchable) |
| `POST` | `/api/customers` | Create new customer |
| `GET` | `/api/sales-orders` | List sales orders (status filter) |
| `POST` | `/api/sales-orders` | Create sales order |
| `POST` | `/api/sales-orders/:id/create-invoice` | Convert order to invoice |

### Purchase Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/purchase-orders` | Create a new purchase order |
| `GET` | `/api/purchase-orders` | List purchase orders (optional `status` filter) |
| `GET` | `/api/purchase-orders/:id` | Get single purchase order details |
| `POST` | `/api/purchase-orders/:id/receive` | Receive items against a PO |

### Vendors

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/vendors` | Create a new vendor |
| `GET` | `/api/vendors` | List all vendors |
| `GET` | `/api/vendors/:id` | Get single vendor details |
| `PUT` | `/api/vendors/:id` | Update vendor details |

### Workshop

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/workshop/register` | Register intake (customer + vehicle) |
| `GET` | `/api/workshop/orders` | List workshop orders (paginated) |
| `POST` | `/api/workshop/orders` | Create a workshop order |
| `GET` | `/api/workshop/orders/:id` | Get workshop order details |
| `POST` | `/api/workshop/orders/:id/pick-parts` | Pick / stage parts for a job |
| `POST` | `/api/workshop/orders/:id/create-invoice` | Invoice a completed workshop order |

### Vehicle stock

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/vehicle-stock` | List dealer-owned vehicles (status filter) |
| `GET` | `/api/vehicle-stock/:vehicleId` | Get vehicle stock detail |
| `POST` | `/api/vehicle-purchases` | Create a vehicle purchase (intake to stock) |
| `POST` | `/api/vehicle-sales` | Create a vehicle sale |

### Finance

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/finance/settings` | Get fiscal settings (lock date, numbering) |
| `PATCH` | `/api/finance/settings` | Update fiscal settings |
| `GET` | `/api/finance/revenue-groups` | List revenue groups |

### Auth/tenancy

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/auth/me` | Current session, active tenant, memberships |
| `POST` | `/api/auth/switch-tenant` | Switch active tenant |
| `GET` | `/api/tenant-members` | List members of the active tenant |
| `POST` | `/api/tenant-members/invite` | Invite a user to the tenant |
| `GET` | `/api/platform/tenants` | Super-admin tenant directory |

---

## Frontend Features

### CRM & Sales Workflow

- **Customer Management**: Full CRM profile with order history, invoices, and vehicle registry.
- **Sales Orders**: Create draft orders, manage line items, and track status.
- **Workflow**: Draft -> Confirmed -> Invoice.
- **Sequential Numbering**: Auto-incrementing order (SO-2026-XXXX) and invoice (RE-2026-XXXX) numbers.

### Inventory List Page

- **Apple-style data grid** with TanStack Table
- **Status indicators**: Green (In Stock), Red (Out of Stock), Orange (Superseded)
- **Side drawer** for item details with Overview and History tabs
- **Empty state** handling with graceful fallback UI

### Global Command Menu (Cmd+K)

Press `Ctrl+K` (Windows/Linux) or `Cmd+K` (Mac) to open the global search.

**Features:**
- 🔍 Debounced inventory search (300ms)
- 🚀 Quick actions (Create Invoice, Register Customer)
- 📦 Inventory results with live filtering

### Purchase Order Management

- **Create Purchase Orders**: Select vendor, add items, and calculate totals.
- **Receive Items**: Track received quantities against ordered items.
- **Status Tracking**: Draft -> Sent -> Partial -> Completed workflow.

### Vendor Management

- **Vendor Directory**: List and search vendors.
- **Vendor Details**: Manage contact info and supported brands.

### Workshop

- **Intake & job cards**: Register a vehicle, create workshop orders and tasks, print job-card PDFs.
- **Board & pick list**: Kanban board for bay/mechanic assignment; warehouse pick/stage for required parts.
- **Mechanic tablet**: `/mechanic/queue` for `TECH` sessions (RBAC-restricted API).

### Vehicle stock

- **Dealer stock list**: Status-filtered list of used/stock vehicles (separate from parts inventory).
- **Purchase & sale**: Intake a vehicle to stock; sell from stock onto a fiscal invoice.

### Auth/tenancy

- **Login + tenant switcher**: Firebase session, `GET /api/auth/me`, switch active tenant from the sidebar.
- **Settings**: Tenant members, finance, brands, and storage locations on the gear-icon Settings page.
- **Platform admin**: `/platform/tenants` for `SUPER_ADMIN`.

---

## Database Schema

### Core Models

- **Tenant / User / TenantMember**: Row-level multi-tenancy; membership roles `OWNER`, `ADMIN`, `TECH`, `SALES`
- **CatalogItem**: Product catalog with SKU, pricing, and supersession chains
- **StorageLocation**: Hierarchical warehouse structure (warehouse → shelf → bin)
- **InventoryStock**: Current stock levels per item/location
- **InventoryTransaction**: Full audit trail of all stock movements
- **Customer**: Private or Company profiles with contact info
- **Vehicle**: VIN master (`CUSTOMER` service cars vs dealer stock)
- **WorkshopOrder / WorkshopTask**: Job cards, labor, and parts lines
- **VehiclePurchase / VehicleSale / VehicleLedgerEntry**: Dealer vehicle stock (not parts)
- **SalesOrder**: Customer orders
- **Invoice**: Fiscal documents linked to sales orders, workshop orders, or vehicle sales
- **Vendor**: Suppliers with contact info and supported brands
- **PurchaseOrder**: Orders to vendors with status tracking
- **FinanceSettings / RevenueGroup**: Lock date, numbering, revenue categories

### Transaction Types

| Type | Description |
|------|-------------|
| `PURCHASE_RECEIPT` | Goods received from supplier |
| `SALE_ISSUE` | Items sold to customer |
| `ADJUSTMENT` | Manual stock correction |
| `TRANSFER_IN` | Stock moved in from another location |
| `TRANSFER_OUT` | Stock moved out to another location |
| `INITIAL_BALANCE` | Opening balance entry |

---

## Tech Stack

### Backend
- **NestJS 11** - Node.js framework
- **Prisma 7** - ORM with PostgreSQL
- **TypeScript** - Type safety

### Frontend
- **React 19** - UI library
- **Vite 8** - Build tool
- **TanStack Query** - Server state management
- **TanStack Table** - Data grid
- **Tailwind CSS 4** - Styling
- **shadcn/ui** - UI components
- **cmdk** - Command palette
- **Framer Motion** - Animations

---

## Troubleshooting

### "Cannot apply unknown utility class"

This is a Tailwind v4 + shadcn/ui compatibility issue. Ensure your `src/index.css` uses the `@theme` block format:

```css
@import "tailwindcss";

@theme {
  --color-background: hsl(0 0% 100%);
  --color-foreground: hsl(222.2 84% 4.9%);
  /* ... other colors */
}
```

### "verbatimModuleSyntax" Import Errors

When importing types, use `import type`:

```typescript
// ✅ Correct
import type { InventoryResponse } from './types'

// ❌ Wrong (will cause runtime errors)
import { InventoryResponse } from './types'
```

### Prisma Client Not Generated

```bash
cd apps/core-api
npx prisma generate
```

### Database Connection Refused

Ensure PostgreSQL is running and your `DATABASE_URL` in `.env` is correct.

### Cloud Build Firebase Deploy Error

If Cloud Build fails on hosting deploy with errors like:

- `Failed to get Firebase project ...`
- `Firebase Management API has not been used in project ...`
- `Firebase Hosting API has not been used in project ...`

Check:

1. `firebase.googleapis.com` and `firebasehosting.googleapis.com` are enabled in **build project** (`auto-core-platform-vande`).
2. Build service account has Firebase roles on `auto-core-platform-vande`.
3. `firebase.json` contains the correct hosting site name.

---

## License

This project is licensed under the GNU Affero General Public License v3.0 or later (SPDX: AGPL-3.0-or-later). This ensures that the software remains free and open source. If you modify this software and provide access to it over a network (like a web application), you must also share your modified source code under the same license.
