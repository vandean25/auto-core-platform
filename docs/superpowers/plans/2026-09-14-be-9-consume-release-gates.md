# BE-9 Consume, Release, DONE Gates, STOCK_PREP Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement reservation consume/release semantics, task and invoice gates, deletion safeguards, and immutable STOCK_PREP cost valuation.

**Architecture:** Keep all mutations inside Prisma transactions and preserve the global lock order tasks → lines → reservations → PO headers/items → stock. Reuse `LedgerService` for every inventory movement and derive active demand from status plus remaining/staged quantities.

**Tech Stack:** NestJS, Prisma 7, PostgreSQL, TypeScript, Jest.

**Spec:** Linear AUT-246 / BE-9 issue description.

## Global Constraints

- Every tenant-scoped query includes `tenant_id`.
- Inventory stock changes are ledger-backed; never directly mutate stock for movement semantics.
- Consume/release and task line mutations lock task rows before line and reservation rows.
- Do not reverse `WORKSHOP_CONSUMPTION`.
- Regenerate OpenAPI and frontend API types when controller contracts change.

---

### Task 1: Add failing pure-rule tests

**Files:**
- Modify: `apps/core-api/src/parts-requisition/parts-requisition.helpers.spec.ts`
- Modify: `apps/core-api/src/workshop/workshop-pick-allocation.helpers.spec.ts`
- Modify: `apps/core-api/src/mechanic/mechanic-task-transitions.spec.ts`

- [ ] Add tests for active-slice status precedence, FIFO staged consumption, release validation, and DONE blocking.
- [ ] Run targeted tests and confirm they fail for missing behavior.

### Task 2: Implement reservation consume/release API

**Files:**
- Modify: `apps/core-api/src/parts-requisition/parts-requisition.controller.ts`
- Modify: `apps/core-api/src/parts-requisition/parts-requisition.service.ts`
- Create: `apps/core-api/src/parts-requisition/dto/consume-parts-reservation.dto.ts`
- Create: `apps/core-api/src/parts-requisition/dto/release-parts-reservation.dto.ts`
- Modify: `apps/core-api/src/parts-requisition/parts-requisition.module.ts`

- [ ] Add consume and release endpoints with DTO validation.
- [ ] Lock task, line, reservation, PO records, and stock in global order.
- [ ] Consume staged quantities FIFO, record negative WORKSHOP_CONSUMPTION with copied cost basis, update statuses, and increment line version.
- [ ] Release staged quantity through paired transfers only, release ON_HAND ATP, detach linked PO reservations, and cancel the reservation.
- [ ] Add targeted service tests and run them through red-green-refactor.

### Task 3: Enforce task and invoice gates

**Files:**
- Modify: `apps/core-api/src/mechanic/mechanic-task-transitions.ts`
- Modify: `apps/core-api/src/mechanic/mechanic-execution.service.ts`
- Modify: `apps/core-api/src/workshop/workshop-task.service.ts`
- Modify: `apps/core-api/src/workshop/workshop-invoice.service.ts`
- Modify: `apps/core-api/src/invoices/invoices.service.ts` if invoice paths bypass workshop service

- [ ] Lock the task before completion and reject PENDING_PICK/STAGED, active slices, or staged quantities.
- [ ] Apply the same predicate to invoice creation.
- [ ] Ensure fully consumed slices become FULFILLED and no longer block completion.
- [ ] Ensure leftover release derives line quantity/status from consumed demand and rejects quantity below consumed.

### Task 4: Replace STOCK_PREP pricing

**Files:**
- Modify: `apps/core-api/src/vehicle-stock/vehicle-ledger.service.ts`
- Modify: `apps/core-api/src/vehicle-stock/vehicle-ledger.service.spec.ts` or create it

- [ ] Sum WORKSHOP_CONSUMPTION absolute quantities multiplied by transaction cost basis.
- [ ] Sum non-cancelled labor using actual hours or quantity and internal cost rate.
- [ ] Reject the transaction before posting when any required cost basis/rate is null.
- [ ] Verify catalog cost changes do not affect posted workshop cost.

### Task 5: Contract and full verification

**Files:**
- Generated: `apps/core-api/openapi/openapi.json`
- Generated: `apps/core-web/src/api/generated/openapi.ts`

- [ ] Regenerate contracts if routes/DTOs changed.
- [ ] Run Prisma generate, tenant lint, backend lint, build, unit tests, migration deploy, and serial e2e tests.
- [ ] Commit and push each logical revision, create/update the draft PR, subscribe to CI and PR activity, and capture minimal walkthrough evidence.
