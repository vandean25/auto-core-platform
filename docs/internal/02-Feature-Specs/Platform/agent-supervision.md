# Agent Supervision (AUT-401)

## Summary

The Agent Supervision feature (AE6) provides a human-in-the-loop review queue for proposed agent actions (`AgentProposal`) and an interactive activity log viewer (`AgentActionLog`). It gives workshop supervisors and advisors full oversight over autonomous and proposed operations, ensuring no high-risk or human-only action executes without manual authorization.

## Architecture & Workflows

```
  ┌────────────────┐
  │ Autonomous     │
  │ Agent (LLM)    │
  └───────┬────────┘
          │ Proposes action (tier: PROPOSE)
          ▼
  ┌──────────────────────────────────────────────┐
  │ AgentProposal (status: PENDING)              │
  │ - Payload JSON, optional Preview JSON        │
  │ - 7-day expiration (TTL)                     │
  └───────┬──────────────────────────────────────┘
          │
          │ Supervisor reviews on /agent/supervision
          ▼
   [ Approve / Reject ]
          │
          ├── Reject ──► Status: REJECTED (audit logged, no payload executed)
          │
          └── Approve ─► 1. Check expiration (fails if expired)
                         2. Re-evaluate policy (AgentPolicyService.evaluate)
                            - Refuse if tier became HUMAN_ONLY or limits exceeded
                         3. Atomic CAS lock (status: PENDING -> APPROVED)
                            - Idempotent: concurrent approve executes once
                         4. Record AE2 log with trace ID & approver user ID
                         5. Execute stored payload
                         6. Mark EXECUTED (or FAILED on error)
```

## Data Model (`agent_proposals`)

- **Table**: `agent_proposals`
- **Scoping**: Row-level tenancy with `tenant_id` and composite primary key / foreign key references.
- **Fields**:
  - `id`: UUID primary key.
  - `tenant_id`: UUID tenant reference.
  - `trace_id`: UUID correlation trace identifier (shared with AE2 and ADR-0015 audit logs).
  - `action_type`: String action identifier (e.g. `sales_order.apply_discount`, `workshop_order.add_line`).
  - `tier`: `AgentPolicyTier` enum (`AUTO`, `PROPOSE`, `HUMAN_ONLY`).
  - `status`: `AgentProposalStatus` enum (`PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `EXECUTED`, `FAILED`).
  - `payload_json`: Stored action arguments and context.
  - `preview_json`: Optional dry-run diff preview (AE3 integration).
  - `decided_by`: User ID of approving/rejecting supervisor. Responses also carry `decided_by_name` (first and last name) and `decided_by_email`, resolved from the user record for tenant members only. The UI shows the name, then the email, and keeps the raw ID under "Show details".
  - `decided_at`: Timestamp of decision.
  - `reason`: Optional rejection reason.
  - `expires_at`: Expiration timestamp (default: 7 days from creation).

## API Endpoints (`/api/agent-proposals`)

Authorization: Accessible to `OWNER`, `ADMIN`, and `ADVISOR`. Forbidden for `SALES` and `TECH` (`403 Forbidden`).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/agent-proposals` | Lists proposals for tenant. Supports `status` and `limit` query parameters. |
| `POST` | `/api/agent-proposals/:id/approve` | Re-evaluates policy rules, executes payload with atomic CAS idempotency lock, records approver and trace ID. |
| `POST` | `/api/agent-proposals/:id/reject` | Marks proposal `REJECTED` with optional reason and audit logs the rejection. Executes no payload. |
| `POST` | `/api/agent-proposals` | Creates proposal (for agent workers and test seeding). |

## Safety Invariants

1. **Policy Re-Evaluation at Approval Time**:
   - A proposal created when a policy was lenient may not execute if the policy was tightened before approval.
   - Approval re-runs `AgentPolicyService.evaluate(...)` against current tenant and platform rules.
   - If the action evaluates to `HUMAN_ONLY` or monetary limits are exceeded, approval throws `400 Bad Request` and refuses execution.
2. **Atomic Idempotency Guard (Double-Approve Protection)**:
   - Uses Prisma atomic `updateMany({ where: { id, tenant_id, status: 'PENDING' } })`.
   - If two supervisors click Approve concurrently, exactly one succeeds in claiming the proposal. The loser receives the already approved proposal without re-dispatching the payload.
3. **Audit Trail & Trace Propagation**:
   - Logs decision maker and trace ID into `AgentActionLog` with actor type `USER` and `onBehalfOfUserId`.
   - Sub-operations link their ADR-0015 audit log entries via `request_id = trace_id`.

## Supervision Screen UI (`/agent/supervision`)

Accessible in `apps/core-web` under route `/agent/supervision`, gated by runtime flag `VITE_FEATURE_AGENT_SUPERVISION`.

### Key UI Features:
- **Persistent Safety Banner**: Prominently warns that agent supervision is active and that `HUMAN_ONLY` operations must be conducted manually.
- **Approvals Tab**:
  - Displays pending proposal cards with formatted actions, agent names, creation times, target entity references, and EUR currency amounts. The agent name is the one the agent registered (for example `mcp:<client>`), the same name the matching Activity row shows. It falls back to the agent ID in the payload, then to the generic word `agent`.
  - Decided proposals (visible under "Show all statuses") show `Decided by` with the person's name or email.
  - Expandable JSON details panel for dry-run preview diffs and payload arguments.
  - **Critical Safety Guard**: Actions with tier `HUMAN_ONLY` do not render an Approve button; instead, they render a prominent "Do this manually" notice.
  - Reject opens a modal dialog allowing an optional rejection reason.
  - A successful Approve shows the toast "Proposal approved"; a successful reject shows "Proposal rejected". A failed Approve or reject shows the error toast only.
- **Activity Tab**:
  - Displays historic agent actions from `GET /api/agent-actions`.
  - Filterable by status (`ALL`, `EXECUTED`, `FAILED`), tier (`ALL`, `AUTO`, `PROPOSE`, `HUMAN_ONLY`), and agent search.
  - `Decided by` column shows the person's name, then their email, and the raw user ID under "Show details". The API returns `onBehalfOfUserName` and `onBehalfOfUserEmail` on each log row (tenant members only).
  - Trace ID is a real interactive button opening `TraceAuditDetailDialog`.
- **Trace Audit & Correlation Dialog**:
  - Shows all action steps in the trace.
  - Displays correlated ADR-0015 system audit log records (entity mutations, timestamps, actors).
- **Accessibility & Compliance**:
  - Interactive rows and actions use real `<button>` or `<a>` elements.
  - Meets WCAG 2 AA minimum contrast ratios (e.g. amber-800 on white, emerald-700 on white).
  - Verified clean axe accessibility scan (`expectNoCriticalA11yViolations`).
- **Bilingual DE/EN Support**:
  - Language toggle switches all banner copy, table headers, status badges, buttons, and dialogs between German and English.

## Confidentiality Note

In accordance with project confidentiality guidelines, the pilot customer's real name is never committed in code, tests, documentation, or commit messages. All references use "pilot customer".
