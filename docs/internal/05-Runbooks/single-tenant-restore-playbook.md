# Runbook: Single-Tenant Restore (PITR Clone + Selective Upsert)

**Owner**: Engineering / SRE
**Severity**: Critical (when productized)
**Related Issues**: AUT-72, AUT-154
**Related ADR**: [ADR-0013 (Row-Level Multi-Tenancy)](../01-ADR/2026-04-15-row-level-multi-tenancy.md)

## Status (as of AUT-171) - not productized

**Do not run this playbook against production.** Draft scripts exist under `tools/tenant-restore/` but they have never been drilled on Neon and are not a supported restore path.

| Claim in older drafts | Reality |
| --- | --- |
| Scripts are ready to extract one tenant from a PITR clone | Draft only. They now fail closed on schema drift, target confirmation, pooler URLs, and production-like URLs, but there is no recorded dry-run on Neon or staging. |
| Clone via `gcloud sql instances clone` | Production database is **Neon**, not Cloud SQL. Neon branching / PITR is the clone mechanism. |
| PostgreSQL list-partitioning lets us drop/restore a tenant partition | **Not rolled out.** `tools/partitioning/` is unused in production. See [postgres-tenant-partitioning-rollout.md](./postgres-tenant-partitioning-rollout.md). |

**Deferral**: [Single-tenant restore tooling](../.architecture/deferrals.md#single-tenant-restore-tooling) — productize when a measurable trigger fires (tenant count or data size), not because the draft files exist.

**Supported DR today**: restore the **entire** Neon branch / project to a point in time. That is all-or-nothing across tenants. With a single production tenant this is acceptable. With two or more live tenants it overwrites unaffected workshops.

Until the deferral triggers, a tenant-specific incident is a DBA-reviewed manual extraction, not an automated runbook.

### What AUT-171 now guarantees (draft tooling only)

- The purge table set is generated from `apps/core-api/prisma/schema.prisma`, including tenant-dependent child tables and Prisma implicit join tables. `node tools/tenant-restore/verify-table-list.mjs` fails when checked-in SQL is stale.
- The generated SQL checks `information_schema` before any mutation and refuses to run when tenant tables or tenant-dependent foreign-key tables drift outside the manifest.
- Nullable self-references are nulled before deletion, including `catalog_items.superseded_by_id`, `storage_locations.parent_id`, and `labor_categories.parent_id`.
- `users.active_tenant_id` is cleared for the target tenant; users are never purged.
- Export uses per-table filtered `COPY (SELECT ...)` queries. It does not use `pg_dump`; table-owner `pg_dump --enable-row-security` remains forbidden because table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` is enabled.
- Export preflights tenant-scoped parent links that do not carry `tenant_id` in the FK, and the generated dump is bound to the source UUID and checked for unexpected SQL/tables before restore.
- Restore keeps purge and import in one database transaction, so an import failure rolls the purge back.
- Every wrapper defaults to `DRY_RUN=1`, requires `CONFIRM_TENANT_ID` to equal the target UUID, rejects Neon pooler URLs, and requires `I_UNDERSTAND_CROSS_TENANT_BLAST_RADIUS=yes` for `neon.tech` hosts. `DRY_RUN=0` is still an explicit, untested draft operation.

---

## Why This Exists (when productized)

In a shared-schema multi-tenant database, restoring a full database backup would overwrite data for unaffected tenants. The intended design restores only one tenant by extracting tenant-scoped data from a point-in-time clone.

The systems-architect review of ADR-0013 called this gap **critical**. AUT-154 records the explicit choice to defer productization rather than ship untested restore tooling.

## Required Artifacts (draft — not production-ready)

- `tools/tenant-restore/apply-tenant-rls.sql`
- `tools/tenant-restore/export-tenant-data.sh`
- `tools/tenant-restore/export-tenant-data.mjs`
- `tools/tenant-restore/verify-dump.mjs`
- `tools/tenant-restore/purge-tenant-data.sql`
- `tools/tenant-restore/verify-tenant-schema.sql`
- `tools/tenant-restore/generate-tenant-restore-sql.mjs`
- `tools/tenant-restore/verify-table-list.mjs`
- `tools/tenant-restore/restore-tenant-data.sh`

### Known gaps in the draft (must be fixed before any drill)

1. **No production drill.** The generated manifest and filtered exporter have not been validated on a two-tenant Neon timestamp branch.
2. **RLS is not the export mechanism.** `apply-tenant-rls.sql` now uses `FORCE ROW LEVEL SECURITY` for clone experiments, but table-owner `pg_dump` is still forbidden. The exporter uses explicit per-table `COPY` filters instead.
3. **The generated set is intentionally conservative.** Tenant-dependent rows with malformed cross-tenant references fail at foreign-key enforcement rather than being silently broadened.
4. **No Neon clone procedure.** The previous Cloud SQL clone command does not apply to this platform.
5. **No recorded dry-run.** Staging validation below has never been executed.

Do not "fix forward" by running these scripts as-is. When the deferral triggers, prove the generated flow on a throwaway Neon branch before any production use.

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

Only after a staging drill validates the generated manifest and per-table filtered `COPY` exporter:

```bash
psql "$CLONE_DATABASE_URL" -v target_tenant_id="$TARGET_TENANT_ID" -f tools/tenant-restore/apply-tenant-rls.sql
```

### Phase 3: Export Tenant Data

```bash
bash tools/tenant-restore/export-tenant-data.sh "$CLONE_DATABASE_URL" "$TARGET_TENANT_ID" "$TENANT_DUMP_FILE"
```

### Phase 4: Prepare Primary for Restore

Take an emergency Neon snapshot / branch of primary before any mutation. The generated purge schema checks must pass before it can mutate; the current draft remains untested.

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
- [x] Scripts generate tenant-scoped and dependent tables from Prisma, then cross-check the live schema before mutation
- [x] Export uses per-table filtered `COPY` and cannot use the old table-owner `pg_dump` path
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
