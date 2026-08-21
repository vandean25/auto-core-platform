# Runbook: Connection Pooling Strategy and Metrics

**Owner**: Engineering / SRE
**Tags**: Multi-Tenant, Capacity, Reliability
**Related Issues**: AUT-73, AUT-130

## Status (as of AUT-130)

Implemented in application code. Remaining work is operational: point Cloud Run `_DATABASE_POOLED_SECRET` at a real Neon `-pooler` / PgBouncer secret, then configure saturation alerts.

| Layer                                                   | URL                                                               | Status                                                                                                                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NestJS runtime (`PrismaService`, `SystemPrismaService`) | `DATABASE_URL_POOLED`, falling back to `DATABASE_URL`             | Implemented. Both clients share one `pg.Pool` (`max` 10).                                                                                                                                            |
| Prisma migrate / seed / `prisma.config.ts`              | `DATABASE_URL` (direct only)                                      | Unchanged. Cloud Build `migrate-db` still injects the direct secret.                                                                                                                                 |
| Cloud Run                                               | `DATABASE_URL` + `DATABASE_URL_POOLED`                            | Runtime wiring exists, but the safe Cloud Build default remains the direct UAT secret until the operator confirms `acp-core-api-database-url-pooled` exists and overrides `_DATABASE_POOLED_SECRET`. |
| Startup guard                                           | Hostname diagnostics and optional `DATABASE_POOLER_REQUIRED=true` | Implemented. Logs host/status fields without credentials; production warns on missing/non-pooler/equal hosts and only fails when the flag is enabled.                                                |
| Alerts                                                  | Connection saturation, queueing, slow queries                     | Not configured.                                                                                                                                                                                      |

## Goal

Prevent noisy-neighbor connection starvation under Cloud Run scale-outs by using a pooled database endpoint and connection saturation alerts.

## Strategy

1. Runtime traffic uses a pooled endpoint (PgBouncer/Neon pooler/Data Proxy).
2. Migration/admin tasks use a direct endpoint.
3. One Cloud Run instance opens a single shared `pg.Pool` for tenant and system Prisma clients.
4. Alert on saturation signals before customer impact.

## Environment Contract

Use separate secrets for direct and pooled URLs.

- `DATABASE_URL`: direct PostgreSQL endpoint (migrations, seed, admin)
- `DATABASE_URL_POOLED`: pooled endpoint (NestJS application runtime)

Do not put the pooled URL into `DATABASE_URL`. Prisma migrate cannot use a transaction-mode pooler.

Recommended pooled URL parameters (adjust per provider):

- Neon host should include `-pooler`
- provider-specific `pgbouncer=true` when required

The Node `pg.Pool` used at runtime is capped at 10 connections per instance (`--max-instances 5` → 50 client connections to the pooler).

## Rollout Procedure (Staging then Production)

1. Create/verify pooled endpoint in DB provider (Neon `-pooler` host).
2. Store the pooled URL in Secret Manager as `acp-core-api-database-url-pooled`.
3. Grant the Cloud Run runtime service account Secret Manager Secret Accessor on
   that secret.
4. Override Cloud Build `_DATABASE_POOLED_SECRET` with
   `acp-core-api-database-url-pooled`. Do not enable the override until the
   secret exists. Keep `_DATABASE_SECRET` on the direct endpoint for
   `migrate-db`.
5. Deploy backend. Runtime reads `DATABASE_URL_POOLED`; migrate still uses
   `DATABASE_URL`.
6. Run smoke checks:
   - login and authenticated API request
   - dashboard realtime connection
   - 5-minute load burst
7. Run SQL health checks from `tools/pooling/check-pool-settings.sql` against a
   pooled session and archive the output.
8. Confirm the structured startup event reports a `-pooler` host distinct from
   the direct host. On the next deploy, optionally override Cloud Build
   `_DATABASE_POOLER_REQUIRED=true` to make that check fail closed.
9. Promote the same setup to production.

## Monitoring and Alerts

Configure pager alerts for:

1. Connection saturation:

- trigger when active + idle DB sessions > 85% of `max_connections` for 5 minutes

2. Query queueing:

- trigger when waiting sessions (`wait_event` present) > 20 for 5 minutes

3. Slow active statements:

- trigger when active query runtime p95 > 15s for 10 minutes

4. Cloud Run scaling symptom:

- trigger when instance count spikes while throughput is flat (possible DB bottleneck)

### Alert definitions

These are alert-condition definitions, not completed Cloud Monitoring policies.
Neon connection metrics must be exported to Cloud Monitoring or Prometheus;
replace the illustrative metric names with the provider/exporter names before
wiring a pager.

1. Connection saturation — PromQL:

```promql
(
  neon_postgresql_connections_active
  + neon_postgresql_connections_idle
) / neon_postgresql_max_connections > 0.85
```

Set the alert duration to 5 minutes and group by database/branch.

2. Query queueing — PromQL:

```promql
sum by (database) (neon_postgresql_waiting_sessions) > 20
```

Set the alert duration to 5 minutes.

3. Slow active statements — PromQL:

```promql
histogram_quantile(
  0.95,
  sum by (le, database) (rate(neon_postgresql_active_query_duration_seconds_bucket[5m]))
) > 15
```

Set the alert duration to 10 minutes. If the exporter exposes only samples,
use an equivalent p95 recording rule.

4. Cloud Run scaling symptom — MQL starting point:

```mql
fetch cloud_run_revision
| metric 'run.googleapis.com/container/instance_count'
| group_by 5m, [instances: max(val())]
| every 1m
| condition instances > <baseline_instances>
```

Combine that condition with a flat request-rate condition from
`run.googleapis.com/request_count` (for example, less than 10% change over
the same 5-minute window). The operator must choose the baseline and wire the
combined condition in Cloud Monitoring.

## Verification Checklist

- [x] Application boot uses `DATABASE_URL_POOLED` when set
- [x] Prisma migrate/seed still use direct `DATABASE_URL`
- [x] One instance shares a single `pg.Pool` across Prisma clients
- [x] Startup logs whether the pooled host contains `-pooler` and equals the direct host
- [ ] Staging Cloud Run `_DATABASE_POOLED_SECRET` points at a real pooler secret
- [ ] Production Cloud Run `_DATABASE_POOLED_SECRET` points at a real pooler secret
- [ ] Alerts are configured and test-fired
- [ ] SQL check script output archived in deployment evidence

## Rollback

If pooling introduces instability:

1. Point `_DATABASE_POOLED_SECRET` (or `DATABASE_URL_POOLED`) back at the direct endpoint.
2. Redeploy backend.
3. Keep the pooled endpoint enabled for investigation.
4. Capture `check-pool-settings.sql` output and provider pool stats.
