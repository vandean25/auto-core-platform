import { ForbiddenException } from '@nestjs/common';
import { VehicleInspectionRecordSource } from '@prisma/client';
import { VehicleInspectionRecordService } from './vehicle-inspection-record.service.js';

describe('VehicleInspectionRecordService immutability', () => {
  const record = (source: VehicleInspectionRecordSource) => ({
    id: 'rec-1',
    vehicle_id: 'veh-1',
    source,
    inspected_on: new Date('2026-06-15T00:00:00.000Z'),
    plaketten_valid_until_year: 2027,
    plaketten_valid_until_month: 6,
  });

  function build(source: VehicleInspectionRecordSource) {
    const prisma = {
      vehicle: { findFirst: jest.fn().mockResolvedValue({ id: 'veh-1' }) },
      vehicleInspectionRecord: {
        findFirst: jest.fn().mockResolvedValue(record(source)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'ADMIN' }),
    };
    const service = new VehicleInspectionRecordService(
      prisma as never,
      tenantContext as never,
    );
    return { service, prisma };
  }

  it.each([
    VehicleInspectionRecordSource.EBV_IMPORTED,
    VehicleInspectionRecordSource.LEGACY_IMPORT,
  ])('rejects update and delete of a %s record', async (source) => {
    const { service, prisma } = build(source);

    await expect(
      service.update('veh-1', 'rec-1', { station_name: 'Changed' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.remove('veh-1', 'rec-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.vehicleInspectionRecord.updateMany).not.toHaveBeenCalled();
    expect(prisma.vehicleInspectionRecord.deleteMany).not.toHaveBeenCalled();
  });

  it('still deletes a MANUAL record', async () => {
    const { service, prisma } = build(VehicleInspectionRecordSource.MANUAL);

    await service.remove('veh-1', 'rec-1');

    expect(prisma.vehicleInspectionRecord.deleteMany).toHaveBeenCalled();
  });
});
