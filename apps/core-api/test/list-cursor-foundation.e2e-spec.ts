import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { encodeListCursor } from '../src/common/list-cursor/index.js';
import { LIST_CURSOR_ENDPOINT } from '../src/common/list-cursor/list-cursor.constants.js';
import { hashListFilterContext } from '../src/common/list-cursor/list-cursor.filter-hash.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { VehicleStockStatus } from '@prisma/client';
import { createE2eApp, createE2eTenant } from './helpers/e2e-suite.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  vin,
} from './helpers/vehicle-stock-suite.js';
import {
  cleanupTestTenantGraph,
  createTestAuthToken,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('List cursor foundation (AUT-888 e2e)', () => {
  describe('vehicle stock pilot', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let basePrisma: PrismaService;
    let tenantId: string;
    let otherTenantId: string;
    let authToken: string;
    let otherAuthToken: string;
    let createAndReceive: Awaited<
      ReturnType<typeof createVehicleStockSuite>
    >['createAndReceive'];

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
      } = await createVehicleStockSuite({
        configureModule: (builder) => builder,
      }));
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

    function listCursor(query: Record<string, string>) {
      return request(app.getHttpServer())
        .get('/api/vehicle-stock')
        .query({ pagination: 'cursor', stock_status: VehicleStockStatus.IN_STOCK, ...query })
        .set('Authorization', `Bearer ${authToken}`);
    }

    it('WHEN cursor pages use ASC sort with tied values THEN rows neither repeat nor skip', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const created = await createAndReceive({
          vin: vin(`TIE${i}`),
          sellerType: 'VENDOR',
        });
        ids.push(created.received.vehicle_id);
        await prisma.vehicle.update({
          where: { id: created.received.vehicle_id },
          data: { make: 'TiedMake', stock_status: VehicleStockStatus.IN_STOCK },
        });
      }

      const first = await listCursor({
        sortField: 'make',
        sortDirection: 'asc',
        limit: '2',
      }).expect(200);

      expect(first.body.meta.hasNextPage).toBe(true);
      expect(first.body.meta.nextCursor).toEqual(expect.any(String));
      const seen = new Set(first.body.data.map((row: { id: string }) => row.id));

      const second = await listCursor({
        sortField: 'make',
        sortDirection: 'asc',
        limit: '2',
        cursor: first.body.meta.nextCursor,
      }).expect(200);

      for (const row of second.body.data as { id: string }[]) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      expect(seen.size).toBeGreaterThanOrEqual(3);
      for (const id of ids) {
        expect(seen.has(id)).toBe(true);
      }
    });

    it('WHEN the cursor crosses from non-NULL to NULL plate values THEN NULLS LAST ordering holds', async () => {
      const withPlate = await createAndReceive({
        vin: vin('PLATE1'),
        sellerType: 'VENDOR',
      });
      const nullPlate = await createAndReceive({
        vin: vin('PLATE2'),
        sellerType: 'VENDOR',
      });
      await prisma.vehicle.update({
        where: { id: withPlate.received.vehicle_id },
        data: {
          plate: 'W-100',
          stock_status: VehicleStockStatus.IN_STOCK,
        },
      });
      await prisma.vehicle.update({
        where: { id: nullPlate.received.vehicle_id },
        data: { plate: null, stock_status: VehicleStockStatus.IN_STOCK },
      });

      const first = await listCursor({
        sortField: 'plate',
        sortDirection: 'asc',
        limit: '1',
      }).expect(200);

      expect(first.body.data[0].plate).toBe('W-100');

      const second = await listCursor({
        sortField: 'plate',
        sortDirection: 'asc',
        limit: '5',
        cursor: first.body.meta.nextCursor,
      }).expect(200);

      const nullRow = second.body.data.find(
        (row: { id: string }) => row.id === nullPlate.received.vehicle_id,
      );
      expect(nullRow?.plate).toBeNull();
    });

    it('WHEN a cursor from another tenant is sent THEN the API returns 400 LIST_CURSOR_INVALID', async () => {
      const foreignCursor = encodeListCursor({
        v: 1,
        ep: LIST_CURSOR_ENDPOINT.vehicleStock,
        sort: 'updatedAt',
        dir: 'desc',
        fh: hashListFilterContext({
          search: '',
          stock_status: VehicleStockStatus.IN_STOCK,
        }),
        tid: tenantId,
        sid: (await prisma.site.findFirst({ where: { tenant_id: tenantId } }))!.id,
        sv: new Date().toISOString(),
        id: '44444444-4444-4444-8444-444444444444',
      });

      const res = await request(app.getHttpServer())
        .get('/api/vehicle-stock')
        .query({
          pagination: 'cursor',
          stock_status: VehicleStockStatus.IN_STOCK,
          cursor: foreignCursor,
        })
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .expect(400);

      expect(res.body.code).toBe('LIST_CURSOR_INVALID');
    });

    it('WHEN a role without vehicle stock list permission uses cursor mode THEN the API returns 403', async () => {
      const techUid = `tech-cursor-${tenantId}`;
      const techUser = await basePrisma.user.create({
        data: {
          firebaseUid: techUid,
          email: `tech-cursor-${tenantId}@example.com`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: techUser.id,
        role: 'TECH',
      });
      const techToken = createTestAuthToken(app.get(AuthService), {
        tenantId,
        firebaseUid: techUid,
        email: techUser.email,
        role: 'TECH',
      });

      await request(app.getHttpServer())
        .get('/api/vehicle-stock')
        .query({
          pagination: 'cursor',
          stock_status: VehicleStockStatus.IN_STOCK,
          limit: '10',
        })
        .set('Authorization', `Bearer ${techToken}`)
        .expect(403);
    });
  });

  describe('inventory capped count', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let tenantId: string;
    let authToken: string;

    beforeEach(async () => {
      app = await createE2eApp(undefined, { productionErrorFilter: true });
      const basePrisma = app.get(PrismaService);
      const ctx = await createE2eTenant(app, basePrisma, 'list-cursor-count');
      tenantId = ctx.tenantId;
      prisma = ctx.prisma;
      authToken = ctx.authToken;
    });

    afterEach(async () => {
      if (tenantId) {
        await cleanupTestTenantGraph(prisma, tenantId);
        tenantId = '';
      }
      await teardownTestApp(app, prisma);
    });

    it('WHEN 1,001 or more catalog rows match THEN capped count returns count 1000 and isCapped true', async () => {
      const batch = Array.from({ length: 1001 }, (_, index) => ({
        tenant_id: tenantId,
        sku: `CAP-${index.toString().padStart(4, '0')}`,
        name: `Cap item ${index}`,
        retail_price: 10,
        cost_price: 5,
      }));
      await prisma.catalogItem.createMany({ data: batch });

      const res = await request(app.getHttpServer())
        .get('/api/inventory/capped-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toEqual({ count: 1000, isCapped: true });
    });
  });
});
