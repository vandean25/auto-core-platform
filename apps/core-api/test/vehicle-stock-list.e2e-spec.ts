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

  it('sorts stock vehicles by year when sortField=year', async () => {
    const older = await createAndReceive({
      vin: vin('YRASC1'),
      sellerType: 'VENDOR',
    });
    const newer = await createAndReceive({
      vin: vin('YRASC2'),
      sellerType: 'VENDOR',
    });

    await prisma.vehicle.update({
      where: { id: older.received.vehicle_id },
      data: { year: 2010 },
    });
    await prisma.vehicle.update({
      where: { id: newer.received.vehicle_id },
      data: { year: 2020 },
    });

    const listRes = await request(app.getHttpServer())
      .get('/api/vehicle-stock')
      .query({ sortField: 'year', sortDirection: 'asc', limit: '100' })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const years = listRes.body.data
      .filter((item: { id: string }) =>
        [older.received.vehicle_id, newer.received.vehicle_id].includes(
          item.id,
        ),
      )
      .map((item: { year: number }) => item.year);

    expect(years).toEqual([2010, 2020]);
  });

  it('rejects an invalid stock_status filter with 400', async () => {
    await request(app.getHttpServer())
      .get('/api/vehicle-stock')
      .query({ stock_status: 'NOT_A_STATUS' })
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);
  });

  it('exposes paginated reports only to the active tenant and site', async () => {
    const created = await createAndReceive({
      vin: vin('AGE-REPORT'),
      sellerType: 'VENDOR',
      price: 14500,
    });
    const vehicleId = created.received.vehicle_id;
    const ageResponse = await request(app.getHttpServer())
      .get('/api/vehicle-stock/reports/stock-age?page=1&limit=100')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(ageResponse.body.meta).toMatchObject({ page: 1, limit: 100 });
    expect(ageResponse.body.data).toContainEqual(
      expect.objectContaining({
        id: vehicleId,
        days_in_stock: expect.any(Number),
      }),
    );
    expect(ageResponse.body.summary).toEqual({
      over_90_count: expect.any(Number),
      over_90_cost_basis: expect.any(String),
      bucket_counts: {
        '0_30': expect.any(Number),
        '31_60': expect.any(Number),
        '61_90': expect.any(Number),
        '91_180': expect.any(Number),
        over_180: expect.any(Number),
      },
    });

    const otherTenantResponse = await request(app.getHttpServer())
      .get('/api/vehicle-stock/reports/stock-age')
      .set('Authorization', `Bearer ${otherAuthToken}`)
      .expect(200);
    expect(otherTenantResponse.body.data).not.toContainEqual(
      expect.objectContaining({ id: vehicleId }),
    );

    const marginResponse = await request(app.getHttpServer())
      .get(
        '/api/vehicle-stock/reports/margin?from=2026-01-01&to=2026-12-31&page=1&limit=10',
      )
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(marginResponse.body).toMatchObject({
      data: expect.any(Array),
      meta: { page: 1, limit: 10 },
      totals: {
        count: expect.any(Number),
        by_inventory_role: expect.any(Object),
      },
    });
  });
});
