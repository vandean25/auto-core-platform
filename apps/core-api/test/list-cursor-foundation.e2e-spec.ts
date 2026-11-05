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
      const tag = `tie-${Date.now()}`;
      const tiedMake = `TiedMake-${tag}`;
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const created = await createAndReceive({
          vin: vin(`TIE${i}${tag}`),
          sellerType: 'VENDOR',
        });
        ids.push(created.received.vehicle_id);
        await prisma.vehicle.update({
          where: { id: created.received.vehicle_id },
          data: { make: tiedMake, stock_status: VehicleStockStatus.IN_STOCK },
        });
      }

      const first = await listCursor({
        search: tag,
        sortField: 'make',
        sortDirection: 'asc',
        limit: '2',
      }).expect(200);

      expect(first.body.meta.hasNextPage).toBe(true);
      expect(first.body.meta.nextCursor).toEqual(expect.any(String));
      const firstIds = first.body.data.map((row: { id: string }) => row.id);

      const second = await listCursor({
        search: tag,
        sortField: 'make',
        sortDirection: 'asc',
        limit: '2',
        cursor: first.body.meta.nextCursor,
      }).expect(200);

      const seen = mergePageIdsWithoutOverlap(
        firstIds,
        second.body.data as { id: string }[],
      );
      expect(seen.size).toBe(3);
      expect([...seen].sort()).toEqual([...ids].sort());
    });

    it('WHEN the cursor crosses from non-NULL to NULL plate values THEN NULLS LAST ordering holds', async () => {
      const tag = `plate-${Date.now()}`;
      const withPlate = await createAndReceive({
        vin: vin(`PLATE1${tag}`),
        sellerType: 'VENDOR',
      });
      const nullPlate = await createAndReceive({
        vin: vin(`PLATE2${tag}`),
        sellerType: 'VENDOR',
      });
      await prisma.vehicle.update({
        where: { id: withPlate.received.vehicle_id },
        data: {
          make: tag,
          plate: 'W-100',
          stock_status: VehicleStockStatus.IN_STOCK,
        },
      });
      await prisma.vehicle.update({
        where: { id: nullPlate.received.vehicle_id },
        data: { make: tag, plate: null, stock_status: VehicleStockStatus.IN_STOCK },
      });

      const first = await listCursor({
        search: tag,
        sortField: 'plate',
        sortDirection: 'asc',
        limit: '1',
      }).expect(200);

      expect(first.body.data[0].plate).toBe('W-100');

      const second = await listCursor({
        search: tag,
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
      [
        'site id mismatch',
        async () => {
          const mainSiteId = await prisma.site.findFirstOrThrow({
            where: { tenant_id: tenantId, code: 'MAIN' },
            select: { id: true, legal_entity_id: true },
          });
          const foreignSite = await prisma.site.create({
            data: {
              tenant_id: tenantId,
              legal_entity_id: mainSiteId.legal_entity_id,
              code: `CURSOR-SITE-${Date.now()}`,
              name: 'Cursor foreign site',
              timezone: 'Europe/Vienna',
              slot_minutes: 30,
              holiday_country_iso: 'AT',
              is_active: true,
            },
          });
          return {
            token: authToken,
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
              sid: foreignSite.id,
              sv: new Date().toISOString(),
              id: '44444444-4444-4444-8444-444444444444',
            }),
            query: {},
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

    it('WHEN cursor mode sorts by stock_status THEN the API returns 400 LIST_CURSOR_SORT_UNSUPPORTED', async () => {
      const res = await listCursor({ sortField: 'stock_status' }).expect(400);
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

    it('WHEN capped-count has no stock status filter THEN the API returns 400 LIST_CURSOR_STOCK_FILTER_REQUIRED', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/vehicle-stock/capped-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(res.body.code).toBe('LIST_CURSOR_STOCK_FILTER_REQUIRED');
    });

    async function createTechToken() {
      const techUid = `tech-cursor-${tenantId}-${Date.now()}`;
      const techUser = await basePrisma.user.create({
        data: {
          firebaseUid: techUid,
          email: `${techUid}@example.com`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: techUser.id,
        role: 'TECH',
      });
      return createTestAuthToken(app.get(AuthService), {
        tenantId,
        firebaseUid: techUid,
        email: techUser.email,
        role: 'TECH',
      });
    }

    it.each([
      [
        'vehicle stock cursor list',
        '/api/vehicle-stock',
        {
          pagination: 'cursor',
          stock_status: VehicleStockStatus.IN_STOCK,
          limit: '10',
        },
      ],
      [
        'vehicle stock capped-count',
        '/api/vehicle-stock/capped-count',
        { stock_status: VehicleStockStatus.IN_STOCK },
      ],
    ])(
      'WHEN TECH role calls %s THEN the API returns 403',
      async (_label, path, query) => {
        const techToken = await createTechToken();
        await request(app.getHttpServer())
          .get(path)
          .query(query)
          .set('Authorization', `Bearer ${techToken}`)
          .expect(403);
      },
    );

    it('WHEN user has no active site THEN vehicle cursor list returns ACTIVE_SITE_REQUIRED', async () => {
      const user = await basePrisma.user.findFirstOrThrow({
        where: { firebaseUid: `e2e-user-${tenantId}` },
      });
      const previousSiteId = user.active_site_id;
      await basePrisma.user.update({
        where: { id: user.id },
        data: { active_site_id: null },
      });
      try {
        const res = await listCursor({ limit: '1' }).expect(422);
        expect(res.body.code).toBe('ACTIVE_SITE_REQUIRED');
      } finally {
        await basePrisma.user.update({
          where: { id: user.id },
          data: { active_site_id: previousSiteId },
        });
      }
    });

    it('WHEN cursor pages DESC by updatedAt THEN order is descending and pages cover all seeded rows', async () => {
      const tag = `desc-${Date.now()}`;
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const created = await createAndReceive({
          vin: vin(`DSC${i}${tag}`),
          sellerType: 'VENDOR',
        });
        ids.push(created.received.vehicle_id);
        await prisma.vehicle.update({
          where: { id: created.received.vehicle_id },
          data: {
            make: tag,
            stock_status: VehicleStockStatus.IN_STOCK,
          },
        });
      }
      const first = await listCursor({
        search: tag,
        sortField: 'updatedAt',
        sortDirection: 'desc',
        limit: '2',
      }).expect(200);
      const second = await listCursor({
        search: tag,
        sortField: 'updatedAt',
        sortDirection: 'desc',
        limit: '2',
        cursor: first.body.meta.nextCursor,
      }).expect(200);
      const seen = mergePageIdsWithoutOverlap(
        first.body.data.map((row: { id: string }) => row.id),
        second.body.data as { id: string }[],
      );
      expect(seen.size).toBe(3);
      expect([...seen].sort()).toEqual([...ids].sort());
      const combined = [...first.body.data, ...second.body.data] as {
        updatedAt: string;
      }[];
      for (let i = 1; i < combined.length; i += 1) {
        expect(new Date(combined[i - 1].updatedAt).getTime()).toBeGreaterThanOrEqual(
          new Date(combined[i].updatedAt).getTime(),
        );
      }
    });

    it('WHEN cursor limit exceeds pilot maximum THEN meta.limit is 50', async () => {
      const res = await listCursor({ limit: '999' }).expect(200);
      expect(res.body.meta.limit).toBe(50);
    });

    it('WHEN a scoped search matches one row THEN hasNextPage is false', async () => {
      const tag = `last-${Date.now()}`;
      const created = await createAndReceive({
        vin: vin(`LAST${tag}`),
        sellerType: 'VENDOR',
      });
      await prisma.vehicle.update({
        where: { id: created.received.vehicle_id },
        data: { make: tag, stock_status: VehicleStockStatus.IN_STOCK },
      });
      const res = await listCursor({
        search: tag,
        limit: '50',
      }).expect(200);
      expect(res.body.meta.hasNextPage).toBe(false);
      expect(res.body.meta.nextCursor).toBeNull();
    });

    it('WHEN 1,001 vehicles match capped-count filters THEN count is 1000 and isCapped true', async () => {
      const tag = `vcap-${Date.now()}`;
      const seed = await createAndReceive({
        vin: vin(`VCAP0${tag}`),
        sellerType: 'VENDOR',
      });
      const template = await prisma.vehicle.findFirstOrThrow({
        where: { id: seed.received.vehicle_id, tenant_id: tenantId },
        select: { site_id: true, location_id: true },
      });
      await prisma.vehicle.update({
        where: { id: seed.received.vehicle_id },
        data: { make: tag, stock_status: VehicleStockStatus.IN_STOCK },
      });
      const batch = Array.from({ length: 1000 }, (_, index) => ({
        tenant_id: tenantId,
        make: tag,
        model: `Cap ${index}`,
        year: 2020,
        vin: vin(`VCAPB${index}${tag}`),
        inventory_role: 'USED' as const,
        stock_status: VehicleStockStatus.IN_STOCK,
        site_id: template.site_id!,
        location_id: template.location_id!,
      }));
      await prisma.vehicle.createMany({ data: batch });

      const res = await request(app.getHttpServer())
        .get('/api/vehicle-stock/capped-count')
        .query({ search: tag, stock_status: VehicleStockStatus.IN_STOCK })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toEqual({ count: 1000, isCapped: true });
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

    it('WHEN inventory cursor pages DESC by sku THEN order is descending and pages cover all seeded rows', async () => {
      const tag = `sku-desc-${Date.now()}`;
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const item = await prisma.catalogItem.create({
          data: {
            tenant_id: tenantId,
            sku: `${tag}-z-${i}`,
            name: `${tag} item ${i}`,
            retail_price: 10 + i,
            cost_price: 1,
          },
        });
        ids.push(item.id);
      }

      const first = await listInventoryCursor({
        search: tag,
        sortField: 'sku',
        sortDirection: 'desc',
        limit: '2',
      }).expect(200);

      const second = await listInventoryCursor({
        search: tag,
        sortField: 'sku',
        sortDirection: 'desc',
        limit: '2',
        cursor: first.body.meta.nextCursor,
      }).expect(200);

      const seen = mergePageIdsWithoutOverlap(
        first.body.data.map((row: { id: string }) => row.id),
        second.body.data as { id: string }[],
      );
      expect(seen.size).toBe(3);
      expect([...seen].sort()).toEqual([...ids].sort());
      const skus = [...first.body.data, ...second.body.data].map(
        (row: { sku: string }) => row.sku,
      );
      for (let i = 1; i < skus.length; i += 1) {
        expect(skus[i - 1].localeCompare(skus[i])).toBeGreaterThanOrEqual(0);
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
      [
        'site id mismatch',
        async () => {
          const mainSite = await prisma.site.findFirstOrThrow({
            where: { tenant_id: tenantId, code: 'MAIN' },
            select: { legal_entity_id: true },
          });
          const foreignSite = await prisma.site.create({
            data: {
              tenant_id: tenantId,
              legal_entity_id: mainSite.legal_entity_id,
              code: `INV-SITE-${Date.now()}`,
              name: 'Inventory foreign site',
              timezone: 'Europe/Vienna',
              slot_minutes: 30,
              holiday_country_iso: 'AT',
              is_active: true,
            },
          });
          return {
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
              sid: foreignSite.id,
              sv: 'SKU-X',
              id: '55555555-5555-4555-8555-555555555555',
            }),
            query: {},
          };
        },
      ],
    ])(
      'WHEN inventory cursor binding is wrong (%s) THEN the API returns 400 LIST_CURSOR_INVALID',
      async (_label, buildCase) => {
        const { token, cursor, query } = await Promise.resolve(buildCase());
        const res = await listInventoryCursor({ cursor, ...query }, token).expect(
          400,
        );
        expect(res.body.code).toBe('LIST_CURSOR_INVALID');
      },
    );

    async function createInventoryTechToken(basePrisma: PrismaService) {
      const techUid = `tech-inv-${tenantId}-${Date.now()}`;
      const techUser = await basePrisma.user.create({
        data: {
          firebaseUid: techUid,
          email: `${techUid}@example.com`,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: techUser.id,
        role: 'TECH',
      });
      return createTestAuthToken(app.get(AuthService), {
        tenantId,
        firebaseUid: techUid,
        email: techUser.email,
        role: 'TECH',
      });
    }

    it.each([
      ['inventory cursor list', '/api/inventory', { pagination: 'cursor', limit: '10' }],
      ['inventory capped-count', '/api/inventory/capped-count', {}],
    ])(
      'WHEN TECH role calls %s THEN the API returns 403',
      async (_label, path, query) => {
        const basePrisma = app.get(PrismaService);
        const techToken = await createInventoryTechToken(basePrisma);
        await request(app.getHttpServer())
          .get(path)
          .query(query)
          .set('Authorization', `Bearer ${techToken}`)
          .expect(403);
      },
    );

    it('WHEN user has no active site THEN inventory cursor list returns ACTIVE_SITE_REQUIRED', async () => {
      const basePrisma = app.get(PrismaService);
      const user = await basePrisma.user.findFirstOrThrow({
        where: { firebaseUid: `e2e-user-${tenantId}` },
      });
      const previousSiteId = user.active_site_id;
      await basePrisma.user.update({
        where: { id: user.id },
        data: { active_site_id: null },
      });
      try {
        const res = await listInventoryCursor({ limit: '10' }).expect(422);
        expect(res.body.code).toBe('HTTP_422');
      } finally {
        await basePrisma.user.update({
          where: { id: user.id },
          data: { active_site_id: previousSiteId },
        });
      }
    });

    it('WHEN inventory cursor limit exceeds pilot maximum THEN meta.limit is 100', async () => {
      const res = await listInventoryCursor({ limit: '999' }).expect(200);
      expect(res.body.meta.limit).toBe(100);
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
