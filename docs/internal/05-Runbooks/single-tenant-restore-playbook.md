# Runbook: Single-Tenant Restore (PITR Clone + Selective Upsert)

**Owner**: Engineering / SRE
**Severity**: Critical (when productized)
**Related Issues**: AUT-72, AUT-154
**Related ADR**: [ADR-0013 (Row-Level Multi-Tenancy)](../01-ADR/2026-04-15-row-level-multi-tenancy.md)

## Status (as of AUT-154) — not productized

**Do not run this playbook against production.** Draft scripts exist under `tools/tenant-restore/` but they have never been drilled, they do not cover the current schema, and they are not a supported restore path.

| Claim in older drafts | Reality |
| --- | --- |
| Scripts are ready to extract one tenant from a PITR clone | Draft only. No recorded dry-run on Neon or staging. |
| Clone via `gcloud sql instances clone` | Production database is **Neon**, not Cloud SQL. Neon branching / PITR is the clone mechanism. |
| PostgreSQL list-partitioning lets us drop/restore a tenant partition | **Not rolled out.** `tools/partitioning/` is unused in production. See [postgres-tenant-partitioning-rollout.md](./postgres-tenant-partitioning-rollout.md). |

**Deferral**: [Single-tenant restore tooling](../.architecture/deferrals.md#single-tenant-restore-tooling) — productize when a measurable trigger fires (tenant count or data size), not because the draft files exist.

**Supported DR today**: restore the **entire** Neon branch / project to a point in time. That is all-or-nothing across tenants. With a single production tenant this is acceptable. With two or more live tenants it overwrites unaffected workshops.

Until the deferral triggers, a tenant-specific incident is a DBA-reviewed manual extraction, not an automated runbook.

---

## Why This Exists (when productized)

In a shared-schema multi-tenant database, restoring a full database backup would overwrite data for unaffected tenants. The intended design restores only one tenant by extracting tenant-scoped data from a point-in-time clone.

The systems-architect review of ADR-0013 called this gap **critical**. AUT-154 records the explicit choice to defer productization rather than ship untested restore tooling.

## Required Artifacts (draft — not production-ready)

- `tools/tenant-restore/apply-tenant-rls.sql`
- `tools/tenant-restore/export-tenant-data.sh`
- `tools/tenant-restore/purge-tenant-data.sql`
- `tools/tenant-restore/restore-tenant-data.sh`

### Known gaps in the draft (must be fixed before any drill)

1. **`purge-tenant-data.sql` is a stale hardcoded list.** It omits current tenant-scoped tables including `tenant_members`, `employees`, `bays`, `audit_logs`, `vehicle_purchases`, `vehicle_sales`, `vehicle_ledger_entries`, `inspection_templates`, `workshop_inspections`, `workshop_media`, `labor_entries`, and others. A production purge would leave orphan rows or fail on foreign keys.
2. **Table-owner RLS bypass.** `apply-tenant-rls.sql` enables RLS but does not `FORCE ROW LEVEL SECURITY`. `pg_dump` as the table owner (typical Neon / `postgres` role) ignores the policies and dumps **every tenant**.
3. **Export is not table-filtered.** `export-tenant-data.sh` dumps the whole database data-only. Global tables (`users`, `master_parts`, `tenants`, …) and other tenants' rows can land in the dump.
4. **No Neon clone procedure.** The previous Cloud SQL clone command does not apply to this platform.
5. **No recorded dry-run.** Staging validation below has never been executed.

Do not "fix forward" by running these scripts as-is. When the deferral triggers, replace the hardcoded purge list with schema-driven FK order and prove the flow on a throwaway Neon branch.

## Inputs (when productized)

- `TARGET_TENANT_ID`
- `INCIDENT_TIMESTAMP_UTC` (corruption/deletion moment)
- `CLONE_DATABASE_URL` (Neon PITR / timestamp branch)
- `PRIMARY_DATABASE_URL` (production, direct endpoint — not the pooler)
- `TENANT_DUMP_FILE` (output SQL file path)

## Intended procedure (do not execute in production)

The steps below are the **design** to implement when the [deferral](../.architecture/deferrals.md#single-tenant-restore-tooling) triggers. They are not an authorized production checklist.

### Phase 1: Create Neon timestamp branch

Create a branch from a safe timestamp just before the incident (Neon console, `neonctl`, or Platform API). Use the direct (non-pooler) connection string. Validate schema parity with primary.

Do **not** use `gcloud sql instances clone`. This platform's database is Neon.

### Phase 2: Apply Tenant RLS on Clone

Only after the draft scripts are replaced with schema-driven, `FORCE ROW LEVEL SECURITY` + non-owner extractor role (or `COPY … WHERE tenant_id` per table):

```bash
psql "$CLONE_DATABASE_URL" -v target_tenant_id="$TARGET_TENANT_ID" -f tools/tenant-restore/apply-tenant-rls.sql
```

### Phase 3: Export Tenant Data

```bash
bash tools/tenant-restore/export-tenant-data.sh "$CLONE_DATABASE_URL" "$TARGET_TENANT_ID" "$TENANT_DUMP_FILE"
```

### Phase 4: Prepare Primary for Restore

Take an emergency Neon snapshot / branch of primary before any mutation. Purge must cover **every** table with `tenant_id`, in FK-safe order — the current `purge-tenant-data.sql` does not.

### Phase 5: Restore Tenant Dump

Apply selective restore only after a successful staging drill (below).

## Staging Validation (Mandatory before first production use)

When productizing:

1. Create a throwaway Neon branch from production (or a production-like snapshot).
2. Seed / identify two tenants with known fixture sets.
3. Corrupt/delete a subset of one tenant only.
4. Run clone → export → purge → restore on that branch (never on the parent).
5. Verify restored counts and business-level checks for the target tenant, and **unchanged** counts for the other tenant:
   - inventory totals
   - invoices and invoice items parity
   - customer/vehicle/workshop linkage
6. Record evidence: command transcript, row counts before/after, API smoke results.
7. Delete the throwaway branch and the dump file.

## Verification Checklist (productization gate)

- [ ] Deferral trigger has fired (see [deferrals.md](../.architecture/deferrals.md#single-tenant-restore-tooling))
- [ ] Scripts discover tenant-scoped tables from the live schema (no hardcoded omit-list)
- [ ] Export cannot include another tenant's rows (forced RLS + non-owner role, or per-table `WHERE tenant_id`)
- [ ] Dry-run completed on a throwaway Neon branch with two-tenant proof
- [ ] This playbook status flipped from "not productized" to "runnable" with the dry-run date
- [ ] ADR-0013 consequences updated to match

## Rollback

If a future restore is invalid:

1. Stop tenant traffic.
2. Restore production from the pre-restore emergency Neon branch / snapshot.
3. Re-run extraction with corrected timestamp/filters on a new throwaway branch.

## Known Limitations

- Cross-tenant global lookup tables (`users`, `master_parts`, `part_fitments`, `local_inventories`, `platform_admins`) are not tenant-scoped and must stay excluded from tenant-specific purge/restore.
- Schema drift between clone and primary must be resolved before import.
- Partition-level restore is unavailable until [partitioning rollout](./postgres-tenant-partitioning-rollout.md) actually ships. Do not plan tenant offboarding as `DROP PARTITION`.
