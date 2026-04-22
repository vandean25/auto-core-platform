# Runbook: Connection Pooling Strategy and Metrics

**Owner**: Engineering / SRE
**Tags**: Multi-Tenant, Capacity, Reliability
**Related Issues**: AUT-73

## Goal
Prevent noisy-neighbor connection starvation under Cloud Run scale-outs by using a pooled database endpoint and connection saturation alerts.

## Strategy
1. Runtime traffic uses a pooled endpoint (PgBouncer/Neon pooler/Data Proxy).
2. Migration/admin tasks use a direct endpoint.
3. Alert on saturation signals before customer impact.

## Environment Contract
Use separate secrets for direct and pooled URLs.

- `DATABASE_URL`: direct PostgreSQL endpoint (migrations, admin)
- `DATABASE_URL_POOLED`: pooled endpoint (application runtime)

For backend runtime (`apps/core-api/.env`):
- set `DATABASE_URL` to the pooled endpoint
- keep `DATABASE_URL_DIRECT` (optional) for scripts requiring direct access

Recommended pooled URL parameters (adjust per provider):
- `connection_limit=20`
- `pool_timeout=20`
- provider-specific `pgbouncer=true` when required

## Rollout Procedure (Staging then Production)
1. Create/verify pooled endpoint in DB provider.
2. Store pooled URL in Secret Manager (`DATABASE_URL_POOLED`).
3. Deploy backend with pooled URL as runtime `DATABASE_URL`.
4. Run smoke checks:
   - login and authenticated API request
   - dashboard realtime connection
   - 5-minute load burst
5. Run SQL health checks from `tools/pooling/check-pool-settings.sql`.
6. Promote same setup to production.

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
- [ ] Staging runtime uses pooled `DATABASE_URL`
- [ ] Production runtime uses pooled `DATABASE_URL`
- [ ] Migrations still use direct endpoint successfully
- [ ] Alerts are configured and test-fired
- [ ] SQL check script output archived in deployment evidence

## Rollback
If pooling introduces instability:
1. Switch runtime secret back to direct endpoint.
2. Redeploy backend.
3. Keep pooled endpoint enabled for investigation.
4. Capture `check-pool-settings.sql` output and provider pool stats.
