# Runbook: PostgreSQL Tenant Partitioning Rollout

**Owner**: Backend + DBA
**Related Issues**: AUT-74, AUT-154

## Status (as of AUT-154) — not rolled out

**Production is not partitioned.** SQL under `tools/partitioning/` is a staging draft only. `inventory_transactions` and `invoice_items` remain ordinary tables. Do not treat partition attach/detach/`DROP PARTITION` as an offboarding or single-tenant restore path.

Single-tenant restore is separately **not productized**. See [single-tenant-restore-playbook.md](./single-tenant-restore-playbook.md) and the [deferral](../.architecture/deferrals.md#single-tenant-restore-tooling).

## Goal
Partition high-volume append-only tables by `tenant_id` to improve index locality and enable tenant offboarding by partition operations **after this rollout is executed and validated**.

Target tables:
- `inventory_transactions`
- `invoice_items`

## Prerequisites
- Maintenance window approved.
- Full backup/snapshot completed.
- Staging dry run completed with production-like data volume.

## Rollout Steps
1. Run partition migration script in staging:
   - `psql "$DATABASE_URL" -f tools/partitioning/partition-hot-tables.sql`
2. Validate row parity between live and `_legacy` tables.
3. Validate partition pruning:
   - `psql "$DATABASE_URL" -v tenant_id='<tenant-id>' -f tools/partitioning/verify-partition-pruning.sql`
4. Pre-create hot tenant partitions:
   - `psql "$DATABASE_URL" -v table_name='inventory_transactions' -v tenant_id='<tenant-id>' -f tools/partitioning/create-tenant-partition.sql`
   - `psql "$DATABASE_URL" -v table_name='invoice_items' -v tenant_id='<tenant-id>' -f tools/partitioning/create-tenant-partition.sql`
5. Deploy application and monitor write/read latency.
6. After rollback window closes, archive/drop `_legacy` tables.

## Tenant Onboarding Automation
For each new tenant, create explicit partitions on both tables using `create-tenant-partition.sql`.

Recommended automation trigger:
- Hook into tenant onboarding workflow after tenant row creation.
- Execute partition creation for both hot tables.

## Rollback
If issues occur:
1. Stop writes to affected flows.
2. Rename partitioned tables out of the way.
3. Rename `_legacy` tables back to original names.
4. Recreate any dropped indexes/constraints if altered post-cutover.
5. Re-run smoke tests and resume traffic.

## Validation Checklist
- [ ] Data parity checks passed
- [ ] Partition pruning verified via EXPLAIN
- [ ] No increase in write errors
- [ ] No unexpected lock contention
- [ ] Rollback rehearsal completed in staging
