# Auto Core Platform

A full-stack automotive parts management platform built with NestJS (backend) and React + Vite (frontend).

## Project Structure

```
auto-core-platform/
├── apps/
│   ├── core-api/          # NestJS backend API
│   │   ├── prisma/        # Database schema & migrations
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts    # Database seeding script
│   │   └── src/
│   │       ├── brand/     # Brand Master Data
│   │       ├── customer/  # CRM & Customer Management
│   │       ├── inventory/ # Inventory module
│   │       ├── purchase/  # Purchase Order module
│   │       ├── sales/     # Sales Order & Invoice module
│   │       ├── vendor/    # Vendor management module
│   │       └── prisma/    # Prisma service module
│   │
│   └── core-web/          # React + Vite frontend
│       ├── src/
│       │   ├── api/       # API hooks and types
│       │   ├── components/# Reusable UI components
│       │   ├── pages/     # Page components
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

```bash
# Clone the repository
git clone <repository-url>
cd auto-core-platform

# Install backend dependencies
cd apps/core-api
npm install

# Install frontend dependencies
cd ../core-web
npm install
```

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

# Seed sample data (50 automotive parts + 3 warehouses)
npx prisma db seed
```

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

## Production Hosting & Auth

### Project Split

- **Backend + Cloud Build Project**: `auto-core-platform`
- **Frontend Hosting + Firebase Auth Project**: `auto-core-platform-vande`

This split is supported. Deploys run from Cloud Build in `auto-core-platform` and deploy hosting to `auto-core-platform-vande`.

### Firebase Auth (Frontend)

The frontend uses Firebase Authentication and supports:

- Email/Password
- Google Sign-In

All app routes are protected behind login in production.

### Frontend Environment Variables

Set these in build/deploy environment for `apps/core-web`:

```env
VITE_API_BASE_URL=
VITE_API_KEY=
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_ALLOWED_LOGIN_EMAILS=
```

`VITE_ALLOWED_LOGIN_EMAILS` is a comma-separated allowlist (example: `van.dean25@gmail.com,admin@company.com`).
If empty, any authenticated Firebase user can access the UI.

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

### Required APIs

In **build project** (`auto-core-platform`):

- `cloudbuild.googleapis.com`
- `firebase.googleapis.com` (Firebase Management API)
- `firebasehosting.googleapis.com` (Firebase Hosting API)

In **Firebase project** (`auto-core-platform-vande`):

- `identitytoolkit.googleapis.com`
- `firebase.googleapis.com`

### Required IAM for build service account

Cloud Build service account used by trigger (currently `cbuild-deployer@auto-core-platform.iam.gserviceaccount.com`) needs access on `auto-core-platform-vande`:

- `roles/firebase.admin`
- `roles/firebasehosting.admin`
- `roles/serviceusage.apiKeysViewer`

---

## Available Commands

### Backend (`apps/core-api`)

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start development server with hot reload |
| `npm run build` | Build for production |
| `npm run start:prod` | Run production build |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run lint` | Lint and fix code |
| `npx prisma studio` | Open Prisma Studio (database GUI) |
| `npx prisma migrate dev` | Apply pending migrations |
| `npx prisma db seed` | Seed database with sample data |

### Frontend (`apps/core-web`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Lint code |

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

---

## Database Schema

### Core Models

- **CatalogItem**: Product catalog with SKU, pricing, and supersession chains
- **StorageLocation**: Hierarchical warehouse structure (warehouse → shelf → bin)
- **InventoryStock**: Current stock levels per item/location
- **InventoryTransaction**: Full audit trail of all stock movements
- **Customer**: Private or Company profiles with contact info
- **SalesOrder**: Customer orders (Job Cards)
- **Invoice**: Fiscal documents linked to sales orders
- **Vendor**: Suppliers with contact info and supported brands
- **PurchaseOrder**: Orders to vendors with status tracking

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
- **NestJS** - Node.js framework
- **Prisma** - ORM with PostgreSQL
- **TypeScript** - Type safety

### Frontend
- **React 19** - UI library
- **Vite 7** - Build tool
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

1. `firebase.googleapis.com` and `firebasehosting.googleapis.com` are enabled in **build project** (`auto-core-platform`).
2. Build service account has Firebase roles on **hosting project** (`auto-core-platform-vande`).
3. `firebase.json` contains the correct hosting site name.

---

## License

UNLICENSED - Private repository

```
