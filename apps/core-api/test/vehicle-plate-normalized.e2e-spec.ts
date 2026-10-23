import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { normalizePlate } from '../src/vehicle/vehicle-plate.util.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { AuthService } from '../src/auth/auth.service.js';
import { teardownTestApp } from './test-lifecycle.js';

const SAMPLE_PLATES = [
  'W 12345 A',
  'w-12345-a',
  'W.12345.A',
  '  g 123\tab ',
  'M-AB 1234',
  'IL-4WD1',
  'E12-3',
  'ä 12 ö',
  '- . -',
  'W\u00a012345\ufeffA',
  '\ufeffG\u2003 1',
  'w\u00a0\u00a0-12',
  '',
  'abc',
];

const MIGRATION_SQL = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20261023030000_aut662_vehicle_plate_normalized/migration.sql',
  ),
  'utf8',
);

/**
 * AUT-662: vehicles.plate_normalized must equal normalizePlate(plate), both in the
 * migration backfill and on the API write paths.
 */
describe('Vehicle plate_normalized (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenant: TestTenantResult;
  let tenantPrisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    app = await createE2eApp();
    basePrisma = app.get<PrismaService>(PrismaService);
    tenant = await createTestTenant(basePrisma, 'plate-norm');
    tenantPrisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    token = createTestAuthToken(app.get(AuthService), tenant);
  });

  afterAll(async () => {
    if (!app) return;
    try {
      await cleanupTestTenantGraph(basePrisma, tenant.tenantId);
    } finally {
      await teardownTestApp(app, basePrisma);
    }
  });

  it('migration backfill SQL agrees with normalizePlate on sample plates', async () => {
    const statement = MIGRATION_SQL.match(/UPDATE "vehicles"[^;]+;/)![0];
    const created = await Promise.all(
      SAMPLE_PLATES.map((plate, index) =>
        tenantPrisma.vehicle.create({
          data: {
            tenant_id: tenant.tenantId,
            make: 'Parity',
            model: `P${index}`,
            year: 2020,
            plate,
          },
        }),
      ),
    );
    expect(created.every((v) => v.plate_normalized === null)).toBe(true);

    await basePrisma.$executeRawUnsafe(statement);

    const rows = await tenantPrisma.vehicle.findMany({
      where: { id: { in: created.map((v) => v.id) } },
      select: { id: true, plate: true, plate_normalized: true },
    });
    expect(rows).toHaveLength(SAMPLE_PLATES.length);
    for (const row of rows) {
      expect({ plate: row.plate, normalized: row.plate_normalized }).toEqual({
        plate: row.plate,
        normalized: normalizePlate(row.plate),
      });
    }
  });

  it('keeps plate_normalized in step on create and update through the API', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send({ make: 'Api', model: 'Create', year: 2021, plate: 'w 7-7.7 x' })
      .expect(201);
    const read = () =>
      tenantPrisma.vehicle.findFirstOrThrow({
        where: { id: created.body.id },
        select: { plate: true, plate_normalized: true },
      });
    expect(await read()).toEqual({
      plate: 'w 7-7.7 x',
      plate_normalized: 'W777X',
    });

    await request(app.getHttpServer())
      .patch(`/api/vehicles/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ plate: 'g-1 b' })
      .expect(200);
    expect(await read()).toEqual({ plate: 'g-1 b', plate_normalized: 'G1B' });
  });
});
