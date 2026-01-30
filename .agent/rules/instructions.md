---
trigger: always_on
---

# AI Assistant Instructions for Auto Core Platform

## Project Overview
This is a full-stack automotive parts management platform:
- **Backend**: NestJS + Prisma + PostgreSQL (`apps/core-api`)
- **Frontend**: React 19 + Vite 7 + Tailwind CSS 4 (`apps/core-web`)

## Critical Rules

### TypeScript Configuration
- **ALWAYS use `import type` for type-only imports** (enforced by `verbatimModuleSyntax`)
  ```typescript
  // ✅ Correct
  import type { InventoryItem, InventoryResponse } from './types'
  import { useQuery } from '@tanstack/react-query'
  
  // ❌ Wrong - causes runtime errors
  import { InventoryItem, InventoryResponse } from './types'
  ```

### Tailwind CSS 4
- This project uses **Tailwind v4** with the `@tailwindcss/vite` plugin
- Colors are defined in `@theme` blocks in `src/index.css`, NOT in `tailwind.config.js`
- Use shadcn/ui utility classes like `bg-background`, `text-foreground`, `text-muted-foreground`

### shadcn/ui Components
- Components are located in `src/components/ui/`
- Import from `@/components/ui/<component-name>`
- Use the `cn()` utility from `@/lib/utils` for conditional classes

### Backend Patterns

#### Prisma
- Always run `npx prisma generate` after schema changes
- Seed data is in `prisma/seed.ts`
- Use `npx prisma migrate dev` for development migrations

#### NestJS
- Services go in feature modules (e.g., `src/inventory/inventory.service.ts`)
- Controllers handle HTTP routes only - business logic in services
- Use `PrismaService` for database operations

### Frontend Patterns

#### Data Fetching
- Use **TanStack Query** for all API calls
- Hooks go in `src/api/` (e.g., `useInventory`, `useInventoryHistory`)
- API types go in `src/api/types.ts`

#### Components
- Page components in `src/pages/`
- Reusable components in `src/components/`
- Use shadcn/ui primitives when possible

### API Conventions
- All API endpoints are prefixed with `/api`
- Vite proxies `/api` to `http://localhost:3000` in development
- Use pagination with `page` and `limit` query params
- Return `{ data, meta }` format for list endpoints

### Database Schema
- Tables use snake_case via `@@map()` directive
- IDs are UUIDs
- Use `createdAt` and `updatedAt` timestamps
- Supersession chains use self-referencing relations

## File Structure
```
apps/core-api/
├── prisma/schema.prisma  # Database schema
├── prisma/seed.ts        # Sample data
├── src/inventory/        # Inventory module
└── src/prisma/           # Prisma service

apps/core-web/
├── src/api/              # TanStack Query hooks + types
├── src/components/       # Reusable components
├── src/components/ui/    # shadcn/ui components
├── src/hooks/            # Custom React hooks
├── src/pages/            # Page components
└── src/index.css         # Tailwind theme config
```

## Common Commands
```bash
# Backend
cd apps/core-api
npm run start:dev          # Start with hot reload
npx prisma studio          # Database GUI
npx prisma migrate dev     # Apply migrations
npx prisma db seed         # Seed sample data

# Frontend
cd apps/core-web
npm run dev                # Start dev server (port 5173)
npm run build              # Production build
```

## Known Gotchas
1. **Blank page in browser?** Check Vite terminal for CSS errors
2. **Import errors?** Ensure type-only imports use `import type`
3. **Prisma errors?** Run `npx prisma generate` after pulling schema changes
4. **API 404?** Ensure backend is running on port 3000
