# Dry Run Support (AUT-396)

## Overview

Dry-run execution (`dry_run=true`) allows human users and autonomous agents to preview the exact would-be outcome of a state-changing API request without persisting changes or triggering outbound side effects.

This enables agents to validate inputs, preview affected entities, verify business rule constraints, and propose actions safely before final commitment.

## Convention & Protocol

- **Inbound trigger**: Query parameter `?dry_run=true` (or request header `X-Dry-Run: true`).
- **Response header**: `X-Dry-Run: true` is returned on all dry-run responses.
- **Response payload**: The response contains the standard entity payload augmented with the preview block:
  ```json
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "name": "...",
    "dry_run": true,
    "would_change": [
      {
        "entity": "Customer",
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "op": "create"
      }
    ]
  }
  ```
- **Error responses**: Validation errors (`400 BadRequestException`), conflicts (`409 ConflictException`), and authorization failures (`401`/`403`) return their standard HTTP statuses and error payloads without alteration.

## Architecture

### 1. Transactional Rollback
- Supported requests are executed within an interactive Prisma transaction via `DryRunService.executeInRollbackTransaction(...)`.
- `PrismaService` transparently proxies database queries to the active transaction client via `DryRunStorage` (`AsyncLocalStorage`).
- Nested transaction calls (such as in workshop order creation or task line item replacement) pass through the active transaction client.
- Upon completion of the handler, a sentinel `DryRunRollbackException` is thrown, forcing PostgreSQL to issue a `ROLLBACK`.
- Nothing is persisted to the database.

### 2. Side-Effect Guard (`SideEffectGuard`)
During a dry-run execution, outbound side effects are blocked rather than silently skipped. Attempting any of the following ports throws `DryRunSideEffectBlockedException` (`[DryRun] Side effect '<type>' is blocked during dry run execution.`):
- Queue / Outbox enqueues (`QUEUE_ENQUEUE`, e.g. Cloud Tasks)
- Email delivery (`EMAIL`)
- SMS delivery (`SMS`)
- Outbound notifications (`NOTIFICATION`, e.g. WebSocket updates via `DashboardRealtimeService`)
- File writes (`FILE_WRITE`)
- Cloud storage writes (`GCS_WRITE`)
- External HTTP requests (`EXTERNAL_HTTP`)
- Persisted audit rows (`PERSISTED_AUDIT`, audit writes are captured into `would_change` preview only)

### 3. Change Collection (`DryRunChangeCollector`)
Prisma extension hooks intercept mutations (`create`, `update`, `delete`, `updateMany`, `deleteMany`, `upsert`) during the transaction:
- Each mutation is recorded as `{ entity, id, op }`.
- Duplicate mutations on the same `(entity, id, op)` within a transaction are deduplicated while preserving insertion order.

## Supported Endpoints

Dry run is supported on 4 core state-changing endpoints:

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/customers` | Customer creation preview |
| `POST` | `/api/vehicles` | Vehicle creation preview |
| `POST` | `/api/workshop/orders` | Workshop order creation preview (numbering sequence rolled back) |
| `PATCH` | `/api/workshop/orders/:orderId/tasks/:taskId/line-items` | Workshop task line items replacement (requires `expectedLineItemsVersion`) |

## Explicitly Refused Endpoints (`DRY_RUN_NOT_SUPPORTED`)

Endpoints that consume irreversible fiscal numbering sequences or produce immutable financial export artifacts reject dry-run requests with HTTP `400 Bad Request` and error code `DRY_RUN_NOT_SUPPORTED`:

| Method | Path | Refusal Rationale |
|---|---|---|
| `PUT` | `/api/sales/invoices/:id/finalize` | Invoice finalization consumes sequential tax numbering and locks fiscal documents |
| `PATCH` | `/api/invoices/:id/issue` | Invoice issue consumes sequential tax numbering |
| `POST` | `/api/credit-notes/:id/finalize` | Credit note finalization consumes legal tax numbering sequences |
| `POST` | `/api/finance/accounting-exports` | DATEV accounting export produces immutable exported bundles |
| `*` | Any unannotated endpoint | Fail-closed: endpoints without explicit `@DryRunSupported()` reject dry-run |

## Security, Tenancy & RBAC

- **Authentication**: Unauthenticated dry-run requests are rejected with `401 Unauthorized`.
- **RBAC**: Dry-run requests require the exact same role and permission levels as live calls (e.g. `403 Forbidden` for unauthorized members).
- **Tenant Isolation**: Row-level tenancy filters (`tenant_id`) and site scopes remain strictly enforced during dry run. Cross-tenant references are rejected identically to live calls.
- **Pilot Customer Confidentiality**: Zero pilot customer PII is exposed or logged.
