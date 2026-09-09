import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
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

  describe('create edge cases', () => {
    it('throws NotFoundException when customer does not exist', async () => {
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.create({
          make: 'Toyota',
          model: 'Corolla',
          year: 2022,
          customer_id: 'nonexistent-customer',
        }),
      ).rejects.toThrow(
        new NotFoundException(
          'Customer with ID nonexistent-customer not found',
        ),
      );
    });

    it('connects customer when customer exists', async () => {
      prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
      prisma.vehicle.create.mockResolvedValue({
        id: 'veh-1',
        customer: { id: 'cust-1' },
      });

      await service.create({
        make: 'Toyota',
        model: 'Corolla',
        year: 2022,
        customer_id: 'cust-1',
      });

      expect(prisma.vehicle.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customer: { connect: { id: 'cust-1' } },
          tenant: { connect: { id: tenantId } },
        }),
        include: { customer: true },
      });
    });

    it('throws ConflictException with field names on P2002 error', async () => {
      const error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint violation',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['vin', 'plate'] },
        },
      );
      prisma.vehicle.create.mockRejectedValue(error);

      await expect(
        service.create({ make: 'Toyota', model: 'Corolla', year: 2022 }),
      ).rejects.toThrow(
        new ConflictException('Unique constraint failed on fields: vin, plate'),
      );
    });

    it('throws ConflictException with default message on P2002 error without target', async () => {
      const error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint violation',
        { code: 'P2002', clientVersion: '5.0.0' },
      );
      prisma.vehicle.create.mockRejectedValue(error);

      await expect(
        service.create({ make: 'Toyota', model: 'Corolla', year: 2022 }),
      ).rejects.toThrow(new ConflictException('Unique constraint violation'));
    });

    it('rethrows unexpected errors on create', async () => {
      prisma.vehicle.create.mockRejectedValue(
        new Error('Database unavailable'),
      );

      await expect(
        service.create({ make: 'Toyota', model: 'Corolla', year: 2022 }),
      ).rejects.toThrow('Database unavailable');
    });
  });

  describe('update edge cases', () => {
    it('throws NotFoundException when vehicle to update is not found', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(null);

      await expect(
        service.update('nonexistent-id', { make: 'Ford' }),
      ).rejects.toThrow(
        new NotFoundException('Vehicle with ID nonexistent-id not found'),
      );
    });

    it('throws NotFoundException when customer on update does not exist', async () => {
      prisma.vehicle.findFirst.mockResolvedValue({
        id: vehicleId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
      });
      prisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.update(vehicleId, { customer_id: 'bad-cust' }),
      ).rejects.toThrow(
        new NotFoundException('Customer with ID bad-cust not found'),
      );
    });

    it('throws ConflictException on P2002 error during update', async () => {
      prisma.vehicle.findFirst.mockResolvedValue({
        id: vehicleId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
      });
      const error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint violation',
        { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['plate'] } },
      );
      prisma.vehicle.updateMany.mockRejectedValue(error);

      await expect(
        service.update(vehicleId, { plate: 'TAKEN-PLATE' }),
      ).rejects.toThrow(
        new ConflictException('Unique constraint failed on fields: plate'),
      );
    });

    it('throws NotFoundException on P2025 error during update', async () => {
      prisma.vehicle.findFirst.mockResolvedValue({
        id: vehicleId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
      });
      const error = new Prisma.PrismaClientKnownRequestError(
        'Record not found',
        { code: 'P2025', clientVersion: '5.0.0' },
      );
      prisma.vehicle.updateMany.mockRejectedValue(error);

      await expect(
        service.update(vehicleId, { make: 'Updated' }),
      ).rejects.toThrow(new NotFoundException('Vehicle not found'));
    });

    it('rethrows unexpected errors on update', async () => {
      prisma.vehicle.findFirst.mockResolvedValue({
        id: vehicleId,
        vin: 'VIN-1',
        plate: 'PLATE-1',
      });
      prisma.vehicle.updateMany.mockRejectedValue(new Error('Connection lost'));

      await expect(
        service.update(vehicleId, { make: 'Updated' }),
      ).rejects.toThrow('Connection lost');
    });
  });

  describe('findOne edge cases', () => {
    it('throws NotFoundException when vehicle is not found', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(
        new NotFoundException('Vehicle with ID nonexistent-id not found'),
      );
    });
  });

  describe('findAll ordering and search', () => {
    it('applies search filters and sort params', async () => {
      prisma.vehicle.findMany.mockResolvedValue([]);
      prisma.vehicle.count.mockResolvedValue(0);

      await service.findAll({
        search: 'BMW',
        page: 2,
        pageSize: 10,
        sortField: 'make',
        sortDirection: 'asc',
      });

      expect(prisma.vehicle.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenant_id: tenantId,
          OR: expect.arrayContaining([
            { make: { contains: 'BMW', mode: 'insensitive' } },
          ]),
        }),
        include: { customer: true },
        skip: 10,
        take: 10,
        orderBy: { make: 'asc' },
      });
    });
  });
});
