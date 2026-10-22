import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  vin,
} from './helpers/vehicle-stock-suite.js';
import type { VehicleStockSuite } from './helpers/vehicle-stock-suite.js';

describe('Vehicle stock trading (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let tenantId: string;
  let otherTenantId: string;
  let authToken: string;
  let otherAuthToken: string;
  let buyerId: string;
  let createAndReceive: VehicleStockSuite['createAndReceive'];

  beforeAll(async () => {
    ({
      app,
      basePrisma,
      prisma,
      tenantId,
      otherTenantId,
      authToken,
      otherAuthToken,
      buyerId,
      createAndReceive,
    } = await createVehicleStockSuite());
  });

  afterAll(async () => {
    await disposeVehicleStockSuite({
      app,
      basePrisma,
      prisma,
      tenantId,
      otherTenantId,
    });
  });

  it('leaves the snapshot and the archive pointer out of the finalize and vehicle responses', async () => {
    const expectNoArchiveInternals = (sale: Record<string, unknown>) => {
      for (const field of [
        'kaufvertrag_snapshot',
        'kaufvertrag_snapshot_sha256',
        'kaufvertrag_archive_bucket',
        'kaufvertrag_archive_key',
        'kaufvertrag_archive_generation',
        'kaufvertrag_archive_sha256',
      ]) {
        expect(sale).not.toHaveProperty(field);
      }
    };
    const { received } = await createAndReceive({
      vin: vin('ARCHIVE-INTERNALS'),
      sellerType: 'VENDOR',
    });
    const created = await request(app.getHttpServer())
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicle_id: received.vehicle_id,
        customer_id: buyerId,
        sale_price: 12000,
        contract_concluded_at: '2026-10-02',
        handed_over_at: '2026-10-08',
      })
      .expect(201);

    // The Kaufvertrag PDF itself is covered in vehicle-sale-kaufvertrag.e2e-spec.ts.
    // Here an archived snapshot is written directly, so every response that carries
    // the sale can be checked for the archive internals.
    await prisma.vehicleSale.updateMany({
      where: { id: created.body.id },
      data: {
        kaufvertrag_snapshot: { seller: { name: 'Demo Autohaus GmbH' } },
        kaufvertrag_snapshot_sha256: 'a'.repeat(64),
        kaufvertrag_archive_bucket: 'pdf-archive-bucket',
        kaufvertrag_archive_key: `vehicle-sale-kaufvertrag-archives/${tenantId}/${created.body.id}/${'a'.repeat(64)}/kaufvertrag-brand-v1.pdf`,
        kaufvertrag_archive_generation: '101',
        kaufvertrag_archive_sha256: 'b'.repeat(64),
        kaufvertrag_generated_at: new Date('2026-10-09T10:00:00.000Z'),
      },
    });

    const finalized = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${created.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
    expect(finalized.body).toMatchObject({
      status: 'INVOICED',
      kaufvertrag_generated_at: '2026-10-09T10:00:00.000Z',
    });
    expectNoArchiveInternals(finalized.body);

    const vehicle = await request(app.getHttpServer())
      .get(`/api/vehicles/${received.vehicle_id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(vehicle.body.sales).toHaveLength(1);
    expectNoArchiveInternals(vehicle.body.sales[0]);

    const stock = await request(app.getHttpServer())
      .get(`/api/vehicle-stock/${received.vehicle_id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(stock.body.sales).toHaveLength(1);
    expectNoArchiveInternals(stock.body.sales[0]);
  });

  it('captures, refreshes, protects, and audits Gewaehrleistung sale snapshots', async () => {
    const { received } = await createAndReceive({
      vin: vin('GEWAEHRLEISTUNG'),
      sellerType: 'VENDOR',
    });
    const created = await request(app.getHttpServer())
      .post('/api/vehicle-sales')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        vehicle_id: received.vehicle_id,
        customer_id: buyerId,
        sale_price: 12000,
        contract_concluded_at: '2026-10-02',
        handed_over_at: '2026-10-08',
      })
      .expect(201);

    expect(created.body).toMatchObject({
      buyer_is_consumer: true,
      gewaehrleistung_shortened_negotiated: false,
      gewaehrleistung_ends_on: '2028-10-08T00:00:00.000Z',
      presumption_ends_on: '2027-10-08T00:00:00.000Z',
      gewaehrleistung_rule_version: 'at-used-vehicle-vgg-2026-10-v2',
    });

    const patched = await request(app.getHttpServer())
      .patch(`/api/vehicle-sales/${created.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ handed_over_at: '2026-10-10' })
      .expect(200);
    expect(patched.body.gewaehrleistung_ends_on).toBe(
      '2028-10-10T00:00:00.000Z',
    );

    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${created.body.id}/finalize`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/vehicle-sales/${created.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ handed_over_at: '2026-10-11' })
      .expect(422);

    await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${created.body.id}/gewaehrleistung-correction`)
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .send({
        reason: 'Cross-tenant access check',
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: false,
      })
      .expect(404);

    const persisted = await prisma.vehicleSale.findFirstOrThrow({
      where: { id: created.body.id },
      select: { site_id: true },
    });
    if (persisted.site_id === null) throw new Error('vehicle sale has no site');
    await prisma.siteMembership.updateMany({
      where: { site_id: persisted.site_id },
      data: { is_active: false },
    });
    try {
      await request(app.getHttpServer())
        .post(
          `/api/vehicle-sales/${created.body.id}/gewaehrleistung-correction`,
        )
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reason: 'Cross-site access check',
          buyer_is_consumer: true,
          gewaehrleistung_shortened_negotiated: false,
        })
        .expect(404);
    } finally {
      await prisma.siteMembership.updateMany({
        where: { site_id: persisted.site_id },
        data: { is_active: true },
      });
    }

    const corrected = await request(app.getHttpServer())
      .post(`/api/vehicle-sales/${created.body.id}/gewaehrleistung-correction`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        reason: 'Übergabedatum wurde berichtigt',
        handed_over_at: '2026-10-11',
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: false,
      })
      .expect(201);
    expect(corrected.body.gewaehrleistung_ends_on).toBe(
      '2028-10-11T00:00:00.000Z',
    );

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        tenant_id: tenantId,
        entity_type: 'VehicleSale',
        entity_id: created.body.id,
      },
      orderBy: { occurred_at: 'desc' },
    });
    const actor = await prisma.user.findFirstOrThrow({
      where: { active_tenant_id: tenantId },
      select: { id: true },
    });
    expect(audit).toMatchObject({
      action: 'UPDATE',
      actor_user_id: actor.id,
      source: 'API',
      before: expect.objectContaining({ snapshot: expect.any(Object) }),
      after: expect.objectContaining({
        reason: 'Übergabedatum wurde berichtigt',
        snapshot: expect.any(Object),
      }),
    });
  });
});
