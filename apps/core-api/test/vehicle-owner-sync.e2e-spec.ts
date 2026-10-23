import request from 'supertest';
import { serializeCsv } from '../src/import/csv-parse.util.js';
import { findVehicleOwnerMismatches } from '../src/vehicle/vehicle-owner-mismatch.query.js';
import { viennaIsoDay } from '../src/vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';
import { createTenantAwarePrisma } from './tenant-test-utils.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  vin,
} from './helpers/vehicle-stock-suite.js';

const SOURCE = 'legacy-dms';
const CUSTOMER_HEADERS = [
  'external_id',
  'type',
  'first_name',
  'last_name',
  'email',
];
const VEHICLE_HEADERS = [
  'external_id',
  'vin',
  'plate',
  'make',
  'model',
  'year',
  'owner_customer_external_id',
];

describe('Vehicle owner and customer_id stay in sync (e2e)', () => {
  let suite: Awaited<ReturnType<typeof createVehicleStockSuite>>;
  const today = viennaIsoDay(new Date());
  const longAgo = new Date(
    `${Number(today.slice(0, 4)) - 3}-01-01T00:00:00.000Z`,
  );
  const todayDate = new Date(`${today}T00:00:00.000Z`);

  beforeAll(async () => {
    suite = await createVehicleStockSuite();
  });

  afterAll(async () => {
    await disposeVehicleStockSuite(suite);
  });

  async function importCsv(
    entityType: string,
    headers: string[],
    rows: string[][],
  ) {
    const dryRun = await request(suite.app.getHttpServer())
      .post('/api/imports')
      .set('Authorization', `Bearer ${suite.authToken}`)
      .field('entityType', entityType)
      .field('sourceSystem', SOURCE)
      .field(
        'mapping',
        JSON.stringify(Object.fromEntries(headers.map((h) => [h, h]))),
      )
      .field('options', JSON.stringify({}))
      .attach(
        'file',
        Buffer.from(serializeCsv(headers, rows, ','), 'utf8'),
        'canonical.csv',
      )
      .expect(201);
    const jobRows = await request(suite.app.getHttpServer())
      .get(`/api/imports/${dryRun.body.id}/rows?limit=100`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);
    expect(
      jobRows.body.data.flatMap((row: { errors: unknown }) => row.errors),
    ).toEqual([]);
    await request(suite.app.getHttpServer())
      .post(`/api/imports/${dryRun.body.id}/apply`)
      .set('Authorization', `Bearer ${suite.authToken}`)
      .expect(200);
  }

  const mappedId = async (
    entityType: 'VEHICLE' | 'CUSTOMER',
    externalId: string,
  ) =>
    (
      await suite.prisma.externalIdMapping.findFirstOrThrow({
        where: {
          tenant_id: suite.tenantId,
          entity_type: entityType,
          source_system: SOURCE,
          external_id: externalId,
        },
      })
    ).entity_id;

  async function sellAndFinalize(vehicleId: string) {
    const server = suite.app.getHttpServer();
    const bearer = `Bearer ${suite.authToken}`;
    const draft = { vehicle_id: vehicleId, customer_id: suite.buyerId };
    const { body } = await request(server)
      .post('/api/vehicle-sales')
      .set({ Authorization: bearer })
      .send({ ...draft, sale_price: 12000 })
      .expect(201);
    await request(server)
      .post(`/api/vehicle-sales/${body.id}/finalize`)
      .set({ Authorization: bearer })
      .expect(201);
  }

  const ownerParties = (vehicleId: string) =>
    suite.prisma.vehicleParty.findMany({
      where: {
        tenant_id: suite.tenantId,
        vehicle_id: vehicleId,
        role: 'OWNER',
      },
      orderBy: { createdAt: 'asc' },
    });

  const contactOf = async (vehicleId: string) =>
    (
      await suite.prisma.vehicle.findFirstOrThrow({
        where: { id: vehicleId, tenant_id: suite.tenantId },
      })
    ).customer_id;

  it('creates the OWNER party and sets customer_id for a vehicle created by the vehicles.csv import', async () => {
    await importCsv('CUSTOMER', CUSTOMER_HEADERS, [
      ['SYNC-C-A', 'PRIVATE', 'Anna', 'Sync', 'aut697-a@example.com'],
    ]);
    const customerA = await mappedId('CUSTOMER', 'SYNC-C-A');

    await importCsv('VEHICLE', VEHICLE_HEADERS, [
      [
        'SYNC-V-1',
        '1HGCM82633A697001',
        'W-697-1',
        'Synthetic',
        'One',
        '2020',
        'SYNC-C-A',
      ],
    ]);
    const vehicleId = await mappedId('VEHICLE', 'SYNC-V-1');
    const [created] = await ownerParties(vehicleId);
    expect(created).toMatchObject({
      customer_id: customerA,
      valid_to: null,
      source: 'LEGACY_IMPORT',
    });
    expect(await contactOf(vehicleId)).toBe(customerA);
  });

  it('ends the previous OWNER on a vehicle sale and leaves BILL_TO and LEASING active', async () => {
    const { received } = await suite.createAndReceive({
      vin: vin('AUT697SALE'),
      sellerType: 'VENDOR',
    });
    const vehicleId = received.vehicle_id as string;
    const former = await suite.prisma.customer.create({
      data: {
        tenant_id: suite.tenantId,
        first_name: 'Former',
        last_name: 'Owner',
        type: 'PRIVATE',
      },
    });
    const payer = await suite.prisma.customer.create({
      data: {
        tenant_id: suite.tenantId,
        first_name: 'Bill',
        last_name: 'To',
        type: 'PRIVATE',
      },
    });
    const lessor = await suite.prisma.customer.create({
      data: {
        tenant_id: suite.tenantId,
        first_name: 'Leasing',
        last_name: 'Co',
        type: 'PRIVATE',
      },
    });
    const party = (customerId: string, role: 'OWNER' | 'BILL_TO' | 'LEASING') =>
      suite.prisma.vehicleParty.create({
        data: {
          tenant_id: suite.tenantId,
          vehicle_id: vehicleId,
          customer_id: customerId,
          role,
          valid_from: longAgo,
        },
      });
    const oldOwner = await party(former.id, 'OWNER');
    const billTo = await party(payer.id, 'BILL_TO');
    const leasing = await party(lessor.id, 'LEASING');
    await suite.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { customer_id: former.id },
    });

    await sellAndFinalize(vehicleId);

    const parties = await ownerParties(vehicleId);
    expect(parties).toHaveLength(2);
    expect(parties[0]).toMatchObject({ id: oldOwner.id, valid_to: todayDate });
    expect(parties[1]).toMatchObject({
      customer_id: suite.buyerId,
      valid_to: null,
    });
    expect(await contactOf(vehicleId)).toBe(suite.buyerId);
    for (const kept of [billTo, leasing]) {
      const row = await suite.prisma.vehicleParty.findFirstOrThrow({
        where: { id: kept.id, tenant_id: suite.tenantId },
      });
      expect(row.valid_to).toBeNull();
    }
  });

  it('lists only the tenant vehicles whose active OWNER differs from customer_id', async () => {
    const mismatchTenant = async (tenantId: string, tag: string) => {
      const prisma = createTenantAwarePrisma(suite.basePrisma, tenantId);
      const owner = await prisma.customer.create({
        data: {
          tenant_id: tenantId,
          first_name: tag,
          last_name: 'Owner',
          type: 'PRIVATE',
        },
      });
      const other = await prisma.customer.create({
        data: {
          tenant_id: tenantId,
          first_name: tag,
          last_name: 'Other',
          type: 'PRIVATE',
        },
      });
      const inSync = await prisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          make: 'Synthetic',
          model: 'Sync',
          year: 2020,
          customer_id: owner.id,
        },
      });
      const drifted = await prisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          make: 'Synthetic',
          model: 'Drift',
          year: 2020,
          customer_id: other.id,
        },
      });
      for (const vehicle of [inSync, drifted]) {
        await prisma.vehicleParty.create({
          data: {
            tenant_id: tenantId,
            vehicle_id: vehicle.id,
            customer_id: owner.id,
            role: 'OWNER',
            valid_from: longAgo,
          },
        });
      }
      return {
        inSync: inSync.id,
        drifted: drifted.id,
        owner: owner.id,
        other: other.id,
      };
    };
    const a = await mismatchTenant(suite.tenantId, 'TenantA');
    const b = await mismatchTenant(suite.otherTenantId, 'TenantB');

    const mismatches = await findVehicleOwnerMismatches(
      suite.prisma,
      suite.tenantId,
      today,
    );

    expect(mismatches.map((row) => row.vehicle_id)).toContain(a.drifted);
    expect(mismatches.map((row) => row.vehicle_id)).not.toContain(a.inSync);
    expect(mismatches.map((row) => row.vehicle_id)).not.toContain(b.drifted);
    expect(mismatches.find((row) => row.vehicle_id === a.drifted)).toEqual({
      vehicle_id: a.drifted,
      customer_id: a.other,
      owner_customer_id: a.owner,
    });
  });
});
