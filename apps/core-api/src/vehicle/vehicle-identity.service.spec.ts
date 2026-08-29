import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import {
  VEHICLE_IDENTITY_PROVIDER,
  type VehicleIdentityProvider,
} from './vehicle-identity.provider';
import { VehicleIdentityService } from './vehicle-identity.service';
import {
  VEHICLE_IDENTITY_RESET,
  createIdentityInputFingerprint,
} from './vehicle-identity.util';

describe('VehicleIdentityService', () => {
  const tenantId = 'tenant-1';
  const vehicleId = 'vehicle-1';
  let service: VehicleIdentityService;
  let prisma: {
    $transaction: jest.Mock;
    vehicle: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    customer: { findFirst: jest.Mock };
    vehicleMakeAlias: { findFirst: jest.Mock };
    brand: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
      upsert: jest.Mock;
    };
    catalogOemConcern: { findFirst: jest.Mock };
    catalogOemConcernMake: { findFirst: jest.Mock };
  };
  let tenantContext: { getTenantId: jest.Mock };
  let provider: jest.Mocked<VehicleIdentityProvider>;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(),
      vehicle: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      customer: { findFirst: jest.fn() },
      vehicleMakeAlias: { findFirst: jest.fn() },
      brand: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
      },
      catalogOemConcern: { findFirst: jest.fn() },
      catalogOemConcernMake: { findFirst: jest.fn() },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    tenantContext = { getTenantId: jest.fn().mockResolvedValue(tenantId) };
    provider = { resolve: jest.fn() };
    prisma.brand.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleIdentityService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: VEHICLE_IDENTITY_PROVIDER, useValue: provider },
      ],
    }).compile();

    service = module.get<VehicleIdentityService>(VehicleIdentityService);
  });

  it('resolves identity through a tenant-scoped alias and returns the updated customer relation', async () => {
    const customer = { id: 'customer-1' };
    const updatedVehicle = {
      id: vehicleId,
      vin: ' vf1abc123 ',
      plate: ' w-123 ',
      make: 'Peugeot',
      model: 'Sandbox Model',
      year: 2024,
      engine_code: 'EB2ADTS',
      hsn: '1234',
      tsn: '567',
      fuel_type: 'PETROL',
      power_kw: 96,
      make_brand_id: 42,
      identity_keys: { vin: 'VF1ABC123' },
      customer_id: customer.id,
    };

    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: ' vf1abc123 ',
        plate: ' w-123 ',
      })
      .mockResolvedValueOnce(updatedVehicle);
    prisma.customer.findFirst.mockResolvedValue(customer);
    prisma.vehicleMakeAlias.findFirst.mockResolvedValue({
      brand: { id: 42, name: 'Peugeot' },
    });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });
    provider.resolve.mockResolvedValue({
      make: 'Peugeot',
      model: 'Sandbox Model',
      year: 2024,
      engine_code: 'EB2ADTS',
      hsn: '1234',
      tsn: '567',
      fuel_type: 'PETROL',
      power_kw: 96,
      identity_keys: { vin: 'VF1ABC123' },
    });

    await expect(service.resolveIdentity(vehicleId)).resolves.toEqual({
      ...updatedVehicle,
      customer,
    });

    expect(tenantContext.getTenantId).toHaveBeenCalledTimes(1);
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
    expect(prisma.vehicle.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        vin: ' vf1abc123 ',
        plate: ' w-123 ',
        identity_resolution_generation: null,
        identity_resolution_token: null,
      },
      data: {
        ...VEHICLE_IDENTITY_RESET,
        identity_resolution_generation: expect.any(String),
        identity_resolution_token: expect.any(String),
      },
    });
    expect(provider.resolve).toHaveBeenCalledWith({
      vin: 'VF1ABC123',
      plate: 'W-123',
    });
    expect(prisma.vehicleMakeAlias.findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        alias_normalized: 'PEUGEOT',
        brand: { tenant_id: tenantId, isVehicleMake: true },
      },
      select: { brand: { select: { id: true, name: true } } },
    });
    expect(prisma.vehicle.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        vin: ' vf1abc123 ',
        plate: ' w-123 ',
        identity_resolution_generation: expect.any(String),
        identity_resolution_token: expect.any(String),
      },
      data: {
        make: 'Peugeot',
        model: 'Sandbox Model',
        year: 2024,
        engine_code: 'EB2ADTS',
        make_brand_id: 42,
        hsn: '1234',
        tsn: '567',
        fuel_type: 'PETROL',
        power_kw: 96,
        identity_keys: { vin: 'VF1ABC123' },
        identity_input_fingerprint: createIdentityInputFingerprint(
          ' vf1abc123 ',
          ' w-123 ',
        ),
        identity_resolved_at: expect.any(Date),
        identity_resolution_token: null,
      },
    });
    expect(prisma.vehicle.findFirst).toHaveBeenNthCalledWith(2, {
      where: { id: vehicleId, tenant_id: tenantId },
    });
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { id: customer.id, tenant_id: tenantId },
    });
  });

  it('does not return a customer from another tenant', async () => {
    const foreignCustomerId = 'customer-from-another-tenant';
    const updatedVehicle = {
      id: vehicleId,
      customer_id: foreignCustomerId,
    };

    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: ' vf1abc123 ',
        plate: null,
      })
      .mockResolvedValueOnce(updatedVehicle);
    prisma.vehicleMakeAlias.findFirst.mockResolvedValue({
      brand: { id: 42, name: 'Peugeot' },
    });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });
    prisma.customer.findFirst.mockResolvedValue(null);
    provider.resolve.mockResolvedValue({
      make: 'Peugeot',
      model: 'Sandbox Model',
    });

    await expect(service.resolveIdentity(vehicleId)).resolves.toEqual({
      ...updatedVehicle,
      customer: null,
    });

    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { id: foreignCustomerId, tenant_id: tenantId },
    });
  });

  it('does not expose identity resolution state in the response', async () => {
    const updatedVehicle = {
      id: vehicleId,
      customer_id: null,
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: null,
    };

    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: 'VF1ABC123',
        plate: null,
      })
      .mockResolvedValueOnce(updatedVehicle);
    prisma.vehicleMakeAlias.findFirst.mockResolvedValue({
      brand: { id: 42, name: 'Peugeot' },
    });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });
    provider.resolve.mockResolvedValue({
      make: 'Peugeot',
      model: 'Sandbox Model',
    });

    const result = await service.resolveIdentity(vehicleId);

    expect(result).toEqual({
      id: vehicleId,
      customer_id: null,
      customer: null,
    });
    expect(result).not.toHaveProperty('identity_resolution_generation');
    expect(result).not.toHaveProperty('identity_resolution_token');
  });

  it('rejects a blank VIN without clearing identity fields or calling the provider', async () => {
    prisma.vehicle.findFirst.mockResolvedValue({
      id: vehicleId,
      vin: '   ',
      plate: ' w-123 ',
    });

    await expect(service.resolveIdentity(vehicleId)).rejects.toThrow(
      BadRequestException,
    );

    expect(prisma.vehicle.updateMany).not.toHaveBeenCalled();
    expect(provider.resolve).not.toHaveBeenCalled();
  });

  it('throws a conflict and does not call the provider when the initial reset loses its race', async () => {
    prisma.vehicle.findFirst.mockResolvedValue({
      id: vehicleId,
      vin: 'VF1ABC123',
      plate: null,
    });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.resolveIdentity(vehicleId)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(provider.resolve).not.toHaveBeenCalled();
  });

  it('guards the initial reset with the legacy VIN value read from storage', async () => {
    prisma.vehicle.findFirst.mockResolvedValue({
      id: vehicleId,
      vin: ' vf1abc123 ',
      plate: null,
      identity_resolution_generation: null,
      identity_resolution_token: null,
    });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.resolveIdentity(vehicleId)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(prisma.vehicle.updateMany).toHaveBeenCalledWith({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        vin: ' vf1abc123 ',
        plate: null,
        identity_resolution_generation: null,
        identity_resolution_token: null,
      },
      data: expect.objectContaining({
        identity_resolution_generation: expect.any(String),
        identity_resolution_token: expect.any(String),
      }),
    });
    expect(provider.resolve).not.toHaveBeenCalled();
  });

  it('rejects an older provider result when a same-input resolution starts later', async () => {
    let releaseFirstProvider!: (result: {
      make: string;
      model: string;
    }) => void;
    let releaseSecondProvider!: (result: {
      make: string;
      model: string;
    }) => void;
    const firstProvider = new Promise<{ make: string; model: string }>(
      (resolve) => {
        releaseFirstProvider = resolve;
      },
    );
    const secondProvider = new Promise<{ make: string; model: string }>(
      (resolve) => {
        releaseSecondProvider = resolve;
      },
    );
    let activeResolutionToken: string | null = null;

    prisma.vehicle.findFirst.mockImplementation(async (args) => {
      if (args.select) {
        return {
          id: vehicleId,
          vin: 'VF1ABC123',
          plate: null,
          identity_resolution_token: null,
        };
      }
      return {
        id: vehicleId,
        vin: 'VF1ABC123',
        plate: null,
        make: 'Newest make',
        model: 'Newest model',
        customer_id: null,
      };
    });
    prisma.vehicleMakeAlias.findFirst.mockResolvedValue({
      brand: { id: 42, name: 'Peugeot' },
    });
    prisma.vehicle.updateMany.mockImplementation(async ({ where, data }) => {
      if (data.make === undefined) {
        activeResolutionToken = data.identity_resolution_token ?? null;
        return { count: 1 };
      }

      return {
        count:
          where.identity_resolution_token === undefined ||
          where.identity_resolution_token === activeResolutionToken
            ? 1
            : 0,
      };
    });
    provider.resolve
      .mockImplementationOnce(() => firstProvider)
      .mockImplementationOnce(() => secondProvider);

    const olderResolution = service.resolveIdentity(vehicleId);
    const newerResolution = service.resolveIdentity(vehicleId);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(provider.resolve).toHaveBeenCalledTimes(2);

    releaseSecondProvider({ make: 'Newest make', model: 'Newest model' });
    await expect(newerResolution).resolves.toBeDefined();

    releaseFirstProvider({ make: 'Older make', model: 'Older model' });
    await expect(olderResolution).rejects.toBeInstanceOf(ConflictException);

    const finalUpdates = prisma.vehicle.updateMany.mock.calls.filter(
      ([args]) => args.data.make !== undefined,
    );
    expect(finalUpdates).toHaveLength(2);
    expect(finalUpdates[0][0].where).toEqual(
      expect.objectContaining({
        identity_resolution_token: expect.any(String),
      }),
    );
    expect(finalUpdates[1][0].where).toEqual(
      expect.objectContaining({
        identity_resolution_token: expect.any(String),
      }),
    );
    expect(finalUpdates[0][0].where.identity_resolution_token).not.toBe(
      finalUpdates[1][0].where.identity_resolution_token,
    );
  });

  it('rejects a stale reset after a newer same-input resolution succeeds', async () => {
    let releaseOlderRead!: (vehicle: {
      id: string;
      vin: string;
      plate: null;
      identity_resolution_token: null;
      identity_resolution_generation: null;
    }) => void;
    const olderRead = new Promise<{
      id: string;
      vin: string;
      plate: null;
      identity_resolution_token: null;
      identity_resolution_generation: null;
    }>((resolve) => {
      releaseOlderRead = resolve;
    });
    let initialReadCount = 0;
    let activeToken: string | null = null;
    let generation: string | null = null;

    prisma.vehicle.findFirst.mockImplementation(async (args) => {
      if (args.select) {
        initialReadCount += 1;
        if (initialReadCount === 1) {
          return olderRead;
        }
        return {
          id: vehicleId,
          vin: 'VF1ABC123',
          plate: null,
          identity_resolution_token: null,
          identity_resolution_generation: null,
        };
      }
      return {
        id: vehicleId,
        vin: 'VF1ABC123',
        plate: null,
        customer_id: null,
      };
    });
    prisma.vehicleMakeAlias.findFirst.mockResolvedValue({
      brand: { id: 42, name: 'Peugeot' },
    });
    prisma.vehicle.updateMany.mockImplementation(async ({ where, data }) => {
      const isReset = data.make === undefined;
      if (isReset && where.identity_resolution_generation !== undefined) {
        if (
          where.identity_resolution_generation !== generation ||
          where.identity_resolution_token !== activeToken
        ) {
          return { count: 0 };
        }
        generation = data.identity_resolution_generation;
        activeToken = data.identity_resolution_token;
        return { count: 1 };
      }

      if (!isReset && where.identity_resolution_generation !== undefined) {
        if (
          where.identity_resolution_generation !== generation ||
          where.identity_resolution_token !== activeToken
        ) {
          return { count: 0 };
        }
        activeToken = data.identity_resolution_token ?? null;
        return { count: 1 };
      }

      if (isReset) {
        activeToken = data.identity_resolution_token ?? null;
      }
      return { count: 1 };
    });
    provider.resolve.mockResolvedValue({
      make: 'Peugeot',
      model: 'Sandbox Model',
    });

    const olderResolution = service.resolveIdentity(vehicleId);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const newerResolution = service.resolveIdentity(vehicleId);
    await expect(newerResolution).resolves.toBeDefined();

    releaseOlderRead({
      id: vehicleId,
      vin: 'VF1ABC123',
      plate: null,
      identity_resolution_token: null,
      identity_resolution_generation: null,
    });
    await expect(olderResolution).rejects.toBeInstanceOf(ConflictException);
    expect(provider.resolve).toHaveBeenCalledTimes(1);
  });

  it('clears identity fields before mapping a provider failure to BadGatewayException', async () => {
    prisma.vehicle.findFirst.mockResolvedValue({
      id: vehicleId,
      vin: ' fail-vehicle-1 ',
      plate: null,
    });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });
    provider.resolve.mockRejectedValue(new Error('provider unavailable'));

    await expect(service.resolveIdentity(vehicleId)).rejects.toThrow(
      new BadGatewayException('provider unavailable'),
    );

    expect(prisma.vehicle.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.vehicle.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        vin: ' fail-vehicle-1 ',
        plate: null,
        identity_resolution_generation: null,
        identity_resolution_token: null,
      },
      data: {
        ...VEHICLE_IDENTITY_RESET,
        identity_resolution_generation: expect.any(String),
        identity_resolution_token: expect.any(String),
      },
    });
    expect(prisma.vehicle.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        vin: ' fail-vehicle-1 ',
        plate: null,
        identity_resolution_generation: expect.any(String),
        identity_resolution_token: expect.any(String),
      },
      data: { identity_resolution_token: null },
    });
    expect(prisma.vehicle.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      provider.resolve.mock.invocationCallOrder[0],
    );
    expect(prisma.vehicleMakeAlias.findFirst).not.toHaveBeenCalled();
  });

  it('performs brand resolution and the successful vehicle update in one transaction', async () => {
    const createdBrand = { id: 77, name: 'Unknown Motors GmbH' };
    const transactionPrisma = {
      vehicle: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vehicleMakeAlias: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      brand: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(createdBrand),
        upsert: jest.fn().mockResolvedValue(createdBrand),
      },
    };

    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transactionPrisma) => Promise<unknown>) =>
        callback(transactionPrisma),
    );
    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: ' wvwabc123 ',
        plate: null,
      })
      .mockResolvedValueOnce({ id: vehicleId });
    prisma.vehicleMakeAlias.findFirst.mockResolvedValue(null);
    prisma.brand.findFirst.mockResolvedValue(null);
    prisma.brand.create.mockResolvedValue(createdBrand);
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });
    provider.resolve.mockResolvedValue({
      make: 'Unknown Motors GmbH',
      model: 'Sandbox Model',
    });

    await expect(service.resolveIdentity(vehicleId)).resolves.toBeDefined();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionPrisma.vehicleMakeAlias.findFirst).toHaveBeenCalled();
    expect(transactionPrisma.brand.upsert).toHaveBeenCalled();
    expect(transactionPrisma.vehicle.updateMany).toHaveBeenCalled();
    expect(prisma.brand.create).not.toHaveBeenCalled();
    expect(prisma.vehicle.updateMany).toHaveBeenCalledTimes(1);
    expect(provider.resolve.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.$transaction.mock.invocationCallOrder[0],
    );
  });

  it('creates an unknown provider make as a tenant vehicle-make without resolving an OEM concern', async () => {
    const createdBrand = { id: 77, name: 'Unknown Motors GmbH' };
    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: ' wvwabc123 ',
        plate: null,
      })
      .mockResolvedValueOnce({ id: vehicleId, customer: null });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehicleMakeAlias.findFirst.mockResolvedValue(null);
    prisma.brand.findFirst.mockResolvedValue(null);
    prisma.brand.create.mockResolvedValue(createdBrand);
    prisma.brand.upsert.mockResolvedValue(createdBrand);
    provider.resolve.mockResolvedValue({
      make: 'Unknown Motors GmbH',
      model: 'Sandbox Model',
      identity_keys: { vin: 'WVWABC123' },
    });

    await expect(service.resolveIdentity(vehicleId)).resolves.toEqual({
      id: vehicleId,
      customer: null,
    });

    expect(prisma.brand.upsert).toHaveBeenCalledWith({
      where: {
        tenant_id_normalized_name: {
          tenant_id: tenantId,
          normalized_name: 'UNKNOWNMOTORSGMBH',
        },
      },
      update: { isVehicleMake: true },
      create: {
        tenant_id: tenantId,
        name: 'Unknown Motors GmbH',
        normalized_name: 'UNKNOWNMOTORSGMBH',
        isVehicleMake: true,
        isPartManufacturer: false,
      },
      select: { id: true, name: true },
    });
    expect(prisma.catalogOemConcern.findFirst).not.toHaveBeenCalled();
    expect(prisma.catalogOemConcernMake.findFirst).not.toHaveBeenCalled();
  });

  it('reuses a case-variant vehicle make and preserves its part-manufacturer classification', async () => {
    const existingBrand = {
      id: 77,
      name: 'unknown motors gmbh',
      normalized_name: 'UNKNOWNMOTORSGMBH',
      isPartManufacturer: true,
    };
    const transactionPrisma = {
      vehicle: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      vehicleMakeAlias: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      brand: {
        findFirst: jest.fn().mockResolvedValue(existingBrand),
        findMany: jest.fn().mockResolvedValue([existingBrand]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn(),
      },
    };

    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof transactionPrisma) => Promise<unknown>) =>
        callback(transactionPrisma),
    );
    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: 'WVWABC123',
        plate: null,
      })
      .mockResolvedValueOnce({ id: vehicleId, customer_id: null });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });
    provider.resolve.mockResolvedValue({
      make: 'Unknown Motors GmbH',
      model: 'Sandbox Model',
    });

    await expect(service.resolveIdentity(vehicleId)).resolves.toEqual({
      id: vehicleId,
      customer_id: null,
      customer: null,
    });

    expect(transactionPrisma.brand.findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: tenantId,
        normalized_name: 'UNKNOWNMOTORSGMBH',
      },
      select: {
        id: true,
        name: true,
        normalized_name: true,
        isVehicleMake: true,
        isPartManufacturer: true,
      },
    });
    expect(transactionPrisma.brand.findMany).not.toHaveBeenCalled();
    expect(transactionPrisma.brand.updateMany).toHaveBeenCalledWith({
      where: { id: existingBrand.id, tenant_id: tenantId },
      data: { isVehicleMake: true },
    });
    expect(transactionPrisma.brand.upsert).not.toHaveBeenCalled();
  });

  it('looks up the vehicle by id and the current tenant before doing any work', async () => {
    prisma.vehicle.findFirst.mockResolvedValue(null);

    await expect(service.resolveIdentity(vehicleId)).rejects.toThrow(
      NotFoundException,
    );

    expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
      where: { id: vehicleId, tenant_id: tenantId },
      select: {
        id: true,
        vin: true,
        plate: true,
        identity_resolution_generation: true,
        identity_resolution_token: true,
      },
    });
    expect(prisma.vehicle.updateMany).not.toHaveBeenCalled();
    expect(provider.resolve).not.toHaveBeenCalled();
  });

  it('rejects a stale provider result when the vehicle identity changed during resolution', async () => {
    prisma.vehicle.findFirst.mockResolvedValueOnce({
      id: vehicleId,
      vin: 'VF1ABC123',
      plate: 'W-123',
    });
    prisma.vehicle.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.vehicleMakeAlias.findFirst.mockResolvedValue({
      brand: { id: 42, name: 'Peugeot' },
    });
    provider.resolve.mockResolvedValue({
      make: 'Peugeot',
      model: 'Sandbox Model',
    });

    await expect(service.resolveIdentity(vehicleId)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(prisma.vehicle.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        vin: 'VF1ABC123',
        plate: 'W-123',
        identity_resolution_generation: expect.any(String),
        identity_resolution_token: expect.any(String),
      },
      data: expect.objectContaining({ make: 'Peugeot' }),
    });
    expect(prisma.vehicle.findFirst).toHaveBeenCalledTimes(1);
  });

  it('retries the complete identity transaction when a make upsert loses a duplicate race', async () => {
    const existingBrand = {
      id: 77,
      name: 'Unknown Motors GmbH',
      normalized_name: 'UNKNOWNMOTORSGMBH',
    };
    const firstTransactionPrisma = {
      vehicle: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      vehicleMakeAlias: { findFirst: jest.fn().mockResolvedValue(null) },
      brand: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        upsert: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: '7.9.1',
          }),
        ),
      },
    };
    const secondTransactionPrisma = {
      vehicle: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      vehicleMakeAlias: { findFirst: jest.fn().mockResolvedValue(null) },
      brand: {
        findFirst: jest.fn().mockResolvedValue(existingBrand),
        findMany: jest.fn().mockResolvedValue([existingBrand]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn(),
      },
    };
    prisma.$transaction
      .mockImplementationOnce(
        async (
          callback: (tx: typeof firstTransactionPrisma) => Promise<unknown>,
        ) => callback(firstTransactionPrisma),
      )
      .mockImplementationOnce(
        async (
          callback: (tx: typeof secondTransactionPrisma) => Promise<unknown>,
        ) => callback(secondTransactionPrisma),
      );
    prisma.vehicle.findFirst
      .mockResolvedValueOnce({
        id: vehicleId,
        vin: 'WVWABC123',
        plate: null,
      })
      .mockResolvedValueOnce({ id: vehicleId, customer_id: null });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });
    provider.resolve.mockResolvedValue({
      make: 'unknown motors gmbh',
      model: 'Sandbox Model',
    });

    await expect(service.resolveIdentity(vehicleId)).resolves.toEqual({
      id: vehicleId,
      customer_id: null,
      customer: null,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(firstTransactionPrisma.brand.findFirst).toHaveBeenCalled();
    expect(secondTransactionPrisma.brand.findFirst).toHaveBeenCalled();
    expect(secondTransactionPrisma.brand.findMany).not.toHaveBeenCalled();
  });
});
