import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationSql = readFileSync(
  resolve(
    import.meta.dirname,
    '../../prisma/migrations/20261006220000_aut407_vehicle_stock_cycle_state/migration.sql',
  ),
  'utf8',
);

describe('vehicle stock cycle state migration', () => {
  it('leaves historical days-to-sell unknown when no acquisition date is available', () => {
    expect(migrationSql).toMatch(/CASE\s+WHEN\s+sale_acquisition\.stock_received_date\s+IS\s+NULL\s+THEN\s+NULL\s+ELSE\s+GREATEST\(0,/i);
  });
});
