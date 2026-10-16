import { PrismaService } from '../prisma/prisma.service.js';
import { VehiclePickerlBarrierService } from './vehicle-pickerl-barrier.service.js';

describe('VehiclePickerlBarrierService', () => {
  const tenantId = 'tenant-1';
  const vehicleId = 'vehicle-1';
  let prisma: {
    inspectionExchangeImport: { findMany: jest.Mock };
    externalInspectionResult: { findMany: jest.Mock };
  };
  let service: VehiclePickerlBarrierService;

  beforeEach(() => {
    prisma = {
      inspectionExchangeImport: { findMany: jest.fn() },
      externalInspectionResult: { findMany: jest.fn() },
    };
    service = new VehiclePickerlBarrierService(
      prisma as unknown as PrismaService,
    );
  });

  it('sets externalConflictBarrier when an import is in CONFLICT', async () => {
    prisma.inspectionExchangeImport.findMany.mockResolvedValue([
      { vehicle_id: vehicleId },
    ]);
    prisma.externalInspectionResult.findMany.mockResolvedValue([]);

    const flags = await service.loadBarrierFlags(tenantId, vehicleId);

    expect(flags.externalConflictBarrier).toBe(true);
    expect(flags.negativeBarrier).toBeFalsy();
  });

  it('keeps negativeBarrier when no confirmed positive has a report identity', async () => {
    const negativeAt = new Date('2026-01-15T00:00:00.000Z');
    prisma.inspectionExchangeImport.findMany.mockResolvedValue([]);
    prisma.externalInspectionResult.findMany
      .mockResolvedValueOnce([
        {
          vehicle_id: vehicleId,
          inspected_at: negativeAt,
          occurrence_kind: 'INITIAL',
        },
      ])
      .mockResolvedValueOnce([]);

    const flags = await service.loadBarrierFlags(tenantId, vehicleId);

    expect(flags.negativeBarrier).toBe(true);
    expect(prisma.externalInspectionResult.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          outcome: 'POSITIVE',
          report_identity_id: { not: null },
        }),
      }),
    );
  });

  it('clears negativeBarrier only after a later positive with report identity', async () => {
    const negativeAt = new Date('2026-01-15T00:00:00.000Z');
    const positiveAt = new Date('2026-02-01T00:00:00.000Z');
    prisma.inspectionExchangeImport.findMany.mockResolvedValue([]);
    prisma.externalInspectionResult.findMany
      .mockResolvedValueOnce([
        {
          vehicle_id: vehicleId,
          inspected_at: negativeAt,
          occurrence_kind: 'INITIAL',
        },
      ])
      .mockResolvedValueOnce([
        { vehicle_id: vehicleId, inspected_at: positiveAt },
      ]);

    const flags = await service.loadBarrierFlags(tenantId, vehicleId);

    expect(flags.negativeBarrier).toBeFalsy();
    expect(flags.externalConflictBarrier).toBeFalsy();
  });
});
