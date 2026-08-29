import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { VEHICLE_IDENTITY_RESET } from './vehicle-identity.util';
import { VehicleService } from './vehicle.service';

describe('VehicleService', () => {
  const tenantId = 'tenant-1';
  const vehicleId = 'vehicle-1';
  let service: VehicleService;
  let prisma: {
    vehicle: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    customer: { findFirst: jest.Mock };
  };
  let tenantContext: { getTenantId: jest.Mock };

  beforeEach(async () => {
    prisma = {
      vehicle: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
      customer: { findFirst: jest.fn() },
    };
    tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
      ],
    }).compile();

    service = module.get(VehicleService);
  });

  it('clears identity fields when the plate changes', async () => {
    const refetchedVehicle = {
      id: vehicleId,
      vin: 'VIN-1',
      plate: 'PLATE-2',
      customer: null,
    };
    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
      })
      .mockResolvedValueOnce(refetchedVehicle);
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.update(vehicleId, { plate: 'PLATE-2' });

    expect(result).toEqual(refetchedVehicle);

    expect(prisma.vehicle.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: vehicleId, tenant_id: tenantId },
      select: {
        id: true,
        vin: true,
        plate: true,
        identity_resolution_generation: true,
        identity_resolution_token: true,
      },
    });
    expect(prisma.vehicle.updateMany).toHaveBeenCalledWith({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
        identity_resolution_generation: null,
        identity_resolution_token: null,
      },
      data: expect.objectContaining({
        plate: 'PLATE-2',
        ...VEHICLE_IDENTITY_RESET,
      }),
    });
    expect(prisma.vehicle.findFirst).toHaveBeenNthCalledWith(2, {
      where: { id: vehicleId, tenant_id: tenantId },
      include: { customer: true },
    });
  });

  it('does not expose identity resolution state in the vehicle detail response', async () => {
    const vehicle = {
      id: vehicleId,
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: 'token-1',
      customer: null,
    };
    prisma.vehicle.findFirst.mockResolvedValue(vehicle);

    await expect(service.findOne(vehicleId)).resolves.toEqual({
      id: vehicleId,
      customer: null,
    });
  });

  it('does not expose identity resolution state in vehicle list responses', async () => {
    const vehicle = {
      id: vehicleId,
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: 'token-1',
      customer: null,
    };
    prisma.vehicle.findMany.mockResolvedValue([vehicle]);
    prisma.vehicle.count.mockResolvedValue(1);

    await expect(service.findAll({})).resolves.toEqual({
      data: [{ id: vehicleId, customer: null }],
      meta: {
        total: 1,
        page: 1,
        pageSize: 25,
        pageCount: 1,
      },
    });
  });

  it('throws NotFoundException when the tenant-scoped update affects no rows', async () => {
    prisma.vehicle.findFirst.mockResolvedValueOnce({
      id: vehicleId,
      vin: 'VIN-1',
      plate: 'PLATE-1',
    });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update(vehicleId, { plate: 'PLATE-2' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when the tenant-scoped refetch is null', async () => {
    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
      })
      .mockResolvedValueOnce(null);
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.update(vehicleId, { plate: 'PLATE-2' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clears identity fields when the VIN changes', async () => {
    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
      })
      .mockResolvedValueOnce({ id: vehicleId, customer: null });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

    await service.update(vehicleId, { vin: ' vf2 ' });

    expect(prisma.vehicle.updateMany).toHaveBeenCalledWith({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
        identity_resolution_generation: null,
        identity_resolution_token: null,
      },
      data: expect.objectContaining({
        vin: 'VF2',
        ...VEHICLE_IDENTITY_RESET,
      }),
    });
  });

  it('canonicalizes the VIN before creating a vehicle', async () => {
    const createdVehicle = { id: vehicleId, vin: 'VF1ABC123' };
    prisma.vehicle.create.mockResolvedValue(createdVehicle);

    await expect(
      service.create({
        make: 'Peugeot',
        model: '308',
        year: 2024,
        vin: ' vf1abc123 ',
      }),
    ).resolves.toEqual(createdVehicle);

    expect(prisma.vehicle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vin: 'VF1ABC123',
      }),
      include: { customer: true },
    });
  });

  it('persists a blank VIN as null when creating a vehicle', async () => {
    const createdVehicle = { id: vehicleId, vin: null };
    prisma.vehicle.create.mockResolvedValue(createdVehicle);

    await expect(
      service.create({
        make: 'Peugeot',
        model: '308',
        year: 2024,
        vin: '   ',
      }),
    ).resolves.toEqual(createdVehicle);

    expect(prisma.vehicle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ vin: null }),
      include: { customer: true },
    });
  });

  it('keeps a blank VIN nullable when updating a vehicle created without a VIN', async () => {
    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: null,
        plate: null,
      })
      .mockResolvedValueOnce({ id: vehicleId, vin: null, customer: null });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

    await service.update(vehicleId, { vin: '   ' });

    expect(prisma.vehicle.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ vin: null }),
      data: expect.objectContaining({ vin: null }),
    });
  });

  it('does not clear identity fields for an equivalent plate value', async () => {
    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: 'VIN-1',
        plate: ' plate-1 ',
      })
      .mockResolvedValueOnce({ id: vehicleId, customer: null });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

    await service.update(vehicleId, { plate: 'PLATE-1' });

    const updateData = prisma.vehicle.updateMany.mock.calls[0][0].data;
    expect(updateData).toEqual({ plate: 'PLATE-1' });
  });

  it('does not clear identity fields when updating an equivalent normalized VIN', async () => {
    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: ' vin-1 ',
        plate: 'PLATE-1',
      })
      .mockResolvedValueOnce({ id: vehicleId, customer: null });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

    await service.update(vehicleId, { vin: 'VIN-1' });

    const updateData = prisma.vehicle.updateMany.mock.calls[0][0].data;
    expect(updateData).toEqual({ vin: 'VIN-1' });
  });

  it('does not clear identity fields for an unrelated scalar edit', async () => {
    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
      })
      .mockResolvedValueOnce({ id: vehicleId, customer: null });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

    await service.update(vehicleId, { make: 'Updated Make' });

    const updateData = prisma.vehicle.updateMany.mock.calls[0][0].data;
    expect(updateData).toEqual({ make: 'Updated Make' });
  });

  it('rejects a stale update after identity resolution advances the generation', async () => {
    prisma.vehicle.findFirst.mockImplementation(async (args) => {
      if (args.select) {
        return {
          id: vehicleId,
          vin: 'VIN-1',
          plate: 'PLATE-1',
          identity_resolution_generation: 'generation-1',
          identity_resolution_token: null,
        };
      }
      return {
        id: vehicleId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
        customer: null,
      };
    });
    prisma.vehicle.updateMany.mockImplementation(async ({ where }) => ({
      count: where.identity_resolution_generation === 'generation-2' ? 1 : 0,
    }));

    await expect(
      service.update(vehicleId, { plate: 'PLATE-2' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.vehicle.updateMany).toHaveBeenCalledWith({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
        identity_resolution_generation: 'generation-1',
        identity_resolution_token: null,
      },
      data: expect.objectContaining({ plate: 'PLATE-2' }),
    });
  });
});
