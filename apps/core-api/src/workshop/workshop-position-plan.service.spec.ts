import { ConflictException } from '@nestjs/common';
import { WorkshopPositionPlanService } from './workshop-position-plan.service.js';
import { laborNetCents, partNetCents } from './workshop-position-plan.math.js';

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

  it('flags stale plans when fingerprints differ', () => {
    const stored = {
      version: 1,
      fingerprint: 'a',
      lines: [
        {
          kind: 'LABOR' as const,
          laborOperationId: 'l1',
          catalogItemId: null,
          description: 'Service',
          quantity: '1.500',
          unit: 'h',
          unitPriceCents: 9000,
          netCents: 13500,
          reservation: 'not_applicable' as const,
        },
      ],
    };
    const recomputed = {
      ...stored,
      fingerprint: 'b',
    };
    expect(() =>
      service.assertStoredPlanMatches(stored, recomputed),
    ).toThrow(ConflictException);
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
});
