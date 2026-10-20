import { createE2eApp } from './helpers/e2e-suite.js';
import { AuthService } from '../src/auth/auth.service.js';
import { INestApplication } from '@nestjs/common';
import {
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

type CapacityWeek = {
  timezone: string;
  today: string;
  weekStart: string;
  days: Array<{ date: string; isClosed: boolean; capacityHours: number }>;
  bays: Array<{
    name: string;
    days: Array<{
      date: string;
      capacityHours: number;
      bookedHours: number;
      freeHours: number;
      isOverbooked: boolean;
      orders: Array<{
        orderNumber: string;
        plate: string | null;
        plannedLaborHours: number;
      }>;
    }>;
  }>;
};

// Mon 2026-10-12 to Sat 2026-10-17 (Vienna is on CEST); 08:00 local is 06:00Z.
const WEEK_START = '2026-10-12';

describe('Workshop capacity week (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let authToken: string;
  let tenantId: string;
  let prisma: PrismaService;
  let siteId: string;
  let vehicleId: string;
  let bayOneId: string;
  let bayTwoId: string;
  let otherTenantId: string;
  let otherTenantSiteId: string;
  let secondSiteId: string;

  beforeAll(async () => {
    app = await createE2eApp();

    basePrisma = app.get(PrismaService);
    const testTenant = await createTestTenant(basePrisma, 'workshop-capacity');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    siteId = await resolveTestMainSiteId(basePrisma, tenantId);
    authToken = createTestAuthToken(app.get(AuthService), testTenant);

    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'VW',
        model: 'Golf',
        year: 2021,
        plate: 'W-CAP-1',
        vin: `VIN-CAP-${Date.now()}`,
      },
    });
    vehicleId = vehicle.id;

    bayOneId = (
      await prisma.bay.create({
        data: { name: 'Bay 1', site_id: siteId, is_active: true, sort_order: 1 },
      })
    ).id;
    bayTwoId = (
      await prisma.bay.create({
        data: { name: 'Bay 2', site_id: siteId, is_active: true, sort_order: 2 },
      })
    ).id;
    const retiredBay = await prisma.bay.create({
      data: {
        name: 'Bay Retired',
        site_id: siteId,
        is_active: false,
        sort_order: 3,
      },
    });

    await createOrder({
      orderNumber: 'WO-CAP-1',
      bayId: bayOneId,
      status: WorkshopOrderStatus.SCHEDULED,
      scheduledStartAt: '2026-10-12T06:00:00.000Z',
      laborHours: ['2.5'],
    });
    await createOrder({
      orderNumber: 'WO-CAP-2',
      bayId: bayOneId,
      status: WorkshopOrderStatus.INTAKE,
      scheduledStartAt: '2026-10-12T08:00:00.000Z',
      laborHours: ['1', '3'],
    });
    await createOrder({
      orderNumber: 'WO-CAP-3',
      bayId: bayTwoId,
      status: WorkshopOrderStatus.IN_PROGRESS,
      scheduledStartAt: '2026-10-13T06:00:00.000Z',
      laborHours: ['10'],
    });
    await createOrder({
      orderNumber: 'WO-CAP-4',
      bayId: bayTwoId,
      status: WorkshopOrderStatus.SCHEDULED,
      scheduledStartAt: '2026-10-17T07:00:00.000Z',
      laborHours: ['1.5'],
    });
    await createOrder({
      orderNumber: 'WO-CAP-5',
      bayId: bayOneId,
      status: WorkshopOrderStatus.COMPLETED,
      scheduledStartAt: '2026-10-12T10:00:00.000Z',
      laborHours: ['4'],
    });
    await createOrder({
      orderNumber: 'WO-CAP-6',
      bayId: retiredBay.id,
      status: WorkshopOrderStatus.SCHEDULED,
      scheduledStartAt: '2026-10-12T06:00:00.000Z',
      laborHours: ['5'],
    });

    const secondLegalEntity = await prisma.legalEntity.create({
      data: {
        tenant_id: tenantId,
        name: `Capacity second site ${Date.now()}`,
        country_iso: 'AT',
        is_active: true,
      },
    });
    secondSiteId = (
      await prisma.site.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: secondLegalEntity.id,
          code: 'SECOND',
          name: 'Second site',
          timezone: 'Europe/Vienna',
          slot_minutes: 30,
          holiday_country_iso: 'AT',
          is_active: true,
        },
      })
    ).id;
    const secondSiteBay = await prisma.bay.create({
      data: {
        tenant_id: tenantId,
        name: 'Remote Bay',
        site_id: secondSiteId,
        is_active: true,
        sort_order: 1,
      },
    });
    await prisma.workshopOrder.create({
      data: {
        tenant_id: tenantId,
        site_id: secondSiteId,
        order_number: 'WO-CAP-SITE2',
        status: WorkshopOrderStatus.SCHEDULED,
        vehicle_id: vehicleId,
        bay_id: secondSiteBay.id,
        odometer: 1000,
        fuel_level: 50,
        scheduled_start_at: new Date('2026-10-12T06:00:00.000Z'),
        scheduled_end_at: new Date('2026-10-12T07:00:00.000Z'),
        tasks: {
          create: [
            {
              title: 'Other site work',
              line_items: {
                create: [
                  {
                    type: WorkshopLineItemType.LABOR,
                    item_no: 'LAB-SITE2',
                    description: 'Other site labor',
                    quantity: '3',
                    unit_price: '120.00',
                  },
                ],
              },
            },
          ],
        },
      },
    });

    const otherTenant = await createTestTenant(
      basePrisma,
      'workshop-capacity-other',
    );
    otherTenantId = otherTenant.tenantId;
    otherTenantSiteId = await resolveTestMainSiteId(basePrisma, otherTenantId);
    const otherPrisma = createTenantAwarePrisma(basePrisma, otherTenantId);
    const otherTenantVehicle = await otherPrisma.vehicle.create({
      data: {
        tenant_id: otherTenantId,
        make: 'Audi',
        model: 'A4',
        year: 2020,
        plate: 'OTHER-1',
        vin: `VIN-CAP-OTHER-${Date.now()}`,
      },
    });
    const otherTenantBay = await otherPrisma.bay.create({
      data: {
        tenant_id: otherTenantId,
        name: 'Foreign Bay',
        site_id: otherTenantSiteId,
        is_active: true,
        sort_order: 1,
      },
    });
    await otherPrisma.workshopOrder.create({
      data: {
        tenant_id: otherTenantId,
        site_id: otherTenantSiteId,
        order_number: 'WO-CAP-TENANT2',
        status: WorkshopOrderStatus.SCHEDULED,
        vehicle_id: otherTenantVehicle.id,
        bay_id: otherTenantBay.id,
        odometer: 1000,
        fuel_level: 50,
        scheduled_start_at: new Date('2026-10-12T06:00:00.000Z'),
        scheduled_end_at: new Date('2026-10-12T07:00:00.000Z'),
        tasks: {
          create: [
            {
              title: 'Foreign work',
              line_items: {
                create: [
                  {
                    type: WorkshopLineItemType.LABOR,
                    item_no: 'LAB-TENANT2',
                    description: 'Foreign labor',
                    quantity: '3',
                    unit_price: '120.00',
                  },
                ],
              },
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(basePrisma, tenantId);
    }
    if (otherTenantId) {
      await cleanupTestTenantGraph(basePrisma, otherTenantId);
    }
    await teardownTestApp(app, basePrisma);
  });

  async function createOrder(input: {
    orderNumber: string;
    bayId: string;
    status: WorkshopOrderStatus;
    scheduledStartAt: string | null;
    laborHours: string[];
  }) {
    const start = input.scheduledStartAt ? new Date(input.scheduledStartAt) : null;
    return prisma.workshopOrder.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        order_number: input.orderNumber,
        status: input.status,
        vehicle_id: vehicleId,
        bay_id: input.bayId,
        odometer: 1000,
        fuel_level: 50,
        scheduled_start_at: start,
        scheduled_end_at: start ? new Date(start.getTime() + 60 * 60 * 1000) : null,
        tasks: {
          create: [
            {
              title: 'Service',
              line_items: {
                create: [
                  ...input.laborHours.map((hours, index) => ({
                    type: WorkshopLineItemType.LABOR,
                    item_no: `LAB-${index}`,
                    description: 'Labor',
                    quantity: hours,
                    unit_price: '120.00',
                  })),
                  {
                    type: WorkshopLineItemType.PART,
                    part_execution_status:
                      WorkshopPartLineExecutionStatus.PENDING_PICK,
                    item_no: 'PART-1',
                    description: 'Oil filter',
                    quantity: '3',
                    unit_price: '10.00',
                  },
                ],
              },
            },
          ],
        },
      },
    });
  }

  async function getWeek(query = ''): Promise<CapacityWeek> {
    const res = await request(app.getHttpServer())
      .get(`/api/workshop/capacity${query}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    return res.body as CapacityWeek;
  }

  function cell(week: CapacityWeek, bayName: string, date: string) {
    const bay = week.bays.find((item) => item.name === bayName);
    const found = bay?.days.find((item) => item.date === date);
    if (!found) {
      throw new Error(`No cell for ${bayName} on ${date}`);
    }
    return found;
  }

  it('returns Monday to Saturday for the week that contains weekStart', async () => {
    const week = await getWeek(`?weekStart=2026-10-14`);

    expect(week.weekStart).toBe(WEEK_START);
    expect(week.timezone).toBe('Europe/Vienna');
    expect(week.days.map((day) => day.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
    ]);
    expect(week.days[0]).toMatchObject({ isClosed: false, capacityHours: 9.5 });
    expect(week.days[5]).toMatchObject({ isClosed: false, capacityHours: 4 });
  });

  it('lists only active bays of the active site in sort order', async () => {
    const week = await getWeek(`?weekStart=${WEEK_START}`);

    expect(week.bays.map((bay) => bay.name)).toEqual(['Bay 1', 'Bay 2']);
  });

  it('sums labor hours per bay and day and reports the free hours left', async () => {
    const week = await getWeek(`?weekStart=${WEEK_START}`);
    const monday = cell(week, 'Bay 1', '2026-10-12');

    expect(monday).toMatchObject({
      capacityHours: 9.5,
      bookedHours: 6.5,
      freeHours: 3,
      isOverbooked: false,
    });
    expect(monday.orders.map((order) => order.orderNumber)).toEqual([
      'WO-CAP-1',
      'WO-CAP-2',
    ]);
    expect(monday.orders[0]).toMatchObject({
      plate: 'W-CAP-1',
      plannedLaborHours: 2.5,
    });
  });

  it('flags a cell as overbooked when planned hours exceed the open window', async () => {
    const week = await getWeek(`?weekStart=${WEEK_START}`);

    expect(cell(week, 'Bay 2', '2026-10-13')).toMatchObject({
      capacityHours: 9.5,
      bookedHours: 10,
      freeHours: 0,
      isOverbooked: true,
    });
  });

  it('uses the shortened Saturday window', async () => {
    const week = await getWeek(`?weekStart=${WEEK_START}`);

    expect(cell(week, 'Bay 2', '2026-10-17')).toMatchObject({
      capacityHours: 4,
      bookedHours: 1.5,
      freeHours: 2.5,
      isOverbooked: false,
    });
  });

  it('leaves out other sites, other tenants, retired bays and finished orders', async () => {
    const week = await getWeek(`?weekStart=${WEEK_START}`);
    const serialized = JSON.stringify(week);

    expect(serialized).not.toContain('Remote Bay');
    expect(serialized).not.toContain('Foreign Bay');
    expect(serialized).not.toContain('WO-CAP-SITE2');
    expect(serialized).not.toContain('WO-CAP-TENANT2');
    expect(serialized).not.toContain('WO-CAP-5');
    expect(serialized).not.toContain('WO-CAP-6');
  });

  it('defaults to the Monday of the current week in the site timezone', async () => {
    const week = await getWeek();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Vienna',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const offsetToMonday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const expectedMonday = new Date(
      new Date(`${today}T00:00:00Z`).getTime() - offsetToMonday * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);

    expect(week.today).toBe(today);
    expect(week.weekStart).toBe(expectedMonday);
  });

  it('rejects a malformed or impossible weekStart', async () => {
    await request(app.getHttpServer())
      .get('/api/workshop/capacity?weekStart=12-10-2026')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);

    const impossible = await request(app.getHttpServer())
      .get('/api/workshop/capacity?weekStart=2026-02-30')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);
    expect(impossible.body.message).toMatch(/real calendar date/);
  });

  it('requires an authenticated session', async () => {
    await request(app.getHttpServer())
      .get('/api/workshop/capacity')
      .expect(401);
  });
});
