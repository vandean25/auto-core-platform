# Operational Logging and Runtime Log Level Runbook

This runbook guides operators, platform administrators, and engineers on managing operational logging and dynamic log levels in Auto Core Platform.

---

## 1. Architectural Principles: Logging vs. Audit Tracing

Auto Core Platform maintains two strictly separated logging architectures (governed by ADR-0015):

| System | Storage | Audience | Purpose | Immutability / Retention |
|---|---|---|---|---|
| **Audit Tracing** | PostgreSQL `AuditLog` Table | Compliance, Accountants, Support, Users | Immutable business mutation history (before/after snapshots, actor, diff) | Append-only; zero ordinary API deletion; strictly tenant-isolated |
| **Operational Logging** | Stdout / NestJS Logger / Cloud Logging | Engineers, Operators, DevOps | Latency tracking, error diagnostics, WebSocket lifecycle, API telemetry | Ephemeral; retention managed by log sink (e.g. Cloud Logging) |

> [!IMPORTANT]
> **Strict Non-Interference:** Changing the operational log level (`LOG_LEVEL` or dynamic runtime overrides) **never** changes or disables database-level `AuditLog` capture. Audit tracing is always active for audited business operations.

---

## 2. Boot-Time Configuration

The boot-time operational log level is configured via the `LOG_LEVEL` environment variable:

```bash
LOG_LEVEL=log # Default: error | warn | log | debug | verbose
```

### Supported Levels

1. **`error`**: Unhandled errors, 500 server crashes, database connection failures.
2. **`warn`**: Recoverable issues, client 4xx errors, degraded states.
3. **`log`**: Standard operational events, HTTP request completion telemetry, server boot.
4. **`debug`**: In-depth operational diagnostics, WebSocket connection lifecycle events.
5. **`verbose`**: High-volume trace data.

### Production Safe Default

If `LOG_LEVEL` is undefined, empty, or invalid, the platform defaults safely to **`log`**. Production instances will **never** default to `debug` or `verbose`.

---

## 3. Dynamic Runtime Log Level Overrides

During incidents or active debugging sessions, platform administrators can raise or lower log verbosity dynamically without restarting application containers.

### Endpoints

#### 1. Inspect Current Log Level

```http
GET /api/admin/settings/log-level
Authorization: Bearer <SUPER_ADMIN_JWT>
```

**Response (200 OK):**
```json
{
  "currentLevel": "log",
  "defaultLevel": "log"
}
```

When an active override is in effect:
```json
{
  "currentLevel": "debug",
  "defaultLevel": "log",
  "override": {
    "level": "debug",
    "expiresAt": "2026-08-14T18:30:00.000Z",
    "updatedBy": "platform-admin-user-id",
    "updatedAt": "2026-08-14T18:00:00.000Z"
  }
}
```

#### 2. Apply Dynamic Override

```http
PATCH /api/admin/settings/log-level
Authorization: Bearer <SUPER_ADMIN_JWT>
Content-Type: application/json

{
  "level": "debug",
  "durationMinutes": 30
}
```

**Response (200 OK):** Returns the updated `LogLevelResponseDto`.

---

## 4. Governance & Safety Rules

1. **Platform Admin Authorization:**
   - Both `GET` and `PATCH` endpoints are protected with `@AllowPlatformAdmin()` and `SuperAdminGuard`.
   - Access requires `user.platformRole === 'SUPER_ADMIN'`. Tenant administrators cannot modify platform log levels.

2. **Mandatory Expiration for Verbose Modes:**
   - Overriding to `debug` or `verbose` requires an expiration TTL (default: 30 minutes, maximum: 1440 minutes / 24 hours).
   - Once `expiresAt` is reached, `LogLevelService` automatically clears the override and reverts to `defaultLevel`.

3. **Telemetry & Audit:**
   - Every change to the runtime log level emits a structured telemetry log (`type: 'log_level_changed'`) recording the previous level, new level, expiration timestamp, and actor ID.

4. **Zero Body / Secret Leakage:**
   - Request and response bodies are strictly excluded from standard request logs.
   - Passwords, authorization tokens, API keys, and session cookies are never logged.

---

## 5. Structured Log Formats

All operational logs are emitted as structured JSON objects for indexing in platform sinks (GCP Cloud Logging / Datadog / Elasticsearch):

### HTTP Request Completion
```json
{
  "type": "http_request",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "POST",
  "path": "/api/customers",
  "statusCode": 201,
  "durationMs": 42,
  "tenantId": "tenant-uuid",
  "actorId": "user-uuid",
  "ip": "192.168.1.1"
}
```

### HTTP Error Diagnostics
```json
{
  "type": "http_error",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "statusCode": 404,
  "errorName": "NotFoundException",
  "message": "Customer not found",
  "tenantId": "tenant-uuid",
  "actorId": "user-uuid"
}
```

### WebSocket Lifecycle Diagnostics
```json
{
  "type": "ws_connect",
  "socketId": "sock-xyz",
  "tenantId": "tenant-uuid",
  "userId": "user-uuid"
}
```
