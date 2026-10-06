# AUT-404 Pending Actions Design

## Goal

Let an agent continue after a policy-approved `PROPOSE` request by returning a simulated result and a pending identifier. Persist no business change until an authorized human applies the pending action, individually or as part of a batch.

## Context and constraints

- AUT-393 remains the policy authority; evaluate the effective policy both when submitting and immediately before applying.
- AUT-396 supplies rollback-transaction simulation, change summaries, and side-effect protection.
- AUT-401 already supplies a tenant-scoped `AgentProposal` queue, supervisor authorization, lifecycle state, and compare-and-set claiming around execution. This feature extends that queue instead of creating a parallel pending-action table.
- AUT-394 supplies trace-correlated action logging.
- The MCP `PROPOSE` path currently simulates and logs a proposal but does not persist it in the supervision queue.
- Keep Paperclip and Cloudflare OS as design patterns only. Add no dependency and copy no code.
- Use only fabricated examples. Any reference to the pilot organization must use the exact phrase `pilot customer`.
- Preserve tenant isolation and supervisor RBAC. OWNER, ADMIN, and ADVISOR may apply; SALES and TECH may not.
- `HUMAN_ONLY` is never eligible for pending apply. Simulation must not send email/SMS or write to GCS.

## Chosen queue and lifecycle

Reuse `AgentProposal`. Store the dry-run output (`would_change` and simulated response) in `preview_json`; retain the exact action input in `payload_json`. Store `action_type` as the stable policy action key so the same key can resolve both the current policy and its executor. The current proposal `EXECUTED` status represents a successfully applied pending action. Existing `PENDING`, `REJECTED`, `EXPIRED`, and failure states remain the queue lifecycle. Keep the current `decided_by`, `decided_at`, `reason`, `trace_id`, and `expires_at` fields for human decision metadata and expiration. Add only the minimum optional provenance field needed to retain the creating MCP agent on the queue row; action log data remains the authoritative actor/trace audit. Use an expand-only migration after the current main migration set.

Introduce a shared typed pending-action executor registry keyed by policy action type. Each entry resolves the policy context builder and business operation for one supported write. The MCP simulation, REST submission, and human apply paths must use the same registered operation so that simulation and apply cannot drift. Register `workshop_order.create`, `workshop_task.reserve_part`, `workshop_task.release_reservation`, and `workshop_order.propose_line` for the four current MCP write tools (`draft_workshop_order`, `reserve_part`, `release_reservation`, and `propose_line_item`), and retain the existing `workshop_order.add_line` compatibility operation. The registry rejects unknown action types; it does not accept arbitrary execution code or client-supplied policy context.

The existing queue list makes MCP-submitted actions visible in the Approvals tab. No second queue or broad AUT-401 UI rewrite is part of this design. The batch endpoint is included; multi-select UI is a follow-up unless implementation discovery shows it is a small, isolated change.

## Submit, simulate, continue, and apply flow

```mermaid
sequenceDiagram
    participant A as Agent / REST caller
    participant P as Deterministic policy
    participant D as dry_run
    participant Q as AgentProposal queue
    participant H as Authorized supervisor
    participant X as Action executor
    participant L as Agent action log

    A->>P: Submit action and context
    P-->>A: Refuse when disabled or HUMAN_ONLY
    P->>D: Simulate eligible PROPOSE action
    D-->>P: Preview and would_change (rollback; guarded side effects)
    P->>Q: Persist PENDING with payload, preview, tier, trace
    Q-->>A: needs_approval + pending_action_id + simulation
    Note over A: Agent continues planning; it must not claim the write completed.
    H->>P: Apply one ID or batch IDs
    P->>P: Re-evaluate current policy for each ID
    P->>Q: Tenant-scoped CAS claim from PENDING
    Q->>X: Execute once inside the per-ID transaction
    X->>L: Record approver, action, result, and trace
    X-->>H: Applied result
    Note over H,Q: Batch reports each ID independently; a failed ID does not roll back other IDs.
```

## API and behavior

- Provide a REST submit route for a simulated pending proposal, and use the same queue creation path from the MCP write pipeline. Both resolve the action through the shared typed executor registry, evaluate its policy action with server-built context, and simulate that registered operation before storing `PENDING`.
- The submit response includes the pending ID and simulation. `HUMAN_ONLY` and disabled policy return the existing refusal behavior and do not create an applyable queue row.
- Add `POST /agent-proposals/:id/apply` and `POST /agent-proposals/batch-apply` with an `ids` array. Require supervisor access at the controller and service boundary, and scope every lookup/update to the active tenant.
- Applying an ID resolves the stored action through the shared registry and re-evaluates its current policy with current tenant/site context. If policy now resolves to `HUMAN_ONLY` or a stricter non-applyable condition, leave the proposal unexecuted and return a clear refusal.
- Claim each pending row with the existing `PENDING` compare-and-set pattern before dispatch. The action and terminal state transition are atomic for that ID. Concurrent requests can execute the action only once; a losing request receives a conflict/current-state result.
- Batch apply invokes the same single-ID operation independently for each requested ID and returns per-ID applied/failed outcomes. One invalid, expired, unauthorized-by-policy, or concurrently claimed ID does not prevent other valid IDs from succeeding.
- Record apply with the human approver and the proposal trace ID (or a linked trace where request context requires it). Preserve MCP agent provenance from submission in the queue/audit correlation.
- Continue to expose proposals through the existing list endpoint and OpenAPI contract. Regenerate backend OpenAPI and frontend generated types for all API changes.

## MCP agent contract

For a `PROPOSE` write, resolve the action through the shared registry, persist the simulated action and return a typed response with status `needs_approval`, `pending_action_id`, `would_change`, and the simulation summary. The agent must say the change is pending and must not claim business state changed. `AUTO` retains its existing execute path. Add at most a one-line cross-link in MCP agent instructions; do not expand the AUT-403 instruction work.

## Supervision UI

The Approvals tab continues to use the existing proposal list and single-item actions. Implement the backend batch endpoint and contract in this change. Defer multi-select UI to a follow-up note unless it proves to be a small extension that does not restructure the AUT-401 screen.

## Validation

- Unit tests cover submit simulation without business persistence, policy refusal, apply-time policy changes, CAS concurrency, action logging, and per-ID batch partial failure.
- E2E tests cover tenant isolation and OWNER/ADMIN/ADVISOR versus SALES/TECH authorization for the apply operations, plus persisted MCP proposals appearing in the existing queue.
- Verify the dry-run side-effect guard prevents outbound email/SMS/GCS during simulation.
- Regenerate/check OpenAPI and frontend generated types; run repository CI, tenant Prisma lint, focused API e2e specs, and diff scan for prohibited customer-name content.

## Scope exclusions

No second queue/table, full Approvals UI rewrite, external governance dependency, push/email notifications, customer-facing approval flow, or agent behavior changes outside the typed pending response and one-line instruction cross-link.
