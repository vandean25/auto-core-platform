import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationSql = readFileSync(
  resolve(
    import.meta.dirname,
    '../../prisma/migrations/20261101100100_aut831_tyre_set_status_data_migration/migration.sql',
  ),
  'utf8',
);

describe('AUT-831 tyre set status data migration', () => {
  it('updates RETURNED sets to NEW when there are no events other than INSPECTED', () => {
    expect(migrationSql).toMatch(/UPDATE\s+"tyre_sets"/);
    expect(migrationSql).toMatch(/SET\s+"status"\s*=\s*'NEW'/);
    expect(migrationSql).toMatch(/WHERE\s+"status"\s*=\s*'RETURNED'/);
    expect(migrationSql).toMatch(/AND\s+NOT\s+EXISTS/);
    expect(migrationSql).toMatch(
      /"tyre_set_events"\."tenant_id"\s*=\s*"tyre_sets"\."tenant_id"/,
    );
    expect(migrationSql).toMatch(
      /"tyre_set_events"\."tyre_set_id"\s*=\s*"tyre_sets"\."id"/,
    );
    // Crucial: INSPECTED events are ignored, converting sets with only INSPECTED events to NEW
    expect(migrationSql).toMatch(
      /"tyre_set_events"\."event_type"\s*<>\s*'INSPECTED'/,
    );
  });

  it('contains a safe rollback note explaining how to revert the backfill', () => {
    expect(migrationSql).toMatch(/Rollback note:/);
    expect(migrationSql).toMatch(/UPDATE\s+"tyre_sets"/);
    expect(migrationSql).toMatch(/SET\s+"status"\s*=\s*'RETURNED'/);
    expect(migrationSql).toMatch(/WHERE\s+"status"\s*=\s*'NEW'/);
  });
});
