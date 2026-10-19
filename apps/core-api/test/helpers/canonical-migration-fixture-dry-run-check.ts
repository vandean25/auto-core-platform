import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  dryRunCanonicalMigrationCustomers,
  dryRunCanonicalMigrationVehicles,
} from './canonical-migration-fixture-totals.js';
import { applyCanonicalMigrationVehicleOwnerCustomers } from './canonical-migration-fixture-vehicle-owners.js';

type DryRunTotals = {
  rows: number;
  create: number;
  error: number;
  skip: number;
  update: number;
};

export async function countDryRunWarningRows(
  app: INestApplication,
  authHeader: string,
  jobId: string,
): Promise<number> {
  const rows = await request(app.getHttpServer())
    .get(`/imports/${jobId}/rows`)
    .set('Authorization', authHeader)
    .expect(200);
  return rows.body.data.filter(
    (row: { warnings?: unknown[] }) => (row.warnings?.length ?? 0) > 0,
  ).length;
}

export async function runCanonicalMigrationFixtureDryRunTotalsCheck(
  app: INestApplication,
  authHeader: string,
  expected: {
    customers: { totals: DryRunTotals; warningRows: number };
    vehicles: { totals: DryRunTotals; warningRows: number };
  },
): Promise<void> {
  const customers = await dryRunCanonicalMigrationCustomers(app, authHeader).expect(
    201,
  );
  expect(customers.body.totals).toMatchObject(expected.customers.totals);
  expect(
    await countDryRunWarningRows(app, authHeader, customers.body.id),
  ).toBe(expected.customers.warningRows);

  await applyCanonicalMigrationVehicleOwnerCustomers(app, authHeader);

  const vehicles = await dryRunCanonicalMigrationVehicles(app, authHeader).expect(
    201,
  );
  expect(vehicles.body.totals).toMatchObject(expected.vehicles.totals);
  expect(
    await countDryRunWarningRows(app, authHeader, vehicles.body.id),
  ).toBe(expected.vehicles.warningRows);
}
