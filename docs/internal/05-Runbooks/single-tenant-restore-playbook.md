# Runbook: Single-Tenant Restore Strategy

**Owner**: Engineering / SRE Team
**Tag**: `DR` `Multi-Tenant`
**Severity**: CRITICAL
**Target Document**: `ADR-0013: Row-Level Multi-Tenancy`

## Context
Auto Core Platform utilizes a shared-schema row-level multi-tenant database. RDS/Cloud SQL automated backups restore the *entire* database. If a single workshop (tenant) accidentally deletes critical data or suffers localized corruption, standard PITR cannot be applied directly to the primary database because it would overwrite data for all other unaffected tenants.

This runbook defines the operational strategy for selectively extracting and restoring a single tenant's data from a snapshot backup.

---

## Strategy: Point-In-Time Extraction & Upsert

### Prerequisites
- Access to Google Cloud SQL (or equivalent RDS) console.
- `pg_dump` and `psql` utilities installed and authenticated.
- A secure jump host or Bastion to execute queries against the primary and clone instances.
- The targeted `tenant_id`.
- Target recovery timestamp (the Point-In-Time desired).

### Phase 1: Clone the Backup
Instead of restoring over the live database, you must clone a snapshot. 

1. Create a Point-in-Time Clone in the Cloud SQL console corresponding to exactly 1 minute *before* the destructive event.
2. Ensure the cloned instance has the same IP structure or proxy access as the primary production database.
   ```bash
   gcloud sql instances clone <primary-instance> <recovery-clone-instance> --point-in-time="2026-05-18T10:00:00.000Z"
   ```

### Phase 2: Define Tenant Isolation Rules
You need to extract only the SQL records belonging to `tenant_id`. 

We will accomplish this using PostgreSQL Row-Level Security (RLS) applied temporarily on the cloned instance, or using a script that generates `COPY` lines per mapped table. Given Prisma's structure, the easiest method is to run a script against the clone that generates a partial dump.

### Phase 3: Logical Extraction

Option A: Utilize `pg_dump` with `--enable-row-security`

1. Connect to the cloned recovery instance as a superuser.
2. Enable RLS on all domain tables:
   ```sql
   DO $$ DECLARE
      r RECORD;
   BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'Tenant') LOOP
         EXECUTE 'ALTER TABLE ' || quote_ident(r.tablename) || ' ENABLE ROW LEVEL SECURITY;';
         EXECUTE 'CREATE POLICY tenant_isolation_policy ON ' || quote_ident(r.tablename) || ' USING (tenant_id = ''<TARGET_TENANT_CUID>'');';
      END LOOP;
   END $$;
   ```
3. Create a restricted user and force RLS:
   ```sql
   CREATE USER tenant_extractor WITH PASSWORD 'secure_pass';
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO tenant_extractor;
   ```
4. Execute `pg_dump` as the restricted user:
   ```bash
   pg_dump -U tenant_extractor -h <recovery-instance-ip> -d autocoredb -a --enable-row-security --inserts > tenant_backup.sql
   ```
   *Note: Using `--inserts` ensures we can handle conflict resolution on restore.*

### Phase 4: Selective Restore to Primary
The target tenant's subset of data is now in `tenant_backup.sql`. 

To restore, we cannot blindly run the script because existing records might collide, or we might need to purge the corrupted records first.

1. **Safety First**: Take a snapshot of the *primary* production database right now.
2. **Purge Corrupted Data**: Using a privileged Prisma client script or direct SQL, delete all records for `tenant_id` from the tables we are restoring (order dictates foreign keys must be respected - e.g., delete `InvoiceItem` before `Invoice`).
   ```sql
   DELETE FROM "InvoiceItem" WHERE tenant_id = '<TARGET_TENANT_CUID>';
   DELETE FROM "Invoice" WHERE tenant_id = '<TARGET_TENANT_CUID>';
   -- ... etc.
   ```
3. **Import Clean Data**: 
   ```bash
   psql -U admin -h <primary-instance-ip> -d autocoredb -f tenant_backup.sql
   ```

### Phase 5: Verification and Cleanup
1. The tenant must log in and confirm their data is accurate up to the requested timestamp.
2. Delete the cloned recovery instance to save costs:
   ```bash
   gcloud sql instances delete <recovery-clone-instance>
   ```
3. Remove the localized `tenant_backup.sql` from your machine.

---

## Known Limitations
- Foreign keys that traverse generic system tables (tables *without* a `tenant_id`) might require manual reconciliation. Ensure `pg_dump` does not export the generalized tables (`Tenant` definition, cross-tenant lookup dictionaries) if they exist.
- Restore time is not instantaneous. Cloning an instance takes several minutes. 

## Automated Tooling Future State 
In the short-term, a Node.js CLI script should be written that automates Phase 3 and Phase 4 by sequentially querying `findAll({ where: { tenant_id } })` across all mapped Prisma models and upserting them, eliminating the need for manual PostgreSQL RLS policies during emergencies.