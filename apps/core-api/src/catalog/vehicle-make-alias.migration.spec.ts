import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationSql = readFileSync(
  resolve(
    __dirname,
    '../../prisma/migrations/20260829170000_harden_vehicle_identity_storage/migration.sql',
  ),
  'utf8',
);

describe('vehicle identity storage migration', () => {
  it('uses PostgreSQL unaccent for both Brand normalization expressions', () => {
    const canonicalExpression =
      "regexp_replace(public.unaccent(upper(name)), '[^A-Z0-9]', '', 'g')";

    expect(migrationSql.split(canonicalExpression)).toHaveLength(3);
  });
});