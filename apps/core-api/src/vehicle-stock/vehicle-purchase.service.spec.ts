import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  Prisma,
  VehicleInventoryRole,
  VehicleLedgerEntryType,
  VehiclePurchaseSellerType,
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
      deleteMany: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    vehicle: {
      create: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    financeSettings: { upsert: jest.Mock; update: jest.Mock };
    vendor: { findFirst: jest.Mock };
    customer: { findFirst: jest.Mock };
    storageLocation: { findFirst: jest.Mock };
    vehicleLedgerEntry: { count: jest.Mock };
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
        deleteMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
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
      customer: { findFirst: jest.fn() },
      storageLocation: { findFirst: jest.fn() },
      vehicleLedgerEntry: { count: jest.fn() },
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

  describe('create', () => {
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
        seller_type: VehiclePurchaseSellerType.VENDOR,
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

    it('throws BadRequestException if vendor_id is missing for VENDOR seller_type', async () => {
      await expect(
        service.create({
          seller_type: VehiclePurchaseSellerType.VENDOR,
          make: 'Peugeot',
          model: '308',
          year: 2024,
          purchase_price: 10000,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException if customer_id is missing for CUSTOMER seller_type', async () => {
      await expect(
        service.create({
          seller_type: VehiclePurchaseSellerType.CUSTOMER,
          make: 'Peugeot',
          model: '308',
          year: 2024,
          purchase_price: 10000,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when vendor does not exist in tenant', async () => {
      prisma.vendor.findFirst.mockResolvedValue(null);

      await expect(
        service.create({
          seller_type: VehiclePurchaseSellerType.VENDOR,
          vendor_id: 'non-existent-vendor',
          make: 'Peugeot',
          model: '308',
          year: 2024,
          purchase_price: 10000,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when storage location does not exist in tenant', async () => {
      prisma.vendor.findFirst.mockResolvedValue({ id: 'vendor-1' });
      prisma.storageLocation.findFirst.mockResolvedValue(null);

      await expect(
        service.create({
          seller_type: VehiclePurchaseSellerType.VENDOR,
          vendor_id: 'vendor-1',
          location_id: 'missing-loc',
          make: 'Peugeot',
          model: '308',
          year: 2024,
          purchase_price: 10000,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateDraft', () => {
    it('canonicalizes a VIN when updating a draft vehicle purchase', async () => {
      const draftPurchase = {
        id: purchaseId,
        status: VehiclePurchaseStatus.DRAFT,
        seller_type: VehiclePurchaseSellerType.VENDOR,
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
        seller_type: VehiclePurchaseSellerType.VENDOR,
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

    it('throws ConflictException when updating non-draft purchase', async () => {
      prisma.vehiclePurchase.findFirst.mockResolvedValue({
        id: purchaseId,
        status: VehiclePurchaseStatus.RECEIVED,
      });

      await expect(
        service.updateDraft(purchaseId, { make: 'Toyota' }),
      ).rejects.toThrow(
        new ConflictException('Only DRAFT purchases can be updated'),
      );
    });

    it('throws BadRequestException when updating to VENDOR without vendor_id', async () => {
      prisma.vehiclePurchase.findFirst.mockResolvedValue({
        id: purchaseId,
        status: VehiclePurchaseStatus.DRAFT,
        seller_type: VehiclePurchaseSellerType.CUSTOMER,
        customer_id: 'cust-1',
        vendor_id: null,
      });

      await expect(
        service.updateDraft(purchaseId, {
          seller_type: VehiclePurchaseSellerType.VENDOR,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ConflictException if updateMany returns count 0 (concurrent update)', async () => {
      const draftPurchase = {
        id: purchaseId,
        status: VehiclePurchaseStatus.DRAFT,
        seller_type: VehiclePurchaseSellerType.VENDOR,
        vendor_id: 'vendor-1',
        customer_id: null,
      };
      prisma.vehiclePurchase.findFirst.mockResolvedValue(draftPurchase);
      prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateDraft(purchaseId, { make: 'Ford' }),
      ).rejects.toThrow(
        new ConflictException('Only DRAFT purchases can be updated'),
      );
    });

    it('rejects one of two concurrent updates based on the same draft read', async () => {
      const readVersion = new Date('2026-08-29T12:00:00.000Z');
      let currentPurchase = {
        id: purchaseId,
        status: VehiclePurchaseStatus.DRAFT,
        seller_type: VehiclePurchaseSellerType.VENDOR,
        vendor_id: 'vendor-1',
        customer_id: null,
        updatedAt: readVersion,
      };
      prisma.vehiclePurchase.findFirst.mockImplementation(async () => ({
        ...currentPurchase,
      }));
      prisma.vehiclePurchase.updateMany.mockImplementation(
        async ({
          where,
          data,
        }: {
          where: { updatedAt?: Date };
          data: object;
        }) => {
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
  });

  describe('receive', () => {
    const defaultDraftPurchase = {
      id: purchaseId,
      vin: 'VF1ABC123',
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
    };

    it('throws ConflictException when purchase is not in DRAFT status', async () => {
      prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.receive(purchaseId)).rejects.toThrow(
        new ConflictException('Purchase is not in DRAFT status'),
      );
    });

    it('throws NotFoundException when purchase is missing after draft update', async () => {
      prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
      prisma.vehiclePurchase.findFirst.mockResolvedValue(null);

      await expect(service.receive(purchaseId)).rejects.toThrow(
        new NotFoundException(`Vehicle purchase ${purchaseId} not found`),
      );
    });

    it('clears identity fields when receiving a purchase changes a reused vehicle plate', async () => {
      prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
      prisma.vehiclePurchase.findFirst.mockResolvedValue({
        ...defaultDraftPurchase,
        vin: ' vf1abc123 ',
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

    it('does not clear identity fields when receiving a purchase with an equivalent normalized plate', async () => {
      prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
      prisma.vehiclePurchase.findFirst.mockResolvedValue({
        ...defaultDraftPurchase,
        plate: 'PL-1',
      });
      prisma.vehicle.findFirst.mockResolvedValue({
        id: vehicleId,
        plate: ' pl-1 ',
        inventory_role: VehicleInventoryRole.CUSTOMER,
        stock_status: VehicleStockStatus.IN_STOCK,
      });
      prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

      await service.receive(purchaseId);

      const updateData = prisma.vehicle.updateMany.mock.calls[0][0].data;
      for (const resetKey of Object.keys(VEHICLE_IDENTITY_RESET)) {
        expect(updateData).not.toHaveProperty(resetKey);
      }
    });

    it('looks up and creates a vehicle with a nullable blank VIN when receiving a purchase', async () => {
      const purchase = {
        ...defaultDraftPurchase,
        vin: '   ',
        make: 'Peugeot',
        model: '308',
        year: 2024,
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
      expect(ledger.append).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleId,
          entryType: VehicleLedgerEntryType.PURCHASE,
          vehiclePurchaseId: purchaseId,
        }),
        expect.anything(),
      );
    });

    it('creates a new vehicle instead of reusing an existing VIN-less vehicle', async () => {
      const purchase = {
        ...defaultDraftPurchase,
        vin: null,
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

    it('rejects receiving a reused vehicle after identity resolution advances the generation', async () => {
      prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
      prisma.vehiclePurchase.findFirst.mockResolvedValue(defaultDraftPurchase);
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
    });

    it('throws ConflictException when creating a vehicle encounters P2002 duplicate key', async () => {
      prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
      prisma.vehiclePurchase.findFirst.mockResolvedValue(defaultDraftPurchase);
      prisma.vehicle.findFirst.mockResolvedValue(null);

      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint violation',
        { code: 'P2002', clientVersion: '7.0.0' },
      );
      prisma.vehicle.create.mockRejectedValue(p2002Error);

      await expect(service.receive(purchaseId)).rejects.toThrow(
        new ConflictException('VIN is already in dealer stock'),
      );
    });

    it('rethrows unexpected non-P2002 errors during vehicle creation', async () => {
      prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
      prisma.vehiclePurchase.findFirst.mockResolvedValue(defaultDraftPurchase);
      prisma.vehicle.findFirst.mockResolvedValue(null);
      prisma.vehicle.create.mockRejectedValue(
        new Error('Database disk failure'),
      );

      await expect(service.receive(purchaseId)).rejects.toThrow(
        'Database disk failure',
      );
    });

    it('throws ConflictException if linking vehicle to purchase fails (count 0)', async () => {
      prisma.vehiclePurchase.updateMany
        .mockResolvedValueOnce({ count: 1 }) // guarded draft check
        .mockResolvedValueOnce({ count: 0 }); // link purchase failure
      prisma.vehiclePurchase.findFirst.mockResolvedValue(defaultDraftPurchase);
      prisma.vehicle.findFirst.mockResolvedValue(null);
      prisma.vehicle.create.mockResolvedValue({
        id: vehicleId,
        vin: 'VF1ABC123',
      });

      await expect(service.receive(purchaseId)).rejects.toThrow(
        new ConflictException(
          'Vehicle purchase changed while receiving; please retry',
        ),
      );
    });

    it('throws NotFoundException if received purchase cannot be re-fetched after link', async () => {
      prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
      prisma.vehiclePurchase.findFirst
        .mockResolvedValueOnce(defaultDraftPurchase)
        .mockResolvedValueOnce(null);
      prisma.vehicle.findFirst.mockResolvedValue(null);
      prisma.vehicle.create.mockResolvedValue({
        id: vehicleId,
        vin: 'VF1ABC123',
      });

      await expect(service.receive(purchaseId)).rejects.toThrow(
        new NotFoundException(`Vehicle purchase ${purchaseId} not found`),
      );
    });
  });

  describe('cancel', () => {
    it('throws ConflictException when cancelling non-draft purchase', async () => {
      prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancel(purchaseId)).rejects.toThrow(
        new ConflictException('Only DRAFT purchases can be cancelled'),
      );
    });

    it('cancels draft purchase and returns purchase record', async () => {
      prisma.vehiclePurchase.updateMany.mockResolvedValue({ count: 1 });
      prisma.vehiclePurchase.findFirst.mockResolvedValue({
        id: purchaseId,
        status: VehiclePurchaseStatus.CANCELLED,
      });

      const result = await service.cancel(purchaseId);

      expect(prisma.vehiclePurchase.updateMany).toHaveBeenCalledWith({
        where: {
          id: purchaseId,
          tenant_id: tenantId,
          status: VehiclePurchaseStatus.DRAFT,
        },
        data: { status: VehiclePurchaseStatus.CANCELLED },
      });
      expect(result.status).toBe(VehiclePurchaseStatus.CANCELLED);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException if purchase does not exist', async () => {
      prisma.vehiclePurchase.findFirst.mockResolvedValue(null);

      await expect(service.remove(purchaseId)).rejects.toThrow(
        new NotFoundException(`Vehicle purchase ${purchaseId} not found`),
      );
    });

    it('throws ConflictException if purchase is not in DRAFT status', async () => {
      prisma.vehiclePurchase.findFirst.mockResolvedValue({
        id: purchaseId,
        status: VehiclePurchaseStatus.RECEIVED,
      });

      await expect(service.remove(purchaseId)).rejects.toThrow(
        new ConflictException('Only DRAFT purchases can be deleted'),
      );
    });

    it('throws ConflictException if vehicle ledger entries exist for purchase', async () => {
      prisma.vehiclePurchase.findFirst.mockResolvedValue({
        id: purchaseId,
        status: VehiclePurchaseStatus.DRAFT,
      });
      prisma.vehicleLedgerEntry.count.mockResolvedValue(1);

      await expect(service.remove(purchaseId)).rejects.toThrow(
        new ConflictException(
          'Vehicle purchase cannot be deleted because ledger entries exist',
        ),
      );
    });

    it('deletes draft purchase successfully when no ledger entries exist', async () => {
      prisma.vehiclePurchase.findFirst.mockResolvedValue({
        id: purchaseId,
        status: VehiclePurchaseStatus.DRAFT,
      });
      prisma.vehicleLedgerEntry.count.mockResolvedValue(0);
      prisma.vehiclePurchase.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.remove(purchaseId);

      expect(prisma.vehiclePurchase.deleteMany).toHaveBeenCalledWith({
        where: {
          id: purchaseId,
          tenant_id: tenantId,
          status: VehiclePurchaseStatus.DRAFT,
        },
      });
      expect(result).toEqual({ id: purchaseId });
    });
  });
});
