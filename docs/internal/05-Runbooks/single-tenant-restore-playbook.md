# Runbook: Single-Tenant Restore (PITR Clone + Selective Upsert)

**Owner**: Engineering / SRE
**Severity**: Critical
**Related Issues**: AUT-72
**Related ADR**: ADR-0013 (Row-Level Multi-Tenancy)

## Why This Exists
In a shared-schema multi-tenant database, restoring a full database backup would overwrite data for unaffected tenants. This runbook restores only one tenant by extracting tenant-scoped data from a point-in-time clone.

## Required Artifacts
- `tools/tenant-restore/apply-tenant-rls.sql`
- `tools/tenant-restore/export-tenant-data.sh`
- `tools/tenant-restore/purge-tenant-data.sql`
- `tools/tenant-restore/restore-tenant-data.sh`

## Inputs
- `TARGET_TENANT_ID`
- `INCIDENT_TIMESTAMP_UTC` (corruption/deletion moment)
- `CLONE_DATABASE_URL` (PITR clone)
- `PRIMARY_DATABASE_URL` (production)
- `TENANT_DUMP_FILE` (output SQL file path)

## Phase 1: Create PITR Clone
1. Create a clone to a safe timestamp just before the incident:

```bash
gcloud sql instances clone <primary-instance> <recovery-clone-instance> --point-in-time="<INCIDENT_TIMESTAMP_MINUS_1_MINUTE>"
```

2. Validate clone access and schema parity.

## Phase 2: Apply Tenant RLS on Clone
Apply dynamic RLS policies to all tenant-scoped tables:

```bash
psql "$CLONE_DATABASE_URL" -v target_tenant_id="$TARGET_TENANT_ID" -f tools/tenant-restore/apply-tenant-rls.sql
```

Notes:
- Policies are created only for tables with a `tenant_id` column.
- Extraction should use an account with row security enforced.

## Phase 3: Export Tenant Data
Run tenant-scoped logical dump:

```bash
bash tools/tenant-restore/export-tenant-data.sh "$CLONE_DATABASE_URL" "$TARGET_TENANT_ID" "$TENANT_DUMP_FILE"
```

This uses:
- `pg_dump --data-only --inserts --column-inserts --enable-row-security`

## Phase 4: Prepare Primary for Restore
Take an emergency snapshot of primary before any mutation.

Purge only target tenant rows (ordered delete script):

```bash
psql "$PRIMARY_DATABASE_URL" -v target_tenant_id="$TARGET_TENANT_ID" -f tools/tenant-restore/purge-tenant-data.sql
```

## Phase 5: Restore Tenant Dump
Apply selective restore:

```bash
bash tools/tenant-restore/restore-tenant-data.sh "$PRIMARY_DATABASE_URL" "$TARGET_TENANT_ID" "$TENANT_DUMP_FILE"
```

The restore script:
1. Purges tenant data using `purge-tenant-data.sql`
2. Imports tenant dump SQL
3. Prints tenant row-count checks for key tables

## Staging Validation (Mandatory)
Before production use, execute full drill in staging:
1. Create synthetic tenant with known fixture set.
2. Corrupt/delete subset of fixture data.
3. Run full clone -> export -> purge -> restore workflow.
4. Verify restored counts and business-level checks:
   - inventory totals
   - invoices and invoice items parity
   - customer/vehicle/workshop linkage

Record evidence in incident docs:
- command transcript
- row count before/after
- API smoke results for the target tenant

## Verification Checklist
- [ ] Target tenant data restored to requested timestamp
- [ ] Non-target tenants unchanged
- [ ] Core integrity checks pass (FK consistency, counts)
- [ ] Clone instance deleted after completion
- [ ] Dump file removed from local machine / bastion

## Rollback
If restore quality is invalid:
1. Stop tenant traffic.
2. Restore production from pre-restore emergency snapshot.
3. Re-run extraction with corrected timestamp/filters.

## Known Limitations
- Cross-tenant global lookup tables are intentionally excluded from tenant-specific restore.
- Schema drift between clone and primary must be resolved before import.
