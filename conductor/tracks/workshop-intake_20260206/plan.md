# Implementation Plan: Workshop Intake Module

## Phase 1: Database & Backend (API)
- [ ] Task: Update Prisma schema in `apps/core-api/prisma/schema.prisma` with `WorkshopOrder` entity and status enum (`SCHEDULED`, `INTAKE`, `IN_PROGRESS`, `COMPLETED`).
- [ ] Task: Run `npx prisma migrate dev` to apply schema changes.
- [ ] Task: Generate a new NestJS module: `apps/core-api/src/workshop/workshop.module.ts`.
- [ ] Task: Implement `WorkshopService` with search logic for VIN, License Plate, and Customer Number.
- [ ] Task: Implement `WorkshopController` with POST `/api/workshop/orders` to create orders with validation for odometer, fuel, and notes.

## Phase 2: Frontend Foundation & API Integration
- [ ] Task: Define TypeScript types for `WorkshopOrder` and search results in `apps/core-web/src/api/types.ts`.
- [ ] Task: Create `apps/core-web/src/api/workshop.ts` with TanStack Query hooks for searching and creating orders.
- [ ] Task: Scaffold the Intake Dashboard page at `apps/core-web/src/pages/workshop/IntakeDashboard.tsx`.

## Phase 3: UI Components & Search Logic
- [ ] Task: Implement the search interface on the Intake Dashboard.
- [ ] Task: Build the "Vehicle/Customer Result" display card.
- [ ] Task: Implement the "Quick Register" dialog for new vehicles/customers using `shadcn/ui` components.

## Phase 4: Intake Completion Flow
- [ ] Task: Create the "Start Service" form modal to capture Odometer, Fuel Level, and Intake Notes.
- [ ] Task: Integrate the form with the backend API to create a `WorkshopOrder` in `INTAKE` status.
- [ ] Task: Add success notifications and redirection to the newly created order (or a confirmation state).
- [ ] Task: Verification - Run E2E tests for the full intake flow.
