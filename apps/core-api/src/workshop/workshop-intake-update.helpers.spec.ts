import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { WorkshopOrderPurpose, WorkshopOrderStatus } from '@prisma/client';
import {
  assertActiveSiteMatch,
  assertExpectedSiteMatch,
  executeUpdateOrder,
  hasScheduleUpdateFields,
  isOrderRetargeting,
} from './workshop-intake-update.helpers.js';

const persistedOrder = {
  id: 'wo-1',
  site_id: 'site-1',
  status: WorkshopOrderStatus.SCHEDULED,
  purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
  vehicle_id: 'v-1',
  bay_id: 'bay-1',
  mechanic_id: null,
  staging_location_id: null,
  reported_issue: 'Brakes',
  notes: null,
  scheduled_start_at: null,
  scheduled_end_at: null,
};

function buildServices(existing: unknown, activeSiteId = 'site-1') {
  const updatedOrder = { id: 'wo-1', site_id: 'site-1' };
  const tx = {
    workshopOrder: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirstOrThrow: jest.fn().mockResolvedValue(updatedOrder),
    },
  };
  const prisma = {
    workshopOrder: {
      findFirst: jest.fn().mockResolvedValue(existing),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirstOrThrow: jest.fn().mockResolvedValue(updatedOrder),
    },
    $transaction: jest.fn((callback: (client: unknown) => unknown) =>
      callback(tx),
    ),
  };
  const services = {
    prisma,
    tenantContext: { getTenantId: jest.fn().mockResolvedValue('tenant-1') },
    siteContext: {
      getSiteId: jest.fn().mockResolvedValue(activeSiteId),
      listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1', 'site-2']),
    },
    scheduleService: {
      rescheduleOrder: jest.fn().mockResolvedValue({
        bayId: 'bay-2',
        mechanicId: null,
        start: new Date('2026-10-20T08:00:00Z'),
        end: new Date('2026-10-20T10:00:00Z'),
      }),
    },
    partsRequisitionService: { releaseReservation: jest.fn() },
  } as any;
  return { services, prisma, tx, updatedOrder };
}

describe('isOrderRetargeting', () => {
  it('is false when the dto names no site', () => {
    expect(isOrderRetargeting({}, 'site-1')).toBe(false);
  });

  it('is false when the dto names the persisted site', () => {
    expect(isOrderRetargeting({ siteId: 'site-1' }, 'site-1')).toBe(false);
  });

  it('is true when the dto names a different site', () => {
    expect(isOrderRetargeting({ siteId: 'site-2' }, 'site-1')).toBe(true);
  });
});

describe('assertActiveSiteMatch', () => {
  it('reports a plain update made from another site as not found', () => {
    expect(() =>
      assertActiveSiteMatch(false, 'site-1', 'site-2', 'wo-1'),
    ).toThrow(NotFoundException);
  });

  it('allows the persisted site to act on its own order', () => {
    expect(() =>
      assertActiveSiteMatch(false, 'site-1', 'site-1', 'wo-1'),
    ).not.toThrow();
  });

  it('allows a retarget away from the active site', () => {
    expect(() =>
      assertActiveSiteMatch(true, 'site-1', 'site-2', 'wo-1'),
    ).not.toThrow();
  });
});

describe('assertExpectedSiteMatch', () => {
  it('accepts an update without an expected site', () => {
    expect(() => assertExpectedSiteMatch(undefined, 'site-1')).not.toThrow();
  });

  it('accepts an expected site that matches the persisted site', () => {
    expect(() => assertExpectedSiteMatch('site-1', 'site-1')).not.toThrow();
  });

  it('rejects a stale expected site with a conflict', () => {
    expect(() => assertExpectedSiteMatch('site-0', 'site-1')).toThrow(
      ConflictException,
    );
  });
});

describe('hasScheduleUpdateFields', () => {
  it.each(['bayId', 'scheduledStartAt', 'scheduledEndAt', 'mechanicId'])(
    'treats %s as a schedule change',
    (field) => {
      expect(hasScheduleUpdateFields({ [field]: 'x' })).toBe(true);
    },
  );

  it('ignores note and issue edits', () => {
    expect(hasScheduleUpdateFields({ notes: 'x', reportedIssue: 'y' })).toBe(
      false,
    );
  });
});

describe('executeUpdateOrder', () => {
  it('reports a missing or unauthorised order as not found', async () => {
    const { services, prisma } = buildServices(null);

    await expect(
      executeUpdateOrder(services, 'wo-1', { notes: 'x' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.workshopOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'wo-1',
          tenant_id: 'tenant-1',
          site_id: { in: ['site-1', 'site-2'] },
        },
      }),
    );
  });

  it('rejects edits to an invoiced order', async () => {
    const { services } = buildServices({
      ...persistedOrder,
      status: WorkshopOrderStatus.INVOICED,
    });

    await expect(
      executeUpdateOrder(services, 'wo-1', { notes: 'x' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('applies a notes-only change through the basic update path', async () => {
    const { services, prisma, updatedOrder } = buildServices(persistedOrder);

    await expect(
      executeUpdateOrder(services, 'wo-1', { notes: 'Check tyres' }),
    ).resolves.toBe(updatedOrder);
    expect(prisma.workshopOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'wo-1', tenant_id: 'tenant-1', site_id: 'site-1' },
      data: { reported_issue: undefined, notes: 'Check tyres' },
    });
    expect(services.scheduleService.rescheduleOrder).not.toHaveBeenCalled();
  });

  it('routes a bay change through the reschedule path inside a transaction', async () => {
    const { services, prisma, tx, updatedOrder } =
      buildServices(persistedOrder);
    const dto = { bayId: 'bay-2' };

    await expect(executeUpdateOrder(services, 'wo-1', dto)).resolves.toBe(
      updatedOrder,
    );
    expect(services.scheduleService.rescheduleOrder).toHaveBeenCalledWith(
      'wo-1',
      expect.objectContaining({
        vehicle_id: 'v-1',
        bay_id: 'bay-1',
        status: WorkshopOrderStatus.SCHEDULED,
      }),
      dto,
      tx,
    );
    expect(tx.workshopOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'wo-1', tenant_id: 'tenant-1', site_id: 'site-1' },
      data: expect.objectContaining({ bay_id: 'bay-2' }),
    });
    expect(prisma.workshopOrder.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale expected site before writing anything', async () => {
    const { services, prisma } = buildServices(persistedOrder);

    await expect(
      executeUpdateOrder(services, 'wo-1', {
        notes: 'x',
        expectedSiteId: 'site-0',
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.workshopOrder.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a plain edit when the active site does not own the order', async () => {
    const { services, prisma } = buildServices(persistedOrder, 'site-2');

    await expect(
      executeUpdateOrder(services, 'wo-1', { notes: 'x' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.workshopOrder.updateMany).not.toHaveBeenCalled();
  });
});
