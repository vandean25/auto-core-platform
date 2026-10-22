import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WorkshopPositionPlanService } from './workshop-position-plan.service.js';
import { laborNetCents, partNetCents } from './workshop-position-plan.math.js';

type ReservePartLine = (
  tx: Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  lineItemId: string,
  catalogItemId: string,
  quantity: Prisma.Decimal,
) => Promise<void>;

describe('WorkshopPositionPlanService', () => {
  const mockPrisma = {
    workshopCommandPreset: { findMany: jest.fn().mockResolvedValue([]) },
    laborOperation: { findMany: jest.fn() },
    catalogItem: { findMany: jest.fn() },
  };
  const mockAtp = {};

  let service: WorkshopPositionPlanService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkshopPositionPlanService(
      mockPrisma as never,
      mockAtp as never,
    );
  });

  it('computes labor net cents with integer half-up rounding', () => {
    expect(laborNetCents(90, 9000)).toBe(13500);
    expect(partNetCents(1500, 4200)).toBe(6300);
  });

  it('flags stale plans when unit price changes', () => {
    const line = {
      kind: 'LABOR' as const,
      laborOperationId: 'l1',
      catalogItemId: null,
      description: 'Service',
      quantity: '1.500',
      unit: 'h',
      unitPriceCents: 9000,
      netCents: 13500,
      reservation: 'not_applicable' as const,
      durationMinutes: 90,
    };
    const stored = {
      version: 1,
      fingerprint: 'a',
      lines: [line],
    };
    const recomputed = {
      version: 1,
      fingerprint: 'b',
      lines: [{ ...line, unitPriceCents: 9500, netCents: 14250 }],
    };
    expect(() =>
      service.assertStoredPlanMatches(stored, recomputed),
    ).toThrow(ConflictException);
  });

  it('requires a reviewed plan when recomputed lines exist but stored plan is missing', () => {
    expect(() =>
      service.assertStoredPlanMatches(null, {
        version: 1,
        fingerprint: 'x',
        lines: [],
      }),
    ).toThrow(ConflictException);
  });

  it('re-resolves part quantity from position_lines on apply stale check', async () => {
    const catalogId = '00000000-0000-4000-8000-000000000099';
    mockPrisma.catalogItem.findMany.mockResolvedValue([
      {
        id: catalogId,
        sku: 'OIL',
        name: 'Engine oil',
        unit: 'pcs',
        retail_price: new Prisma.Decimal('42.00'),
      },
    ]);
    mockPrisma.laborOperation.findMany.mockResolvedValue([]);

    const reviewed = await service.resolvePlan('tenant-1', 'site-1', {
      position_lines: [{ catalog_item_id: catalogId, quantity_milli: 2500 }],
    });
    const applyPayload = {
      position_lines: [{ catalog_item_id: catalogId, quantity_milli: 2500 }],
      position_plan: service.toPayloadPositionPlan(reviewed!),
    };
    const stored = service.parseStoredPlan(applyPayload);
    const recomputed = await service.resolvePlan('tenant-1', 'site-1', applyPayload, {
      forApplyStaleCheck: true,
    });
    expect(stored?.lines[0].quantity).toBe('2.500');
    expect(() =>
      service.assertStoredPlanMatches(stored, recomputed),
    ).not.toThrow();
  });

  it('skips creating tasks when the order already has plan-backed tasks', async () => {
    const tx = {
      workshopTask: {
        count: jest.fn().mockResolvedValue(2),
        create: jest.fn(),
      },
      workshopTaskLineItem: { create: jest.fn() },
    };
    await service.applyPlanInTransaction(
      tx as never,
      'tenant-1',
      'site-1',
      'order-1',
      'SCHEDULED',
      {
        version: 1,
        fingerprint: 'x',
        lines: [],
      },
    );
    expect(tx.workshopTask.create).not.toHaveBeenCalled();
  });

  it('returns preview questions instead of throwing for unknown presets', async () => {
    mockPrisma.laborOperation.findMany.mockResolvedValue([]);
    mockPrisma.catalogItem.findMany.mockResolvedValue([]);
    const plan = await service.resolvePlan('tenant-1', 'site-1', {
      position_lines: [{ preset_key: 'unknown.service' }],
    });
    expect(plan?.lines).toHaveLength(0);
    expect(plan?.questions).toEqual([
      {
        code: 'UNSUPPORTED_SERVICE',
        message: 'Preset unknown.service is not configured at this site',
        preset_key: 'unknown.service',
      },
    ]);
  });

  it('throws PLAN_STALE when catalog price changes between review and apply', async () => {
    const catalogId = '00000000-0000-4000-8000-000000000099';
    mockPrisma.catalogItem.findMany.mockResolvedValue([
      {
        id: catalogId,
        sku: 'OIL',
        name: 'Engine oil',
        unit: 'pcs',
        retail_price: new Prisma.Decimal('42.00'),
      },
    ]);
    mockPrisma.laborOperation.findMany.mockResolvedValue([]);
    const reviewed = await service.resolvePlan('tenant-1', 'site-1', {
      position_lines: [{ catalog_item_id: catalogId, quantity_milli: 1000 }],
    });
    const payload = {
      position_lines: [{ catalog_item_id: catalogId, quantity_milli: 1000 }],
      position_plan: service.toPayloadPositionPlan(reviewed!),
    };
    mockPrisma.catalogItem.findMany.mockResolvedValue([
      {
        id: catalogId,
        sku: 'OIL',
        name: 'Engine oil',
        unit: 'pcs',
        retail_price: new Prisma.Decimal('45.00'),
      },
    ]);
    const stored = service.parseStoredPlan(payload);
    const recomputed = await service.resolvePlan('tenant-1', 'site-1', payload, {
      forApplyStaleCheck: true,
    });
    expect(() =>
      service.assertStoredPlanMatches(stored, recomputed),
    ).toThrow(ConflictException);
  });

  it('applies a two-line plan once and fulfills deferred parts on intake without duplicating tasks', async () => {
    const laborId = '00000000-0000-4000-8000-000000000010';
    const catalogId = '00000000-0000-4000-8000-000000000099';
    const plan = {
      version: 1,
      fingerprint: 'fp',
      lines: [
        {
          kind: 'LABOR' as const,
          laborOperationId: laborId,
          catalogItemId: null,
          description: 'Service',
          quantity: '1.000',
          unit: 'h',
          unitPriceCents: 9000,
          netCents: 9000,
          reservation: 'not_applicable' as const,
        },
        {
          kind: 'PART' as const,
          laborOperationId: null,
          catalogItemId: catalogId,
          description: 'Filter',
          quantity: '1.000',
          unit: 'pcs',
          unitPriceCents: 1000,
          netCents: 1000,
          reservation: 'unbooked' as const,
        },
      ],
    };
    const taskCreates: unknown[] = [];
    const lineCreates: unknown[] = [];
    const tx = {
      workshopTask: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async (args) => {
          taskCreates.push(args);
          return { id: `task-${taskCreates.length}` };
        }),
      },
      workshopTaskLineItem: {
        create: jest.fn(async (args) => {
          lineCreates.push(args);
          return { id: `line-${lineCreates.length}` };
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'line-2',
            catalog_item_id: catalogId,
            quantity: new Prisma.Decimal('1'),
            parts_reservations: [],
          },
        ]),
        updateMany: jest.fn(),
      },
      inventoryStock: {
        findMany: jest.fn().mockResolvedValue([
          {
            catalog_item_id: catalogId,
            location_id: 'loc-1',
            quantity_on_hand: new Prisma.Decimal('5'),
            quantity_reserved: new Prisma.Decimal('0'),
          },
        ]),
      },
    };
    const atp = {};
    const planService = new WorkshopPositionPlanService(
      mockPrisma as never,
      atp as never,
    );
    planService['reservePartLineInTransaction'] = jest
      .fn()
      .mockResolvedValue(undefined);

    await planService.applyPlanInTransaction(
      tx as never,
      'tenant-1',
      'site-1',
      'order-1',
      'SCHEDULED',
      plan,
    );
    expect(taskCreates).toHaveLength(2);
    expect(
      lineCreates.some(
        (row) =>
          (row as { data: { deferred_part_reservation?: boolean } }).data
            .deferred_part_reservation === true,
      ),
    ).toBe(true);
    expect(tx.inventoryStock.findMany).not.toHaveBeenCalled();

    await planService.fulfillDeferredReservationsOnIntake(
      tx as never,
      'tenant-1',
      'site-1',
      'order-1',
    );
    expect(tx.workshopTask.create).toHaveBeenCalledTimes(2);
    expect(tx.inventoryStock.findMany).toHaveBeenCalledTimes(1);
    expect(tx.workshopTaskLineItem.updateMany).toHaveBeenCalled();
  });

  it('rolls back apply when the last reserved part line cannot be stocked', async () => {
    const catalogId = '00000000-0000-4000-8000-000000000099';
    const plan = {
      version: 1,
      fingerprint: 'fp',
      lines: [
        {
          kind: 'PART' as const,
          laborOperationId: null,
          catalogItemId: catalogId,
          description: 'Filter',
          quantity: '1.000',
          unit: 'pcs',
          unitPriceCents: 1000,
          netCents: 1000,
          reservation: 'reserved' as const,
        },
        {
          kind: 'PART' as const,
          laborOperationId: null,
          catalogItemId: catalogId,
          description: 'Bolt',
          quantity: '2.000',
          unit: 'pcs',
          unitPriceCents: 500,
          netCents: 1000,
          reservation: 'reserved' as const,
        },
      ],
    };
    const tx = {
      workshopTask: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async () => ({ id: 'task-1' })),
      },
      workshopTaskLineItem: {
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'line-1' })
          .mockResolvedValueOnce({ id: 'line-2' }),
      },
      inventoryStock: {
        findMany: jest.fn().mockResolvedValue([
          {
            catalog_item_id: catalogId,
            location_id: 'loc-1',
            quantity_on_hand: new Prisma.Decimal('1'),
            quantity_reserved: new Prisma.Decimal('0'),
          },
        ]),
      },
    };
    const reserveSpy = jest.fn<Promise<void>, Parameters<ReservePartLine>>(
      async (_tx, _t, _s, _lineId, _cat, quantity) => {
        if (quantity.toNumber() > 1) {
          throw new ConflictException({
            code: 'INSUFFICIENT_STOCK',
            message: 'Insufficient stock to reserve the planned part line',
          });
        }
      },
    );
    service['reservePartLineInTransaction'] = reserveSpy;

    await expect(
      service.applyPlanInTransaction(
        tx as never,
        'tenant-1',
        'site-1',
        'order-1',
        'SCHEDULED',
        plan,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(reserveSpy).toHaveBeenCalledTimes(2);
    reserveSpy.mockRestore();
  });
});
