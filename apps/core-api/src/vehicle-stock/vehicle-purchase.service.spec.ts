import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  VehicleInventoryRole,
  VehiclePurchaseStatus,
  VehicleStockStatus,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { VEHICLE_IDENTITY_RESET } from '../vehicle/vehicle-identity.util';
import { VehicleLedgerService } from './vehicle-ledger.service';
import { VehiclePurchaseService } from './vehicle-purchase.service';

describe('VehiclePurchaseService', () => {
  const tenantId = 'tenant-1';
  const purchaseId = 'purchase-1';
  const vehicleId = 'vehicle-1';
  let service: VehiclePurchaseService;
  let prisma: {
    $transaction: jest.Mock;
    vehiclePurchase: {
      create: jest.Mock;
      updateMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    vehicle: {
      create: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    financeSettings: { upsert: jest.Mock; update: jest.Mock };
    vendor: { findFirst: jest.Mock };
  };
  let tenantContext: { getTenantId: jest.Mock };
  let ledger: { append: jest.Mock };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(),
      vehiclePurchase: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      vehicle: {
        create: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      financeSettings: {
        upsert: jest.fn(),
        update: jest.fn(),
      },
      vendor: { findFirst: jest.fn() },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
    };
    ledger = { append: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehiclePurchaseService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: VehicleLedgerService, useValue: ledger },
      ],
    }).compile();

    service = module.get(VehiclePurchaseService);
  });

  it('persists a blank VIN as null when creating a vehicle purchase', async () => {
    prisma.vendor.findFirst.mockResolvedValue({ id: 'vendor-1' });
    prisma.financeSettings.upsert.mockResolvedValue({ id: 'settings-1' });
    prisma.financeSettings.update.mockResolvedValue({
      next_vehicle_purchase_number: 2,
    });
    prisma.vehiclePurchase.create.mockResolvedValue({
      id: purchaseId,
      vin: null,
    });

    await service.create({
      seller_type: 'VENDOR',
      vendor_id: 'vendor-1',
      vin: '   ',
      make: 'Peugeot',
      model: '308',
      year: 2024,
      purchase_price: 10000,
    });

    expect(prisma.vehiclePurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ vin: null }),
    });
  });

  it('clears identity fields when receiving a purchase changes a reused vehicle plate', async () => {
    prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehiclePurchase.findFirst.mockResolvedValue({
      id: purchaseId,
      vin: ' vf1abc123 ',
      make: 'Volkswagen',
      model: 'Golf',
      year: 2018,
      engine_code: null,
      plate: 'NEW-1',
      color: null,
      mileage: null,
      key_number: null,
      registration_certificate_no: null,
      location_id: 'location-1',
      customer_id: null,
      purchase_price: 10000,
      status: VehiclePurchaseStatus.DRAFT,
    });
    prisma.vehicle.findFirst.mockResolvedValue({
      id: vehicleId,
      plate: 'OLD-1',
      inventory_role: VehicleInventoryRole.CUSTOMER,
      stock_status: VehicleStockStatus.IN_STOCK,
    });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehiclePurchase.update.mockResolvedValue({
      id: purchaseId,
      vehicle_id: vehicleId,
    });

    await service.receive(purchaseId);

    expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, vin: 'VF1ABC123' },
    });

    expect(prisma.vehicle.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: vehicleId, tenant_id: tenantId }),
      data: expect.objectContaining({
        plate: 'NEW-1',
        ...VEHICLE_IDENTITY_RESET,
      }),
    });
  });

  it('canonicalizes a VIN when updating a draft vehicle purchase', async () => {
    const draftPurchase = {
      id: purchaseId,
      status: VehiclePurchaseStatus.DRAFT,
      seller_type: 'VENDOR',
      vendor_id: 'vendor-1',
      customer_id: null,
    };
    prisma.vehiclePurchase.findFirst
      .mockResolvedValueOnce(draftPurchase)
      .mockResolvedValueOnce({ ...draftPurchase, vin: 'VF1ABC123' });
    prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });

    await service.updateDraft(purchaseId, { vin: ' vf1abc123 ' });

    expect(prisma.vehiclePurchase.updateMany).toHaveBeenCalledWith({
      where: {
        id: purchaseId,
        tenant_id: tenantId,
        status: VehiclePurchaseStatus.DRAFT,
      },
      data: expect.objectContaining({ vin: 'VF1ABC123' }),
    });
  });

  it('persists a blank VIN as null when updating a draft vehicle purchase', async () => {
    const draftPurchase = {
      id: purchaseId,
      status: VehiclePurchaseStatus.DRAFT,
      seller_type: 'VENDOR',
      vendor_id: 'vendor-1',
      customer_id: null,
    };
    prisma.vehiclePurchase.findFirst
      .mockResolvedValueOnce(draftPurchase)
      .mockResolvedValueOnce({ ...draftPurchase, vin: null });
    prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });

    await service.updateDraft(purchaseId, { vin: '   ' });

    expect(prisma.vehiclePurchase.updateMany).toHaveBeenCalledWith({
      where: {
        id: purchaseId,
        tenant_id: tenantId,
        status: VehiclePurchaseStatus.DRAFT,
      },
      data: expect.objectContaining({ vin: null }),
    });
  });

  it('rejects one of two concurrent updates based on the same draft read', async () => {
    const readVersion = new Date('2026-08-29T12:00:00.000Z');
    let currentPurchase = {
      id: purchaseId,
      status: VehiclePurchaseStatus.DRAFT,
      seller_type: 'VENDOR',
      vendor_id: 'vendor-1',
      customer_id: null,
      updatedAt: readVersion,
    };
    prisma.vehiclePurchase.findFirst.mockImplementation(async () => ({
      ...currentPurchase,
    }));
    prisma.vehiclePurchase.updateMany.mockImplementation(
      async ({ where, data }: { where: { updatedAt?: Date }; data: object }) => {
        if (
          where.updatedAt?.getTime() !== currentPurchase.updatedAt.getTime()
        ) {
          return { count: 0 };
        }
        currentPurchase = {
          ...currentPurchase,
          ...data,
          updatedAt: new Date('2026-08-29T12:00:01.000Z'),
        };
        return { count: 1 };
      },
    );

    const results = await Promise.allSettled([
      service.updateDraft(purchaseId, { make: 'Peugeot' }),
      service.updateDraft(purchaseId, { make: 'Volkswagen' }),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toBeDefined();
    expect(rejected).toMatchObject({ reason: expect.any(ConflictException) });
    expect(prisma.vehiclePurchase.updateMany).toHaveBeenCalledWith({
      where: {
        id: purchaseId,
        tenant_id: tenantId,
        status: VehiclePurchaseStatus.DRAFT,
        updatedAt: readVersion,
      },
      data: expect.objectContaining({ make: expect.any(String) }),
    });
  });

  it('looks up and creates a vehicle with a nullable blank VIN when receiving a purchase', async () => {
    const purchase = {
      id: purchaseId,
      vin: '   ',
      make: 'Peugeot',
      model: '308',
      year: 2024,
      engine_code: null,
      plate: null,
      color: null,
      mileage: null,
      key_number: null,
      registration_certificate_no: null,
      location_id: 'location-1',
      customer_id: null,
      purchase_price: 10000,
      status: VehiclePurchaseStatus.DRAFT,
    };
    prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehiclePurchase.findFirst
      .mockResolvedValueOnce(purchase)
      .mockResolvedValueOnce({ ...purchase, vehicle_id: vehicleId });
    prisma.vehicle.findFirst.mockResolvedValue(null);
    prisma.vehicle.create.mockResolvedValue({ id: vehicleId, vin: null });

    await service.receive(purchaseId);

    expect(prisma.vehicle.findFirst).not.toHaveBeenCalled();
    expect(prisma.vehicle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ vin: null }),
    });
  });

  it('creates a new vehicle instead of reusing an existing VIN-less vehicle', async () => {
    const purchase = {
      id: purchaseId,
      vin: null,
      make: 'Peugeot',
      model: '308',
      year: 2024,
      engine_code: null,
      plate: 'NEW-PLATE',
      color: null,
      mileage: null,
      key_number: null,
      registration_certificate_no: null,
      location_id: 'location-1',
      customer_id: null,
      purchase_price: 10000,
      status: VehiclePurchaseStatus.DRAFT,
    };
    prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehiclePurchase.findFirst
      .mockResolvedValueOnce(purchase)
      .mockResolvedValueOnce({ ...purchase, vehicle_id: vehicleId });
    prisma.vehicle.findFirst.mockResolvedValue({
      id: 'unrelated-v-1',
      vin: null,
      plate: 'OTHER-PLATE',
      inventory_role: VehicleInventoryRole.CUSTOMER,
      stock_status: VehicleStockStatus.IN_STOCK,
    });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehicle.create.mockResolvedValue({ id: vehicleId, vin: null });

    await service.receive(purchaseId);

    expect(prisma.vehicle.findFirst).not.toHaveBeenCalled();
    expect(prisma.vehicle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ vin: null }),
    });
  });

  it('does not clear identity fields when receiving a purchase with an equivalent normalized plate', async () => {
    prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehiclePurchase.findFirst.mockResolvedValue({
      id: purchaseId,
      vin: 'VIN-1',
      make: 'Volkswagen',
      model: 'Golf',
      year: 2018,
      engine_code: null,
      plate: 'PL-1',
      color: null,
      mileage: null,
      key_number: null,
      registration_certificate_no: null,
      location_id: 'location-1',
      customer_id: null,
      purchase_price: 10000,
      status: VehiclePurchaseStatus.DRAFT,
    });
    prisma.vehicle.findFirst.mockResolvedValue({
      id: vehicleId,
      plate: ' pl-1 ',
      inventory_role: VehicleInventoryRole.CUSTOMER,
      stock_status: VehicleStockStatus.IN_STOCK,
    });
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehiclePurchase.update.mockResolvedValue({
      id: purchaseId,
      vehicle_id: vehicleId,
    });

    await service.receive(purchaseId);

    const updateData = prisma.vehicle.updateMany.mock.calls[0][0].data;
    for (const resetKey of Object.keys(VEHICLE_IDENTITY_RESET)) {
      expect(updateData).not.toHaveProperty(resetKey);
    }
  });

  it('rejects receiving a reused vehicle after identity resolution advances the generation', async () => {
    prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehiclePurchase.findFirst.mockResolvedValue({
      id: purchaseId,
      vin: ' vf1abc123 ',
      make: 'Volkswagen',
      model: 'Golf',
      year: 2018,
      engine_code: null,
      plate: 'NEW-1',
      color: null,
      mileage: null,
      key_number: null,
      registration_certificate_no: null,
      location_id: 'location-1',
      customer_id: null,
      purchase_price: 10000,
      status: VehiclePurchaseStatus.DRAFT,
    });
    prisma.vehicle.findFirst.mockResolvedValue({
      id: vehicleId,
      vin: 'VF1ABC123',
      plate: 'OLD-1',
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: null,
      inventory_role: VehicleInventoryRole.CUSTOMER,
      stock_status: VehicleStockStatus.IN_STOCK,
    });
    prisma.vehicle.updateMany.mockImplementation(async ({ where }) => ({
      count: where.identity_resolution_generation === 'generation-2' ? 1 : 0,
    }));

    await expect(service.receive(purchaseId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(ledger.append).not.toHaveBeenCalled();
    expect(prisma.vehicle.updateMany).toHaveBeenCalledWith({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        vin: 'VF1ABC123',
        plate: 'OLD-1',
        identity_resolution_generation: 'generation-1',
        identity_resolution_token: null,
        OR: [
          { inventory_role: { not: VehicleInventoryRole.USED } },
          { stock_status: null },
          {
            stock_status: {
              notIn: [
                VehicleStockStatus.ON_ORDER,
                VehicleStockStatus.IN_STOCK,
                VehicleStockStatus.RESERVED,
                VehicleStockStatus.IN_PREP,
              ],
            },
          },
        ],
      },
      data: expect.objectContaining({ plate: 'NEW-1' }),
    });
  });
});
