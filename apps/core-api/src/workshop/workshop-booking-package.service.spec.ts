import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { WorkshopBookingPackageService } from './workshop-booking-package.service.js';

describe('WorkshopBookingPackageService', () => {
  const mockPrisma = {
    site: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work({}),
    ),
  };
  const mockTenant = { getTenantId: jest.fn().mockResolvedValue('tenant-1') };
  const mockSite = { getSiteId: jest.fn().mockResolvedValue('site-1') };
  const mockSchedule = { assertCanBook: jest.fn() };
  const mockLoanerAuth = { assertWriteAccess: jest.fn() };
  const mockLoanerVehicles = { createReservedBookingInTransaction: jest.fn() };
  const mockDomainEventStore = { appendInTx: jest.fn() };
  const mockPositionPlan = {
    hasPlanContent: jest.fn().mockReturnValue(false),
    parseStoredPlan: jest.fn().mockReturnValue(null),
    resolvePlan: jest.fn().mockResolvedValue(null),
    assertStoredPlanMatches: jest.fn(),
    applyPlanInTransaction: jest.fn(),
    toPayloadPositionPlan: jest.fn(),
  };

  let service: WorkshopBookingPackageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WorkshopBookingPackageService(
      mockPrisma as never,
      mockTenant as never,
      mockSite as never,
      mockSchedule as never,
      mockLoanerAuth as never,
      mockLoanerVehicles as never,
      mockDomainEventStore,
      mockPositionPlan as never,
    );
  });

  it('rejects a partial loaner on WorkshopIntent payloads before any transaction', async () => {
    await expect(
      service.applyPackage({
        customer_id: '00000000-0000-4000-8000-000000000001',
        vehicle_id: '00000000-0000-4000-8000-000000000002',
        bay_id: '00000000-0000-4000-8000-000000000003',
        schedule: {
          start_at: '2026-10-12T09:00:00.000Z',
          end_at: '2026-10-12T10:00:00.000Z',
        },
        loaner: {
          loaner_vehicle_id: '00000000-0000-4000-8000-000000000004',
          planned_from: '2026-10-12T09:00:00.000Z',
        },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires loaner write access before booking a loaner', async () => {
    mockLoanerAuth.assertWriteAccess.mockRejectedValue(
      new ForbiddenException('forbidden'),
    );
    await expect(
      service.applyPackage({
        customer_id: '00000000-0000-4000-8000-000000000001',
        vehicle_id: '00000000-0000-4000-8000-000000000002',
        bay_id: '00000000-0000-4000-8000-000000000003',
        scheduled_start_at: '2026-10-12T09:00:00.000Z',
        scheduled_end_at: '2026-10-12T10:00:00.000Z',
        loaner_vehicle_id: '00000000-0000-4000-8000-000000000004',
        planned_from: '2026-10-12T09:00:00.000Z',
        planned_to: '2026-10-12T10:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockLoanerAuth.assertWriteAccess).toHaveBeenCalled();
  });
});
