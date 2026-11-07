import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { encodeListCursor } from '../src/common/list-cursor/index.js';
import { LIST_CURSOR_ENDPOINT } from '../src/common/list-cursor/list-cursor.constants.js';
import { hashListFilterContext } from '../src/common/list-cursor/list-cursor.filter-hash.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InvoiceStatus, VehicleStockStatus } from '@prisma/client';
import { createE2eApp, createE2eTenant } from './helpers/e2e-suite.js';
import {
  createVehicleStockSuite,
  disposeVehicleStockSuite,
  vin,
} from './helpers/vehicle-stock-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { seedReadySellerAndAccountingProfile } from './invoice-snapshot-v2-test-utils.js';
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

/** Own tenant plus a second tenant, on one app, for the isolation checks (inventory and invoice suites). */
async function startTenantPair(prefix: string) {
  const app = await createE2eApp(undefined, { productionErrorFilter: true });
  const basePrisma = app.get(PrismaService);
  const ctx = await createE2eTenant(app, basePrisma, prefix);
  const otherTenant = await createTestTenant(basePrisma, `${prefix}-other`);
  return {
    app,
    prisma: ctx.prisma,
    tenantId: ctx.tenantId,
    authToken: ctx.authToken,
    otherTenantId: otherTenant.tenantId,
    otherAuthToken: createTestAuthToken(app.get(AuthService), otherTenant),
  };
}

async function stopTenantPair(
  suite: { app: INestApplication; prisma: PrismaService },
  tenantIds: string[],
) {
  for (const id of tenantIds) {
    if (id) await cleanupTestTenantGraph(suite.prisma, id);
  }
  await teardownTestApp(suite.app, suite.prisma);
}

/** A TECH member of `tenantId`: the role without stock or invoice access. */
async function createTechToken(app: INestApplication, tenantId: string, label: string) {
  const basePrisma = app.get(PrismaService);
  const techUid = `tech-${label}-${tenantId}-${Date.now()}`;
  const techUser = await basePrisma.user.create({
    data: { firebaseUid: techUid, email: `${techUid}@example.com` },
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
    let createAdditionalLotSite: Awaited<
      ReturnType<typeof createVehicleStockSuite>
    >['createAdditionalLotSite'];

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
        createAdditionalLotSite,
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

    it.each(['constructor', 'toString'])(
      'WHEN cursor sortField is inherited property %s THEN the API returns 400 LIST_CURSOR_SORT_UNSUPPORTED',
      async (sortField) => {
        const res = await listCursor({ sortField }).expect(400);
        expect(res.body.code).toBe('LIST_CURSOR_SORT_UNSUPPORTED');
      },
    );

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

    function createVehicleTechToken() {
      return createTechToken(app, tenantId, 'cursor');
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
        const techToken = await createVehicleTechToken();
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

    it('WHEN vehicle cursor omits limit THEN meta.limit defaults to 25', async () => {
      const res = await listCursor({}).expect(200);
      expect(res.body.meta.limit).toBe(25);
    });

    it('WHEN filters match no rows THEN cursor list returns an empty page', async () => {
      const res = await listCursor({
        search: `no-match-${Date.now()}-cursor`,
      }).expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.hasNextPage).toBe(false);
      expect(res.body.meta.nextCursor).toBeNull();
    });

    it('WHEN every row in scope has NULL plate THEN paging plate ASC covers all rows', async () => {
      const tag = `null-plate-only-${Date.now()}`;
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const created = await createAndReceive({
          vin: vin(`NPL${i}${tag}`),
          sellerType: 'VENDOR',
        });
        ids.push(created.received.vehicle_id);
        await prisma.vehicle.update({
          where: { id: created.received.vehicle_id },
          data: {
            make: tag,
            plate: null,
            stock_status: VehicleStockStatus.IN_STOCK,
          },
        });
      }

      const first = await listCursor({
        search: tag,
        sortField: 'plate',
        sortDirection: 'asc',
        limit: '2',
      }).expect(200);

      const second = await listCursor({
        search: tag,
        sortField: 'plate',
        sortDirection: 'asc',
        limit: '2',
        cursor: first.body.meta.nextCursor,
      }).expect(200);

      const seen = mergePageIdsWithoutOverlap(
        first.body.data.map((row: { id: string }) => row.id),
        second.body.data as { id: string }[],
      );
      expect(seen.size).toBe(3);
      expect([...seen].sort()).toEqual([...ids].sort());
    });

    it('WHEN cursor pages nullable vin DESC THEN order is descending without repeats', async () => {
      const tag = `vin-desc-${Date.now()}`;
      const orderedVins = [
        vin(`VINZ${tag}`),
        vin(`VINM${tag}`),
        vin(`VINA${tag}`),
      ];
      const ids: string[] = [];
      for (const vehicleVin of orderedVins) {
        const created = await createAndReceive({
          vin: vehicleVin,
          sellerType: 'VENDOR',
        });
        ids.push(created.received.vehicle_id);
        await prisma.vehicle.update({
          where: { id: created.received.vehicle_id },
          data: { make: tag, stock_status: VehicleStockStatus.IN_STOCK },
        });
      }

      const first = await listCursor({
        search: tag,
        sortField: 'vin',
        sortDirection: 'desc',
        limit: '2',
      }).expect(200);

      const second = await listCursor({
        search: tag,
        sortField: 'vin',
        sortDirection: 'desc',
        limit: '2',
        cursor: first.body.meta.nextCursor,
      }).expect(200);

      const seen = mergePageIdsWithoutOverlap(
        first.body.data.map((row: { id: string }) => row.id),
        second.body.data as { id: string }[],
      );
      expect(seen.size).toBe(3);
      const combined = [...first.body.data, ...second.body.data] as {
        vin: string;
      }[];
      for (let i = 1; i < combined.length; i += 1) {
        expect(combined[i - 1].vin.localeCompare(combined[i].vin)).toBeGreaterThanOrEqual(
          0,
        );
      }
    });

    it('WHEN another tenant owns matching stock THEN cursor list and capped-count stay tenant-scoped', async () => {
      const tag = `iso-tenant-${Date.now()}`;
      const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenantId);
      await seedReadySellerAndAccountingProfile(otherPrisma, otherTenantId, {
        includeVehicleMargin: true,
      });
      const foreignVendor = await otherPrisma.vendor.create({
        data: {
          tenant_id: otherTenantId,
          name: 'Foreign vendor',
          email: `foreign-${tag}@example.com`,
          account_number: `FV-${tag.slice(-6)}`,
        },
      });
      const foreignCreate = await request(app.getHttpServer())
        .post('/api/vehicle-purchases')
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .send({
          seller_type: 'VENDOR',
          vendor_id: foreignVendor.id,
          vin: vin(`ISOOTH${tag}`),
          make: tag,
          model: 'Golf',
          year: 2018,
          purchase_price: 10000,
        })
        .expect(201);
      const foreignReceive = await request(app.getHttpServer())
        .post(`/api/vehicle-purchases/${foreignCreate.body.id}/receive`)
        .set('Authorization', `Bearer ${otherAuthToken}`)
        .expect(201);
      await otherPrisma.vehicle.update({
        where: { id: foreignReceive.body.vehicle_id },
        data: { stock_status: VehicleStockStatus.IN_STOCK },
      });

      const home = await createAndReceive({
        vin: vin(`ISOHOME${tag}`),
        sellerType: 'VENDOR',
      });
      await prisma.vehicle.update({
        where: { id: home.received.vehicle_id },
        data: { make: tag, stock_status: VehicleStockStatus.IN_STOCK },
      });

      const list = await listCursor({ search: tag, limit: '50' }).expect(200);
      expect(list.body.data.some((row: { id: string }) => row.id === foreignReceive.body.vehicle_id)).toBe(
        false,
      );
      expect(list.body.data.some((row: { id: string }) => row.id === home.received.vehicle_id)).toBe(
        true,
      );

      const count = await request(app.getHttpServer())
        .get('/api/vehicle-stock/capped-count')
        .query({ search: tag, stock_status: VehicleStockStatus.IN_STOCK })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      expect(count.body).toEqual({ count: 1, isCapped: false });
    });

    it('WHEN stock sits at an unauthorized site THEN cursor list and capped-count omit it', async () => {
      const hidden = await createAdditionalLotSite({
        code: `ISO-${Date.now().toString().slice(-8)}`,
        grantMembership: false,
      });
      const tag = `iso-site-${Date.now()}`;
      const visible = await createAndReceive({
        vin: vin(`VIS${tag}`),
        sellerType: 'VENDOR',
      });
      await prisma.vehicle.update({
        where: { id: visible.received.vehicle_id },
        data: { make: tag, stock_status: VehicleStockStatus.IN_STOCK },
      });
      const offSite = await createAndReceive({
        vin: vin(`HID${tag}`),
        sellerType: 'VENDOR',
      });
      await prisma.vehicle.update({
        where: { id: offSite.received.vehicle_id },
        data: {
          make: tag,
          stock_status: VehicleStockStatus.IN_STOCK,
          site_id: hidden.site.id,
          location_id: hidden.lot.id,
        },
      });

      const list = await listCursor({ search: tag, limit: '50' }).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(visible.received.vehicle_id);

      const count = await request(app.getHttpServer())
        .get('/api/vehicle-stock/capped-count')
        .query({ search: tag, stock_status: VehicleStockStatus.IN_STOCK })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      expect(count.body).toEqual({ count: 1, isCapped: false });
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
      ({ app, prisma, tenantId, authToken, otherTenantId, otherAuthToken } =
        await startTenantPair('list-cursor-inv'));
      siteId = await resolveTestMainSiteId(app.get(PrismaService), tenantId);
    });

    afterEach(async () => {
      await stopTenantPair({ app, prisma }, [otherTenantId, tenantId]);
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

    it.each(['constructor', 'toString'])(
      'WHEN inventory cursor sortField is inherited property %s THEN the API returns 400 LIST_CURSOR_SORT_UNSUPPORTED',
      async (sortField) => {
        const res = await listInventoryCursor({ sortField }).expect(400);
        expect(res.body.code).toBe('LIST_CURSOR_SORT_UNSUPPORTED');
      },
    );

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

    it.each([
      ['inventory cursor list', '/api/inventory', { pagination: 'cursor', limit: '10' }],
      ['inventory capped-count', '/api/inventory/capped-count', {}],
    ])(
      'WHEN TECH role calls %s THEN the API returns 403',
      async (_label, path, query) => {
        const techToken = await createTechToken(app, tenantId, 'inv');
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

    it('WHEN inventory cursor omits limit THEN meta.limit defaults to 10', async () => {
      const res = await listInventoryCursor({}).expect(200);
      expect(res.body.meta.limit).toBe(10);
    });

    it('WHEN inventory filters match no rows THEN cursor list returns an empty page', async () => {
      const res = await listInventoryCursor({
        search: `no-match-${Date.now()}-inv`,
      }).expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.hasNextPage).toBe(false);
      expect(res.body.meta.nextCursor).toBeNull();
    });

    it('WHEN the cursor anchor row was deleted THEN the next inventory page still succeeds', async () => {
      const tag = `del-row-${Date.now()}`;
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const item = await prisma.catalogItem.create({
          data: {
            tenant_id: tenantId,
            sku: `${tag}-${i}`,
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
        sortDirection: 'asc',
        limit: '1',
      }).expect(200);

      const deletedId = first.body.data[0].id as string;
      const cursor = first.body.meta.nextCursor as string;
      await prisma.catalogItem.delete({ where: { id: deletedId } });

      const second = await listInventoryCursor({
        search: tag,
        sortField: 'sku',
        sortDirection: 'asc',
        limit: '10',
        cursor,
      }).expect(200);

      expect(
        second.body.data.find((row: { id: string }) => row.id === deletedId),
      ).toBeUndefined();
      expect(second.body.data.length).toBe(2);
      for (const id of ids) {
        if (id === deletedId) continue;
        expect(second.body.data.some((row: { id: string }) => row.id === id)).toBe(
          true,
        );
      }
    });

    it('WHEN another tenant owns catalog rows THEN inventory list and capped-count stay tenant-scoped', async () => {
      const tag = `iso-inv-${Date.now()}`;
      const basePrisma = app.get(PrismaService);
      const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenantId);
      await otherPrisma.catalogItem.create({
        data: {
          tenant_id: otherTenantId,
          sku: `${tag}-foreign`,
          name: `${tag} foreign`,
          retail_price: 99,
          cost_price: 1,
        },
      });
      await prisma.catalogItem.create({
        data: {
          tenant_id: tenantId,
          sku: `${tag}-home`,
          name: `${tag} home`,
          retail_price: 10,
          cost_price: 1,
        },
      });

      const list = await listInventoryCursor({ search: tag, limit: '50' }).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].sku).toBe(`${tag}-home`);

      const count = await request(app.getHttpServer())
        .get('/api/inventory/capped-count')
        .query({ search: tag })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
      expect(count.body).toEqual({ count: 1, isCapped: false });
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
  describe('invoice list (AUT-891)', () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let tenantId: string;
    let otherTenantId: string;
    let authToken: string;
    let customerId: string;

    beforeEach(async () => {
      ({ app, prisma, tenantId, authToken, otherTenantId } =
        await startTenantPair('list-cursor-inv-doc'));
      customerId = (
        await prisma.customer.create({
          data: { tenant_id: tenantId, first_name: 'Erika', last_name: 'Musterfrau' },
        })
      ).id;
    });

    afterEach(async () => {
      await stopTenantPair({ app, prisma }, [otherTenantId, tenantId]);
    });

    function invoiceRow(
      overrides: Partial<{
        invoice_number: string | null;
        status: InvoiceStatus;
        date: Date;
        customer_id: string;
        tenant_id: string;
      }> = {},
    ) {
      return {
        tenant_id: tenantId,
        customer_id: customerId,
        status: InvoiceStatus.FINALIZED,
        date: new Date('2026-01-01T10:00:00.000Z'),
        due_date: new Date('2026-01-15T10:00:00.000Z'),
        total_net: 100,
        total_tax: 20,
        total_gross: 120,
        ...overrides,
      };
    }

    function listInvoiceCursor(query: Record<string, string>, token = authToken) {
      return request(app.getHttpServer())
        .get('/api/sales/invoices')
        .query({ pagination: 'cursor', ...query })
        .set('Authorization', `Bearer ${token}`);
    }

    async function pageThrough(
      query: Record<string, string>,
    ): Promise<{ id: string; invoice_number: string | null }[]> {
      const rows: { id: string; invoice_number: string | null }[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard += 1) {
        const res = await listInvoiceCursor({
          ...query,
          ...(cursor ? { cursor } : {}),
        }).expect(200);
        rows.push(...res.body.data);
        cursor = res.body.meta.nextCursor ?? undefined;
        if (!cursor) return rows;
      }
      throw new Error('cursor chain did not end');
    }

    // Scenario 1: strict number order across blocks, drafts (no number) last in both directions.
    it.each([
      ['asc', [1, 2, 3, 4, 5, 6, 7]],
      ['desc', [7, 6, 5, 4, 3, 2, 1]],
    ])(
      'WHEN invoices are paged by number %s THEN blocks continue in strict number order without gaps or repeats and drafts come last',
      async (direction, expectedNumbers) => {
        const numbers = [4, 1, 7, 3, 6, 2, 5].map(
          (n) => `RE-2026-${String(n).padStart(4, '0')}`,
        );
        await prisma.invoice.createMany({
          data: [
            ...numbers.map((invoice_number) => invoiceRow({ invoice_number })),
            invoiceRow({ invoice_number: null, status: InvoiceStatus.DRAFT }),
            invoiceRow({ invoice_number: null, status: InvoiceStatus.DRAFT }),
          ],
        });

        const rows = await pageThrough({
          sortField: 'invoice_number',
          sortDirection: direction,
          limit: '3',
        });

        expect(rows.map((row) => row.invoice_number)).toEqual([
          ...expectedNumbers.map((n) => `RE-2026-${String(n).padStart(4, '0')}`),
          null,
          null,
        ]);
        expect(new Set(rows.map((row) => row.id)).size).toBe(9);
      },
    );

    it('WHEN many invoices share one date THEN date blocks break the tie by id without gaps or repeats (stable date order)', async () => {
      await prisma.invoice.createMany({
        data: Array.from({ length: 7 }, (_, index) =>
          invoiceRow({ invoice_number: `RE-2026-${100 + index}` }),
        ),
      });
      await prisma.invoice.createMany({
        data: [
          invoiceRow({
            invoice_number: 'RE-2026-200',
            date: new Date('2026-03-01T10:00:00.000Z'),
          }),
        ],
      });

      const rows = await pageThrough({
        sortField: 'date',
        sortDirection: 'desc',
        limit: '2',
      });

      expect(rows).toHaveLength(8);
      expect(rows[0].invoice_number).toBe('RE-2026-200');
      const tied = rows.slice(1).map((row) => row.id);
      expect(tied).toEqual([...tied].sort().reverse());
      expect(new Set(rows.map((row) => row.id)).size).toBe(8);
    });

    it('WHEN no sort is requested THEN the newest invoice comes first and meta.limit defaults to 25', async () => {
      await prisma.invoice.createMany({
        data: [
          invoiceRow({ date: new Date('2026-01-01T00:00:00.000Z'), invoice_number: 'OLD' }),
          invoiceRow({ date: new Date('2026-06-01T00:00:00.000Z'), invoice_number: 'NEW' }),
        ],
      });

      const res = await listInvoiceCursor({}).expect(200);

      expect(res.body.data.map((row: { invoice_number: string }) => row.invoice_number)).toEqual(['NEW', 'OLD']);
      expect(res.body.meta).toEqual({ nextCursor: null, hasNextPage: false, limit: 25 });
    });

    it('WHEN the requested limit exceeds the ceiling THEN meta.limit is clamped to 100', async () => {
      const res = await listInvoiceCursor({ limit: '500' }).expect(200);

      expect(res.body.meta.limit).toBe(100);
    });

    it.each(['customer', 'status', 'total_gross', 'constructor'])(
      'WHEN cursor mode sorts by %s THEN the API returns 400 LIST_CURSOR_SORT_UNSUPPORTED',
      async (sortField) => {
        const res = await listInvoiceCursor({ sortField }).expect(400);

        expect(res.body.code).toBe('LIST_CURSOR_SORT_UNSUPPORTED');
      },
    );

    it('WHEN a cursor is replayed with a different search THEN the API returns 400 LIST_CURSOR_INVALID', async () => {
      await prisma.invoice.createMany({
        data: [invoiceRow({ invoice_number: 'A-1' }), invoiceRow({ invoice_number: 'A-2' })],
      });
      const first = await listInvoiceCursor({ limit: '1', search: 'A-' }).expect(200);

      const res = await listInvoiceCursor({
        limit: '1',
        search: 'B-',
        cursor: first.body.meta.nextCursor,
      }).expect(400);

      expect(res.body.code).toBe('LIST_CURSOR_INVALID');
    });

    it('WHEN the cursor row was deleted THEN the next invoice block still succeeds', async () => {
      await prisma.invoice.createMany({
        data: [
          invoiceRow({ invoice_number: 'D-1', status: InvoiceStatus.DRAFT }),
          invoiceRow({ invoice_number: 'D-2', status: InvoiceStatus.DRAFT }),
          invoiceRow({ invoice_number: 'D-3', status: InvoiceStatus.DRAFT }),
        ],
      });
      const query = { sortField: 'invoice_number', sortDirection: 'asc', limit: '1' };
      const first = await listInvoiceCursor(query).expect(200);
      await prisma.invoice.delete({ where: { id: first.body.data[0].id } });

      const second = await listInvoiceCursor({
        ...query,
        cursor: first.body.meta.nextCursor,
      }).expect(200);

      expect(second.body.data.map((row: { invoice_number: string }) => row.invoice_number)).toEqual(['D-2']);
    });

    it('WHEN a search has several words THEN number, customer name and status are searched and tenants stay separate', async () => {
      const otherPrisma = createTenantAwarePrisma(
        app.get(PrismaService),
        otherTenantId,
      );
      const other = await otherPrisma.customer.create({
        data: { tenant_id: otherTenantId, first_name: 'Erika', last_name: 'Musterfrau' },
      });
      await prisma.invoice.createMany({
        data: [
          invoiceRow({ invoice_number: 'RE-2026-0001' }),
          invoiceRow({ invoice_number: 'RE-2026-0002', status: InvoiceStatus.PAID }),
        ],
      });
      await otherPrisma.invoice.create({
        data: invoiceRow({
          tenant_id: otherTenantId,
          customer_id: other.id,
          invoice_number: 'RE-2026-0001',
        }),
      });

      const byName = await listInvoiceCursor({ search: 'erika muster' }).expect(200);
      const byNumber = await listInvoiceCursor({ search: '0002' }).expect(200);
      const byStatus = await listInvoiceCursor({ search: 'paid' }).expect(200);
      const count = await request(app.getHttpServer())
        .get('/api/sales/invoices/capped-count')
        .query({ search: 'erika' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(byName.body.data).toHaveLength(2);
      expect(byNumber.body.data.map((row: { invoice_number: string }) => row.invoice_number)).toEqual(['RE-2026-0002']);
      expect(byStatus.body.data).toHaveLength(1);
      expect(count.body).toEqual({ count: 2, isCapped: false });
    });

    it('WHEN 1,001 invoices match THEN capped count returns count 1000 and isCapped true', async () => {
      await prisma.invoice.createMany({
        data: Array.from({ length: 1001 }, (_, index) =>
          invoiceRow({ invoice_number: `CAP-${index}` }),
        ),
      });

      const res = await request(app.getHttpServer())
        .get('/api/sales/invoices/capped-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toEqual({ count: 1000, isCapped: true });
    });

    // Scenario 3: a role without invoice access.
    it.each([
      ['invoice cursor list', '/api/sales/invoices', { pagination: 'cursor', limit: '10' }],
      ['invoice capped-count', '/api/sales/invoices/capped-count', {}],
    ])(
      'WHEN TECH role calls the %s THEN the API returns 403',
      async (_label, path, query) => {
        const techToken = await createTechToken(app, tenantId, 'invoice');

        await request(app.getHttpServer())
          .get(path)
          .query(query)
          .set('Authorization', `Bearer ${techToken}`)
          .expect(403);
      },
    );

    it('WHEN the list is requested without cursor mode THEN the unpaged array contract is unchanged', async () => {
      await prisma.invoice.createMany({ data: [invoiceRow({ invoice_number: 'ARR-1' })] });

      const res = await request(app.getHttpServer())
        .get('/api/sales/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.map((row: { invoice_number: string }) => row.invoice_number)).toEqual(['ARR-1']);
    });
  });
});
