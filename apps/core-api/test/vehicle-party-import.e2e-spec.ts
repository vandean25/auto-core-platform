import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { cleanDb } from '../src/prisma/fixtures/clean-db.js';
import { enableLegacyMigrationPurgeFlag } from '../src/prisma/fixtures/legacy-migration-purge-flag.js';
import { viennaIsoDay } from '../src/vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const SOURCE = 'legacy-dms';

const identity = (headers: string[]) =>
  Object.fromEntries(headers.map((header) => [header, header]));

const CUSTOMER_HEADERS = ['external_id', 'type', 'first_name', 'last_name', 'email'];
const VEHICLE_HEADERS = [
  'external_id',
  'vin',
  'plate',
  'make',
  'model',
  'year',
  'first_registration_date',
];
const PARTY_HEADERS = [
  'external_id',
  'vehicle_external_id',
  'customer_external_id',
  'role',
  'valid_from',
  'valid_to',
  'notes',
];
const DUE_HEADERS = [
  'external_id',
  'vehicle_external_id',
  'kind',
  'inspected_on',
  'plaketten_valid_until_year',
  'plaketten_valid_until_month',
  'due_date',
  'due_mileage',
  'external_ref',
  'station_name',
  'notes',
];

describe('Vehicle party and due date import (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let otherTenant: Awaited<ReturnType<typeof createTestTenant>>;
  let prisma: PrismaService;
  let token: string;
  let otherToken: string;

  const today = viennaIsoDay(new Date());
  const year = Number(today.slice(0, 4));
  const longAgo = `${year - 5}-01-01`;
  const yearAgo = `${year - 1}${today.slice(4)}`;

  beforeAll(async () => {
    app = await createE2eApp();
    basePrisma = app.get(PrismaService);
    const auth = app.get(AuthService);

    tenant = await createTestTenant(basePrisma, 'aut641-import-a');
    otherTenant = await createTestTenant(basePrisma, 'aut641-import-b');
    prisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    token = createTestAuthToken(auth, tenant);
    otherToken = createTestAuthToken(auth, otherTenant);
    const siteId = await resolveTestMainSiteId(basePrisma, tenant.tenantId);
    await basePrisma.user.update({
      where: { firebaseUid: tenant.firebaseUid },
      data: { active_site_id: siteId },
    });

    await importAndApply(
      'CUSTOMER',
      CUSTOMER_HEADERS,
      [
        ['CUSTOMER-A', 'PRIVATE', 'Anna', 'Owner', 'aut641-a@example.com'],
        ['CUSTOMER-B', 'PRIVATE', 'Bernd', 'Driver', 'aut641-b@example.com'],
        ['CUSTOMER-X', 'PRIVATE', 'Xaver', 'Former', 'aut641-x@example.com'],
      ],
      token,
    );
    await importAndApply(
      'VEHICLE',
      VEHICLE_HEADERS,
      [
        ['VEHICLE-001', '1HGCM82633A004352', 'W-641-1', 'Synthetic', 'One', '2020', '2019-06-01'],
        ['VEHICLE-002', '1HGCM82633A004353', 'W-641-2', 'Synthetic', 'Two', '2020', '2019-06-01'],
      ],
      token,
    );
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenant.tenantId);
    await cleanupTestTenantGraph(basePrisma, otherTenant.tenantId);
    await teardownTestApp(app, basePrisma);
  });

  function dryRun(
    entityType: string,
    headers: string[],
    rows: string[][],
    bearer: string,
    options: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post('/api/imports')
      .set('Authorization', `Bearer ${bearer}`)
      .field('entityType', entityType)
      .field('sourceSystem', SOURCE)
      .field('mapping', JSON.stringify(identity(headers)))
      .field('options', JSON.stringify(options))
      .attach('file', Buffer.from(serializeCsv(headers, rows, ','), 'utf8'), 'canonical.csv')
      .expect(201);
  }

  async function applyJob(jobId: string, bearer = token) {
    const response = await request(app.getHttpServer())
      .post(`/api/imports/${jobId}/apply`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return response.body as { totals: Record<string, number> };
  }

  async function importAndApply(
    entityType: string,
    headers: string[],
    rows: string[][],
    bearer: string,
    options: Record<string, unknown> = {},
  ) {
    const job = await dryRun(entityType, headers, rows, bearer, options);
    return { job: job.body, applied: await applyJob(job.body.id, bearer) };
  }

  async function rowsOf(jobId: string, bearer = token) {
    const response = await request(app.getHttpServer())
      .get(`/api/imports/${jobId}/rows?limit=100`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(200);
    return response.body.data as Array<{
      row_no: number;
      action: string;
      errors: Array<{ code: string }>;
    }>;
  }

  const idOf = async (entityType: 'VEHICLE' | 'CUSTOMER', externalId: string) =>
    (
      await prisma.externalIdMapping.findFirstOrThrow({
        where: {
          tenant_id: tenant.tenantId,
          entity_type: entityType,
          source_system: SOURCE,
          external_id: externalId,
        },
      })
    ).entity_id;

  const vehicleContact = async (externalId: string) =>
    (
      await prisma.vehicle.findFirstOrThrow({
        where: {
          id: await idOf('VEHICLE', externalId),
          tenant_id: tenant.tenantId,
        },
      })
    ).customer_id;

  describe('vehicle_parties.csv', () => {
    const initialRows = [
      ['PARTY-001', 'VEHICLE-001', 'CUSTOMER-A', 'OWNER', longAgo, '', 'Synthetic owner'],
      ['PARTY-002', 'VEHICLE-001', 'CUSTOMER-B', 'DRIVER', '', '', ''],
      ['PARTY-003', 'VEHICLE-001', 'CUSTOMER-X', 'PREVIOUS_OWNER', '', longAgo, ''],
    ];

    it('applies parties with LEGACY_IMPORT provenance and syncs the main contact', async () => {
      const { job, applied } = await importAndApply('VEHICLE_PARTY', PARTY_HEADERS, initialRows, token);

      expect(job.totals).toMatchObject({ create: 3, error: 0 });
      expect(applied.totals).toMatchObject({ create: 3, error: 0 });
      const parties = await prisma.vehicleParty.findMany({
        where: { tenant_id: tenant.tenantId },
      });
      expect(parties).toHaveLength(3);
      expect(parties.every((party) => party.source === 'LEGACY_IMPORT')).toBe(true);
      expect(await vehicleContact('VEHICLE-001')).toBe(await idOf('CUSTOMER', 'CUSTOMER-A'));
    });

    it('replays as a no-op through ExternalIdMapping', async () => {
      const second = await dryRun('VEHICLE_PARTY', PARTY_HEADERS, initialRows, token);
      expect(second.body.totals).toMatchObject({ create: 0, skip: 3, error: 0 });
      await applyJob(second.body.id);

      expect(
        await prisma.vehicleParty.count({ where: { tenant_id: tenant.tenantId } }),
      ).toBe(3);
    });

    it('applies an owner change: ends the old OWNER, creates the new one and updates customer_id', async () => {
      const rows = [
        ['PARTY-004', 'VEHICLE-001', 'CUSTOMER-B', 'OWNER', today, '', ''],
        ['PARTY-001', 'VEHICLE-001', 'CUSTOMER-A', 'OWNER', longAgo, today, ''],
      ];
      const { job, applied } = await importAndApply('VEHICLE_PARTY', PARTY_HEADERS, rows, token, {
        update_existing: true,
      });

      expect(job.totals).toMatchObject({ create: 1, update: 1, error: 0 });
      expect(applied.totals).toMatchObject({ create: 1, update: 1, error: 0 });
      expect(await vehicleContact('VEHICLE-001')).toBe(await idOf('CUSTOMER', 'CUSTOMER-B'));
      const activeOwners = await prisma.vehicleParty.findMany({
        where: { tenant_id: tenant.tenantId, role: 'OWNER', valid_to: null },
      });
      expect(activeOwners).toHaveLength(1);
    });

    it('reports row errors instead of crashing for future-dated, unknown and overlapping rows', async () => {
      const rows = [
        ['PARTY-010', 'VEHICLE-002', 'CUSTOMER-A', 'OWNER', '2999-01-01', '', ''],
        ['PARTY-011', 'VEHICLE-002', 'CUSTOMER-A', 'BILL_TO', '2999-01-01', '', ''],
        ['PARTY-012', 'VEHICLE-002', 'CUSTOMER-A', 'LEASING', '2999-01-01', '', ''],
        ['PARTY-013', 'VEHICLE-404', 'CUSTOMER-A', 'DRIVER', '', '', ''],
        ['PARTY-014', 'VEHICLE-002', 'CUSTOMER-404', 'DRIVER', '', '', ''],
        ['PARTY-015', 'VEHICLE-001', 'CUSTOMER-A', 'OWNER', yearAgo, '', ''],
      ];
      const job = await dryRun('VEHICLE_PARTY', PARTY_HEADERS, rows, token);
      const results = await rowsOf(job.body.id);

      expect(results.map((row) => row.action)).toEqual(Array(6).fill('ERROR'));
      expect(results[0].errors[0].code).toBe('MIGRATION_UNSUPPORTED_CAPABILITY');
      expect(results[1].errors[0].code).toBe('MIGRATION_UNSUPPORTED_CAPABILITY');
      expect(results[2].errors[0].code).toBe('MIGRATION_UNSUPPORTED_CAPABILITY');
      expect(results[3].errors[0].code).toBe('IMPORT_UNKNOWN_VEHICLE');
      expect(results[4].errors[0].code).toBe('IMPORT_UNKNOWN_CUSTOMER');
      expect(results[5].errors[0].code).toBe('VEHICLE_PARTY_OVERLAP');
      const applied = await applyJob(job.body.id);
      expect(applied.totals).toMatchObject({ create: 0, error: 6 });
    });

    it('does not resolve another tenant external ids', async () => {
      const job = await dryRun(
        'VEHICLE_PARTY',
        PARTY_HEADERS,
        [['PARTY-001', 'VEHICLE-001', 'CUSTOMER-A', 'OWNER', longAgo, '', '']],
        otherToken,
      );
      const [row] = await rowsOf(job.body.id, otherToken);
      expect(row.action).toBe('ERROR');
      expect(row.errors.map((error) => error.code)).toEqual(
        expect.arrayContaining(['IMPORT_UNKNOWN_VEHICLE', 'IMPORT_UNKNOWN_CUSTOMER']),
      );
    });

    it('exposes vehicles by role on the customer detail and blocks deleting a referenced customer', async () => {
      const customerId = await idOf('CUSTOMER', 'CUSTOMER-A');
      const detail = await request(app.getHttpServer())
        .get(`/api/customers/${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(detail.body.vehicle_parties).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'OWNER',
            source: 'LEGACY_IMPORT',
            valid_to: today,
            is_active: false,
            vehicle: expect.objectContaining({ plate: 'W-641-1' }),
          }),
        ]),
      );

      const blocked = await request(app.getHttpServer())
        .delete(`/api/customers/${customerId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
      expect(blocked.body.code).toBe('CUSTOMER_HAS_VEHICLE_PARTIES');
    });
  });

  describe('vehicle_due_dates.csv', () => {
    const inspectedOn = `${year - 2}-01-10`;
    const dueRows = [
      ['DUE-001', 'VEHICLE-002', 'INSPECTION_57A', inspectedOn, String(year - 1), '1', '', '', 'REPORT-001', 'Example station', 'Synthetic evidence'],
      ['DUE-002', 'VEHICLE-002', 'SERVICE', '', '', '', '2099-01-15', '60000', 'SERVICE-001', '', 'Synthetic schedule'],
    ];

    it('creates a LEGACY_IMPORT Pickerl record and one OPEN SERVICE_DUE notice, then replays as a no-op', async () => {
      const { job, applied } = await importAndApply('VEHICLE_DUE_DATE', DUE_HEADERS, dueRows, token);
      expect(job.totals).toMatchObject({ create: 2, error: 0 });
      expect(applied.totals).toMatchObject({ create: 2, error: 0 });

      const vehicleId = await idOf('VEHICLE', 'VEHICLE-002');
      const records = await prisma.vehicleInspectionRecord.findMany({
        where: { tenant_id: tenant.tenantId, vehicle_id: vehicleId },
      });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        inspection_type: 'PICKERL_57A',
        source: 'LEGACY_IMPORT',
        plaketten_valid_until_year: year - 1,
        plaketten_valid_until_month: 1,
        station_name: 'Example station',
        external_inspection_result_id: null,
        created_by_user_id: null,
      });
      const notices = await prisma.vehicleNotice.findMany({
        where: { tenant_id: tenant.tenantId, vehicle_id: vehicleId },
      });
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        type: 'SERVICE_DUE',
        status: 'OPEN',
        title: 'Service',
        source: 'LEGACY_IMPORT',
        due_mileage: 60000,
        external_ref: 'SERVICE-001',
        body: 'Synthetic schedule',
      });

      const replay = await dryRun('VEHICLE_DUE_DATE', DUE_HEADERS, dueRows, token);
      expect(replay.body.totals).toMatchObject({ create: 0, skip: 2, error: 0 });
      await applyJob(replay.body.id);
      expect(
        await prisma.vehicleNotice.count({ where: { tenant_id: tenant.tenantId } }),
      ).toBe(1);
    });

    it('rejects a duplicate schedule reference per vehicle and an unknown vehicle as row errors', async () => {
      const job = await dryRun(
        'VEHICLE_DUE_DATE',
        DUE_HEADERS,
        [
          ['DUE-010', 'VEHICLE-002', 'SERVICE', '', '', '', '2099-02-01', '', 'SERVICE-001', '', ''],
          ['DUE-011', 'VEHICLE-404', 'SERVICE', '', '', '', '2099-02-01', '', 'SERVICE-001', '', ''],
        ],
        token,
      );
      const results = await rowsOf(job.body.id);
      expect(results.map((row) => row.action)).toEqual(['ERROR', 'ERROR']);
      expect(results[0].errors[0].code).toBe('IMPORT_NATURAL_KEY_CONFLICT');
      expect(results[1].errors[0].code).toBe('IMPORT_UNKNOWN_VEHICLE');
    });

    it('shows the migrated record in the Pickerl due list', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/vehicles/pickerl-due?status=OVERDUE')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const plates = response.body.data.map((vehicle: { plate: string }) => vehicle.plate);
      expect(plates).toContain('W-641-2');
    });

    it('keeps LEGACY_IMPORT inspection records immutable through the API', async () => {
      const vehicleId = await idOf('VEHICLE', 'VEHICLE-002');
      const [record] = await prisma.vehicleInspectionRecord.findMany({
        where: { tenant_id: tenant.tenantId, vehicle_id: vehicleId },
      });

      await request(app.getHttpServer())
        .patch(`/api/vehicles/${vehicleId}/inspection-records/${record.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ station_name: 'Changed' })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/api/vehicles/${vehicleId}/inspection-records/${record.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      const listed = await request(app.getHttpServer())
        .get(`/api/vehicles/${vehicleId}/inspection-records`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(listed.body[0].source).toBe('LEGACY_IMPORT');
    });
  });

  describe('purge and clean-db with parties and notices', () => {
    const rollback = new Error('rollback after clean-db');

    it('cleanDb removes parties and notices before vehicles, customers and workshop orders', async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const raw = new PrismaClient({ adapter: new PrismaPg(pool) });
      try {
        expect(
          await prisma.vehicleParty.count({ where: { tenant_id: tenant.tenantId } }),
        ).toBeGreaterThan(0);
        expect(
          await prisma.vehicleNotice.count({ where: { tenant_id: tenant.tenantId } }),
        ).toBeGreaterThan(0);

        await expect(
          raw.$transaction(
            async (tx) => {
              await enableLegacyMigrationPurgeFlag(tx);
              await cleanDb(tx as unknown as PrismaClient);
              expect(await tx.vehicleParty.count()).toBe(0);
              expect(await tx.vehicleNotice.count()).toBe(0);
              throw rollback;
            },
            { timeout: 120_000, maxWait: 10_000 },
          ),
        ).rejects.toBe(rollback);

        expect(
          await prisma.vehicleParty.count({ where: { tenant_id: tenant.tenantId } }),
        ).toBeGreaterThan(0);
      } finally {
        await raw.$disconnect();
        await pool.end();
      }
    });

    it('the tenant purge SQL succeeds while parties and notices reference vehicles and customers', async () => {
      const victim = await createTestTenant(basePrisma, 'aut641-purge');
      const victimPrisma = createTenantAwarePrisma(basePrisma, victim.tenantId);
      const customer = await victimPrisma.customer.create({
        data: {
          tenant_id: victim.tenantId,
          first_name: 'Purge',
          last_name: 'Synthetic',
          email: `aut641-purge-${Date.now()}@example.com`,
        },
      });
      const vehicle = await victimPrisma.vehicle.create({
        data: {
          tenant_id: victim.tenantId,
          make: 'Synthetic',
          model: 'Purge',
          year: 2020,
          customer_id: customer.id,
        },
      });
      await victimPrisma.vehicleParty.create({
        data: {
          tenant_id: victim.tenantId,
          vehicle_id: vehicle.id,
          customer_id: customer.id,
          role: 'OWNER',
        },
      });
      await victimPrisma.vehicleNotice.create({
        data: {
          tenant_id: victim.tenantId,
          vehicle_id: vehicle.id,
          type: 'REMARK',
          title: 'Synthetic remark',
        },
      });

      // Runs the delete section of the generated script. Its schema preflight compares foreign keys
      // with the manifest and reports drift that already exists between migrations and schema.prisma.
      const full = readFileSync(
        join(process.cwd(), '..', '..', 'tools', 'tenant-restore', 'purge-tenant-data.sql'),
        'utf8',
      );
      const deleteSection = full
        .slice(full.indexOf("BEGIN;\n\nSELECT set_config('acp.allow_purge'"))
        .split('\n')
        .filter((line) => !line.startsWith('\\'))
        .join('\n');
      const script = `SELECT set_config('app.target_tenant_id', '${victim.tenantId}', false);\n${deleteSection}`;
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await client.query(script);
      } finally {
        await client.end();
      }

      expect(await victimPrisma.vehicleParty.count({ where: { tenant_id: victim.tenantId } })).toBe(0);
      expect(await victimPrisma.vehicleNotice.count({ where: { tenant_id: victim.tenantId } })).toBe(0);
      expect(await victimPrisma.vehicle.count({ where: { tenant_id: victim.tenantId } })).toBe(0);
      expect(await victimPrisma.customer.count({ where: { tenant_id: victim.tenantId } })).toBe(0);
    });
  });
});
