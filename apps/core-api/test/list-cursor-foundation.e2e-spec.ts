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
  createTestTenant,
  resolveTestMainSiteId,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

function mergePageIdsWithoutOverlap(
  firstPageIds: string[],
  secondPage: { id: string }[],
): Set<string> {
  const seen = new Set(firstPageIds);
  for (const row of secondPage) {
    expect(seen.has(row.id)).toBe(false);
    seen.add(row.id);
  }
  return seen;
}

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
      const firstIds = first.body.data.map((row: { id: string }) => row.id);

      const second = await listCursor({
        sortField: 'make',
        sortDirection: 'asc',
        limit: '2',
        cursor: first.body.meta.nextCursor,
      }).expect(200);

      const seen = mergePageIdsWithoutOverlap(
        firstIds,
        second.body.data as { id: string }[],
      );
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

    it.each([
      [
        'another tenant token',
        async () => ({
          token: otherAuthToken,
          cursor: encodeListCursor({
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
          }),
          query: {},
        }),
      ],
      [
        'filter hash mismatch',
        async () => {
          const siteId = (await prisma.site.findFirst({
            where: { tenant_id: tenantId },
          }))!.id;
          return {
            token: authToken,
            cursor: encodeListCursor({
              v: 1,
              ep: LIST_CURSOR_ENDPOINT.vehicleStock,
              sort: 'updatedAt',
              dir: 'desc',
              fh: hashListFilterContext({
                search: 'mismatch',
                stock_status: VehicleStockStatus.IN_STOCK,
              }),
              tid: tenantId,
              sid: siteId,
              sv: new Date().toISOString(),
              id: '44444444-4444-4444-8444-444444444444',
            }),
            query: { search: '' },
          };
        },
      ],
      [
        'endpoint mismatch',
        async () => {
          const siteId = (await prisma.site.findFirst({
            where: { tenant_id: tenantId },
          }))!.id;
          return {
            token: authToken,
            cursor: encodeListCursor({
              v: 1,
              ep: LIST_CURSOR_ENDPOINT.inventory,
              sort: 'updatedAt',
              dir: 'desc',
              fh: hashListFilterContext({
                search: '',
                stock_status: VehicleStockStatus.IN_STOCK,
              }),
              tid: tenantId,
              sid: siteId,
              sv: new Date().toISOString(),
              id: '44444444-4444-4444-8444-444444444444',
            }),
            query: {},
          };
        },
      ],
      [
        'sort field mismatch',
        async () => {
          const siteId = (await prisma.site.findFirst({
            where: { tenant_id: tenantId },
          }))!.id;
          return {
            token: authToken,
            cursor: encodeListCursor({
              v: 1,
              ep: LIST_CURSOR_ENDPOINT.vehicleStock,
              sort: 'make',
              dir: 'asc',
              fh: hashListFilterContext({
                search: '',
                stock_status: VehicleStockStatus.IN_STOCK,
              }),
              tid: tenantId,
              sid: siteId,
              sv: 'Audi',
              id: '44444444-4444-4444-8444-444444444444',
            }),
            query: { sortField: 'model', sortDirection: 'asc' },
          };
        },
      ],
      [
        'sort direction mismatch',
        async () => {
          const siteId = (await prisma.site.findFirst({
            where: { tenant_id: tenantId },
          }))!.id;
          return {
            token: authToken,
            cursor: encodeListCursor({
              v: 1,
              ep: LIST_CURSOR_ENDPOINT.vehicleStock,
              sort: 'updatedAt',
              dir: 'asc',
              fh: hashListFilterContext({
                search: '',
                stock_status: VehicleStockStatus.IN_STOCK,
              }),
              tid: tenantId,
              sid: siteId,
              sv: new Date().toISOString(),
              id: '44444444-4444-4444-8444-444444444444',
            }),
            query: { sortDirection: 'desc' },
          };
        },
      ],
    ])(
      'WHEN cursor binding is wrong (%s) THEN the API returns 400 LIST_CURSOR_INVALID',
      async (_label, buildCase) => {
        const { token, cursor, query } = await buildCase();
        const res = await request(app.getHttpServer())
          .get('/api/vehicle-stock')
          .query({
            pagination: 'cursor',
            stock_status: VehicleStockStatus.IN_STOCK,
            cursor,
            ...query,
          })
          .set('Authorization', `Bearer ${token}`)
          .expect(400);

        expect(res.body.code).toBe('LIST_CURSOR_INVALID');
      },
    );

    it('WHEN cursor mode uses an unsupported sort field THEN the API returns 400 LIST_CURSOR_SORT_UNSUPPORTED', async () => {
      const res = await listCursor({ sortField: 'brand' }).expect(400);
      expect(res.body.code).toBe('LIST_CURSOR_SORT_UNSUPPORTED');
    });

    it('WHEN cursor mode has no stock status filter THEN the API returns 400 LIST_CURSOR_STOCK_FILTER_REQUIRED', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/vehicle-stock')
        .query({ pagination: 'cursor', limit: '10' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(res.body.code).toBe('LIST_CURSOR_STOCK_FILTER_REQUIRED');
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

  describe('inventory pilot', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let tenantId: string;
    let otherTenantId: string;
    let authToken: string;
    let otherAuthToken: string;
    let siteId: string;

    beforeEach(async () => {
      app = await createE2eApp(undefined, { productionErrorFilter: true });
      const basePrisma = app.get(PrismaService);
      const ctx = await createE2eTenant(app, basePrisma, 'list-cursor-inv');
      tenantId = ctx.tenantId;
      prisma = ctx.prisma;
      authToken = ctx.authToken;
      siteId = await resolveTestMainSiteId(basePrisma, tenantId);
      const otherTenant = await createTestTenant(basePrisma, 'list-cursor-inv-other');
      otherTenantId = otherTenant.tenantId;
      otherAuthToken = createTestAuthToken(app.get(AuthService), otherTenant);
    });

    afterEach(async () => {
      if (otherTenantId) {
        await cleanupTestTenantGraph(prisma, otherTenantId);
        otherTenantId = '';
      }
      if (tenantId) {
        await cleanupTestTenantGraph(prisma, tenantId);
        tenantId = '';
      }
      await teardownTestApp(app, prisma);
    });

    function listInventoryCursor(query: Record<string, string>, token = authToken) {
      return request(app.getHttpServer())
        .get('/api/inventory')
        .query({ pagination: 'cursor', ...query })
        .set('Authorization', `Bearer ${token}`);
    }

    it('WHEN cursor pages sort by price with tied values THEN rows neither repeat nor skip', async () => {
      const tag = `price-tie-${Date.now()}`;
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const item = await prisma.catalogItem.create({
          data: {
            tenant_id: tenantId,
            sku: `${tag}-${i}`,
            name: `${tag} item ${i}`,
            retail_price: i < 2 ? 42.5 : 99,
            cost_price: 1,
          },
        });
        ids.push(item.id);
      }

      const first = await listInventoryCursor({
        search: tag,
        sortField: 'price',
        sortDirection: 'asc',
        limit: '2',
      }).expect(200);

      expect(first.body.meta.hasNextPage).toBe(true);
      const firstIds = first.body.data.map((row: { id: string }) => row.id);

      const second = await listInventoryCursor({
        search: tag,
        sortField: 'price',
        sortDirection: 'asc',
        limit: '2',
        cursor: first.body.meta.nextCursor,
      }).expect(200);

      const seen = mergePageIdsWithoutOverlap(
        firstIds,
        second.body.data as { id: string }[],
      );
      for (const id of ids) {
        expect(seen.has(id)).toBe(true);
      }
    });

    it('WHEN cursor mode uses an unsupported inventory sort THEN the API returns 400 LIST_CURSOR_SORT_UNSUPPORTED', async () => {
      const res = await listInventoryCursor({ sortField: 'status' }).expect(400);
      expect(res.body.code).toBe('LIST_CURSOR_SORT_UNSUPPORTED');
    });

    it.each([
      [
        'another tenant token',
        () => ({
          token: otherAuthToken,
          cursor: encodeListCursor({
            v: 1,
            ep: LIST_CURSOR_ENDPOINT.inventory,
            sort: 'sku',
            dir: 'asc',
            fh: hashListFilterContext({
              search: '',
              location: '',
              brand: '',
              brandId: null,
            }),
            tid: tenantId,
            sid: siteId,
            sv: 'SKU-X',
            id: '55555555-5555-4555-8555-555555555555',
          }),
          query: {},
        }),
      ],
      [
        'filter hash mismatch',
        () => ({
          token: authToken,
          cursor: encodeListCursor({
            v: 1,
            ep: LIST_CURSOR_ENDPOINT.inventory,
            sort: 'sku',
            dir: 'asc',
            fh: hashListFilterContext({
              search: 'other-filter',
              location: '',
              brand: '',
              brandId: null,
            }),
            tid: tenantId,
            sid: siteId,
            sv: 'SKU-X',
            id: '55555555-5555-4555-8555-555555555555',
          }),
          query: { search: '' },
        }),
      ],
      [
        'endpoint mismatch',
        () => ({
          token: authToken,
          cursor: encodeListCursor({
            v: 1,
            ep: LIST_CURSOR_ENDPOINT.vehicleStock,
            sort: 'sku',
            dir: 'asc',
            fh: hashListFilterContext({
              search: '',
              location: '',
              brand: '',
              brandId: null,
            }),
            tid: tenantId,
            sid: siteId,
            sv: 'SKU-X',
            id: '55555555-5555-4555-8555-555555555555',
          }),
          query: {},
        }),
      ],
      [
        'sort field mismatch',
        () => ({
          token: authToken,
          cursor: encodeListCursor({
            v: 1,
            ep: LIST_CURSOR_ENDPOINT.inventory,
            sort: 'sku',
            dir: 'asc',
            fh: hashListFilterContext({
              search: '',
              location: '',
              brand: '',
              brandId: null,
            }),
            tid: tenantId,
            sid: siteId,
            sv: 'SKU-X',
            id: '55555555-5555-4555-8555-555555555555',
          }),
          query: { sortField: 'name' },
        }),
      ],
      [
        'sort direction mismatch',
        () => ({
          token: authToken,
          cursor: encodeListCursor({
            v: 1,
            ep: LIST_CURSOR_ENDPOINT.inventory,
            sort: 'sku',
            dir: 'asc',
            fh: hashListFilterContext({
              search: '',
              location: '',
              brand: '',
              brandId: null,
            }),
            tid: tenantId,
            sid: siteId,
            sv: 'SKU-X',
            id: '55555555-5555-4555-8555-555555555555',
          }),
          query: { sortDirection: 'desc' },
        }),
      ],
    ])(
      'WHEN inventory cursor binding is wrong (%s) THEN the API returns 400 LIST_CURSOR_INVALID',
      async (_label, buildCase) => {
        const { token, cursor, query } = buildCase();
        const res = await listInventoryCursor({ cursor, ...query }, token).expect(
          400,
        );
        expect(res.body.code).toBe('LIST_CURSOR_INVALID');
      },
    );

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
