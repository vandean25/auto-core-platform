import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  executeCreateWorkshopOrder,
  findPickerlDuplicate,
  resolveCreateSiteId,
} from './workshop-intake-create.helpers.js';
import {
  LIVE_ORDER_STATUSES,
  ORDER_WITH_RELATIONS,
} from './workshop-intake-query.helpers.js';
import { PICKERL_TASK_TITLE } from './workshop-pickerl.helpers.js';

const existingOrder = { id: 'wo-7', order_number: 'WO-2026-0007' };

const pickerlDto = {
  vehicleId: 'v-1',
  customerId: 'c-1',
  odometer: 52000,
  fuelLevel: 40,
  createPickerlTask: true,
} as any;

const plainDto = {
  vehicleId: 'v-1',
  customerId: 'c-1',
  odometer: 52000,
  fuelLevel: 40,
} as any;

function buildServices(role = 'ADMIN') {
  return {
    prisma: {
      vehicle: { findFirst: jest.fn().mockResolvedValue({ id: 'v-1' }) },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }) },
      workshopOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    },
    tenantContext: {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      getAuthenticatedUser: jest.fn().mockReturnValue({ role }),
    },
    siteContext: {
      getSiteId: jest.fn().mockResolvedValue('site-1'),
    },
    scheduleService: {},
    domainEventStore: { appendInTx: jest.fn() },
    requestContext: { getTraceId: jest.fn().mockReturnValue(undefined) },
  } as any;
}

describe('resolveCreateSiteId', () => {
  it('uses the active site when no site was simulated', () => {
    expect(resolveCreateSiteId('site-1')).toBe('site-1');
  });

  it('uses the simulated site when it is the active site', () => {
    expect(resolveCreateSiteId('site-1', 'site-1')).toBe('site-1');
  });

  it('rejects a simulated site that is not the active site', () => {
    expect(() => resolveCreateSiteId('site-2', 'site-1')).toThrow(
      UnprocessableEntityException,
    );
  });
});

describe('findPickerlDuplicate', () => {
  it('skips the lookup when the order does not request a §57a task', async () => {
    const services = buildServices();

    await expect(
      findPickerlDuplicate(services.prisma, 'tenant-1', 'site-1', plainDto),
    ).resolves.toBeNull();
    expect(services.prisma.workshopOrder.findFirst).not.toHaveBeenCalled();
  });

  it('returns the live order on the vehicle that already carries the §57a task', async () => {
    const services = buildServices();
    services.prisma.workshopOrder.findFirst.mockResolvedValueOnce(
      existingOrder,
    );

    await expect(
      findPickerlDuplicate(services.prisma, 'tenant-1', 'site-1', pickerlDto),
    ).resolves.toBe(existingOrder);
    expect(services.prisma.workshopOrder.findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        vehicle_id: 'v-1',
        status: { in: LIVE_ORDER_STATUSES },
        tasks: { some: { title: PICKERL_TASK_TITLE } },
      },
      include: ORDER_WITH_RELATIONS,
    });
  });
});

describe('executeCreateWorkshopOrder §57a handling', () => {
  it('returns the live §57a order instead of opening a transaction', async () => {
    const services = buildServices();
    services.prisma.workshopOrder.findFirst.mockResolvedValueOnce(
      existingOrder,
    );

    await expect(
      executeCreateWorkshopOrder(services, pickerlDto, jest.fn()),
    ).resolves.toBe(existingOrder);
    expect(services.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects §57a requests from roles other than OWNER, ADMIN and SALES before reading the vehicle', async () => {
    const services = buildServices('TECH');

    await expect(
      executeCreateWorkshopOrder(services, pickerlDto, jest.fn()),
    ).rejects.toThrow(ForbiddenException);
    expect(services.prisma.vehicle.findFirst).not.toHaveBeenCalled();
  });

  it('returns the §57a order a concurrent request created when the transaction conflicts', async () => {
    const services = buildServices();
    services.prisma.workshopOrder.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingOrder);
    services.prisma.$transaction.mockRejectedValueOnce(
      new ConflictException('Vehicle already has active order'),
    );

    await expect(
      executeCreateWorkshopOrder(services, pickerlDto, jest.fn()),
    ).resolves.toBe(existingOrder);
    expect(services.prisma.workshopOrder.findFirst).toHaveBeenCalledTimes(2);
  });

  it('rethrows a transaction conflict when no §57a order exists to recover', async () => {
    const services = buildServices();
    services.prisma.$transaction.mockRejectedValueOnce(
      new ConflictException('Vehicle already has active order'),
    );

    await expect(
      executeCreateWorkshopOrder(services, pickerlDto, jest.fn()),
    ).rejects.toThrow(ConflictException);
  });

  it('does not look for a duplicate after a non-conflict transaction error', async () => {
    const services = buildServices();
    services.prisma.$transaction.mockRejectedValueOnce(
      new Error('connection lost'),
    );

    await expect(
      executeCreateWorkshopOrder(services, pickerlDto, jest.fn()),
    ).rejects.toThrow('connection lost');
    expect(services.prisma.workshopOrder.findFirst).toHaveBeenCalledTimes(1);
  });

  it('does not look up §57a duplicates for a plain order that hits a conflict', async () => {
    const services = buildServices();
    services.prisma.$transaction.mockRejectedValueOnce(
      new ConflictException('Vehicle already has active order'),
    );

    await expect(
      executeCreateWorkshopOrder(services, plainDto, jest.fn()),
    ).rejects.toThrow(ConflictException);
    expect(services.prisma.workshopOrder.findFirst).not.toHaveBeenCalled();
    expect(services.tenantContext.getAuthenticatedUser).not.toHaveBeenCalled();
  });
});
