# Runbook: Connection Pooling Strategy and Metrics

**Owner**: Engineering / SRE
**Tags**: Multi-Tenant, Capacity, Reliability
**Related Issues**: AUT-73, AUT-130

## Status (as of AUT-130)

Implemented in application code. Remaining work is operational: point Cloud Run `_DATABASE_POOLED_SECRET` at a real Neon `-pooler` / PgBouncer secret, then configure saturation alerts.

| Layer | URL | Status |
| --- | --- | --- |
| NestJS runtime (`PrismaService`, `SystemPrismaService`) | `DATABASE_URL_POOLED`, falling back to `DATABASE_URL` | Implemented. Both clients share one `pg.Pool` (`max` 10). |
| Prisma migrate / seed / `prisma.config.ts` | `DATABASE_URL` (direct only) | Unchanged. Cloud Build `migrate-db` still injects the direct secret. |
| Cloud Run | `DATABASE_URL` + `DATABASE_URL_POOLED` | Wired in `cloudbuild.yaml`. `_DATABASE_POOLED_SECRET` currently defaults to the same secret as `_DATABASE_SECRET` until a dedicated pooler secret is created. |
| Alerts | Connection saturation, queueing, slow queries | Not configured. |

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
2. Store pooled URL in Secret Manager (`DATABASE_URL_POOLED` / `acp-core-api-database-url-pooled`).
3. Point Cloud Build `_DATABASE_POOLED_SECRET` at that secret. Keep `_DATABASE_SECRET` on the direct endpoint for `migrate-db`.
4. Deploy backend. Runtime reads `DATABASE_URL_POOLED`; migrate still uses `DATABASE_URL`.
5. Run smoke checks:
   - login and authenticated API request
   - dashboard realtime connection
   - 5-minute load burst
6. Run SQL health checks from `tools/pooling/check-pool-settings.sql`.
7. Promote same setup to production.

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

## Verification Checklist
- [x] Application boot uses `DATABASE_URL_POOLED` when set
- [x] Prisma migrate/seed still use direct `DATABASE_URL`
- [x] One instance shares a single `pg.Pool` across Prisma clients
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
