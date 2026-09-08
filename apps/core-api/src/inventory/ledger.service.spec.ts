import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TransactionType, LocationType, Prisma } from '@prisma/client';
import { LedgerService, RecordTransactionParams } from './ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';

describe('LedgerService', () => {
  let service: LedgerService;
  let mockPrisma: any;
  let mockTenantContext: { getTenantId: jest.Mock };

  const TENANT_ID = 'tenant-uuid-123';
  const ITEM_ID = 'item-uuid-1';
  const LOCATION_ID = 'loc-bin-1';

  beforeEach(async () => {
    mockPrisma = {
      storageLocation: {
        findMany: jest.fn(),
      },
      inventoryTransaction: {
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
      inventoryStock: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    mockTenantContext = {
      getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TenantContextService, useValue: mockTenantContext },
      ],
    }).compile();

    service = module.get<LedgerService>(LedgerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('recordTransactions', () => {
    it('should return early when params array is empty', async () => {
      await service.recordTransactions([]);

      expect(mockTenantContext.getTenantId).not.toHaveBeenCalled();
      expect(mockPrisma.storageLocation.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.inventoryTransaction.createMany).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if location is not found', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([]);

      const params: RecordTransactionParams[] = [
        {
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 5,
          type: TransactionType.PURCHASE_RECEIPT,
        },
      ];

      await expect(service.recordTransactions(params)).rejects.toThrow(
        new BadRequestException(`Location ${LOCATION_ID} not found`),
      );
      expect(mockPrisma.storageLocation.findMany).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, id: { in: [LOCATION_ID] } },
      });
    });

    it('should throw BadRequestException if location type cannot store stock', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([
        {
          id: LOCATION_ID,
          type: LocationType.aisle,
          name: 'Aisle 1',
        },
      ]);

      const params: RecordTransactionParams[] = [
        {
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 5,
          type: TransactionType.PURCHASE_RECEIPT,
        },
      ];

      await expect(service.recordTransactions(params)).rejects.toThrow(
        new BadRequestException(
          `Stock can only be stored in BIN or STAGING_TOTE locations. Current type: aisle (Aisle 1)`,
        ),
      );
    });

    it('should accept bin and staging_tote locations', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([
        { id: 'loc-bin', type: LocationType.bin, name: 'Bin 1' },
        { id: 'loc-tote', type: LocationType.staging_tote, name: 'Tote 1' },
      ]);
      mockPrisma.inventoryStock.findMany.mockResolvedValue([]);
      mockPrisma.inventoryStock.create
        .mockResolvedValueOnce({ id: 'stock-1', quantity_on_hand: 5 })
        .mockResolvedValueOnce({ id: 'stock-2', quantity_on_hand: 3 });

      const params: RecordTransactionParams[] = [
        {
          itemId: ITEM_ID,
          locationId: 'loc-bin',
          quantity: 5,
          type: TransactionType.PURCHASE_RECEIPT,
        },
        {
          itemId: ITEM_ID,
          locationId: 'loc-tote',
          quantity: 3,
          type: TransactionType.TRANSFER_IN,
        },
      ];

      await expect(service.recordTransactions(params)).resolves.not.toThrow();
      expect(mockPrisma.inventoryTransaction.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            tenant_id: TENANT_ID,
            item_id: ITEM_ID,
            location_id: 'loc-bin',
            type: TransactionType.PURCHASE_RECEIPT,
          }),
          expect.objectContaining({
            tenant_id: TENANT_ID,
            item_id: ITEM_ID,
            location_id: 'loc-tote',
            type: TransactionType.TRANSFER_IN,
          }),
        ],
      });
    });

    it('should create new stock record when existing stock does not exist', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([
        { id: LOCATION_ID, type: LocationType.bin, name: 'Bin 1' },
      ]);
      mockPrisma.inventoryStock.findMany.mockResolvedValue([]);
      mockPrisma.inventoryStock.create.mockResolvedValue({
        id: 'stock-new-1',
        tenant_id: TENANT_ID,
        catalog_item_id: ITEM_ID,
        location_id: LOCATION_ID,
        quantity_on_hand: 10,
        quantity_reserved: 0,
      });

      const params: RecordTransactionParams[] = [
        {
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 10,
          type: TransactionType.PURCHASE_RECEIPT,
          costBasis: 15.5,
          referenceId: 'po-ref-1',
        },
      ];

      await service.recordTransactions(params);

      expect(mockPrisma.inventoryTransaction.createMany).toHaveBeenCalledWith({
        data: [
          {
            tenant_id: TENANT_ID,
            item_id: ITEM_ID,
            location_id: LOCATION_ID,
            quantity: new Prisma.Decimal('10'),
            type: TransactionType.PURCHASE_RECEIPT,
            reference_id: 'po-ref-1',
            cost_basis: new Prisma.Decimal('15.5'),
          },
        ],
      });
      expect(mockPrisma.inventoryStock.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          catalog_item_id: ITEM_ID,
          location_id: LOCATION_ID,
          quantity_on_hand: 10,
          quantity_reserved: 0,
        },
      });
    });

    it('should aggregate duplicate item/location pairs before applying stock updates', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([
        { id: LOCATION_ID, type: LocationType.bin, name: 'Bin 1' },
      ]);
      mockPrisma.inventoryStock.findMany.mockResolvedValue([
        {
          id: 'stock-existing-1',
          catalog_item_id: ITEM_ID,
          location_id: LOCATION_ID,
          quantity_on_hand: 20,
        },
      ]);
      mockPrisma.inventoryStock.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.inventoryStock.findFirst.mockResolvedValue({
        id: 'stock-existing-1',
        quantity_on_hand: 35,
      });

      const params: RecordTransactionParams[] = [
        {
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 10,
          type: TransactionType.PURCHASE_RECEIPT,
        },
        {
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 5,
          type: TransactionType.PURCHASE_RECEIPT,
        },
      ];

      await service.recordTransactions(params);

      // Inventory transactions are both logged individually
      expect(mockPrisma.inventoryTransaction.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ quantity: new Prisma.Decimal('10') }),
          expect.objectContaining({ quantity: new Prisma.Decimal('5') }),
        ]),
      });

      // Stock is updated once with aggregated delta = 15
      expect(mockPrisma.inventoryStock.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.inventoryStock.updateMany).toHaveBeenCalledWith({
        where: { id: 'stock-existing-1', tenant_id: TENANT_ID },
        data: {
          quantity_on_hand: {
            increment: 15,
          },
        },
      });
    });

    it('should throw BadRequestException if updateMany matches 0 records', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([
        { id: LOCATION_ID, type: LocationType.bin, name: 'Bin 1' },
      ]);
      mockPrisma.inventoryStock.findMany.mockResolvedValue([
        {
          id: 'stock-stale-1',
          catalog_item_id: ITEM_ID,
          location_id: LOCATION_ID,
          quantity_on_hand: 5,
        },
      ]);
      mockPrisma.inventoryStock.updateMany.mockResolvedValue({ count: 0 });

      const params: RecordTransactionParams[] = [
        {
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 2,
          type: TransactionType.PURCHASE_RECEIPT,
        },
      ];

      await expect(service.recordTransactions(params)).rejects.toThrow(
        new BadRequestException(
          `Inventory stock stock-stale-1 not found for current tenant`,
        ),
      );
    });

    it('should throw BadRequestException if refreshed stock record cannot be found', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([
        { id: LOCATION_ID, type: LocationType.bin, name: 'Bin 1' },
      ]);
      mockPrisma.inventoryStock.findMany.mockResolvedValue([
        {
          id: 'stock-1',
          catalog_item_id: ITEM_ID,
          location_id: LOCATION_ID,
          quantity_on_hand: 5,
        },
      ]);
      mockPrisma.inventoryStock.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.inventoryStock.findFirst.mockResolvedValue(null);

      const params: RecordTransactionParams[] = [
        {
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 2,
          type: TransactionType.PURCHASE_RECEIPT,
        },
      ];

      await expect(service.recordTransactions(params)).rejects.toThrow(
        new BadRequestException(
          `Inventory stock stock-1 not found after update`,
        ),
      );
    });

    it('should throw BadRequestException when transaction results in negative stock', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([
        { id: LOCATION_ID, type: LocationType.bin, name: 'Bin 1' },
      ]);
      mockPrisma.inventoryStock.findMany.mockResolvedValue([
        {
          id: 'stock-1',
          catalog_item_id: ITEM_ID,
          location_id: LOCATION_ID,
          quantity_on_hand: 2,
        },
      ]);
      mockPrisma.inventoryStock.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.inventoryStock.findFirst.mockResolvedValue({
        id: 'stock-1',
        quantity_on_hand: -3,
      });

      const params: RecordTransactionParams[] = [
        {
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: -5,
          type: TransactionType.SALE,
        },
      ];

      await expect(service.recordTransactions(params)).rejects.toThrow(
        new BadRequestException(
          `Insufficient Stock: Transaction would result in negative stock (-3) for item ${ITEM_ID} at location ${LOCATION_ID}`,
        ),
      );
    });

    it('should use provided transaction client when passed', async () => {
      const mockTx: any = {
        storageLocation: {
          findMany: jest.fn().mockResolvedValue([
            { id: LOCATION_ID, type: LocationType.bin, name: 'Bin 1' },
          ]),
        },
        inventoryTransaction: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        inventoryStock: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({
            id: 'stock-tx-1',
            quantity_on_hand: 5,
          }),
        },
      };

      const params: RecordTransactionParams[] = [
        {
          itemId: ITEM_ID,
          locationId: LOCATION_ID,
          quantity: 5,
          type: TransactionType.PURCHASE_RECEIPT,
        },
      ];

      await service.recordTransactions(params, mockTx);

      expect(mockTx.storageLocation.findMany).toHaveBeenCalled();
      expect(mockTx.inventoryTransaction.createMany).toHaveBeenCalled();
      expect(mockTx.inventoryStock.create).toHaveBeenCalled();
      expect(mockPrisma.storageLocation.findMany).not.toHaveBeenCalled();
    });
  });

  describe('recordTransaction', () => {
    it('should delegate single parameter to recordTransactions', async () => {
      const spy = jest
        .spyOn(service, 'recordTransactions')
        .mockResolvedValue(undefined);

      const params: RecordTransactionParams = {
        itemId: ITEM_ID,
        locationId: LOCATION_ID,
        quantity: 1,
        type: TransactionType.PURCHASE_RECEIPT,
      };

      await service.recordTransaction(params);

      expect(spy).toHaveBeenCalledWith([params], undefined);
    });
  });

  describe('getTransactionHistory', () => {
    it('should fetch transactions ordered by createdAt desc with tenant filter', async () => {
      const mockRecords = [
        {
          id: 'tx-1',
          quantity: new Prisma.Decimal('10'),
          type: TransactionType.PURCHASE_RECEIPT,
          reference_id: 'ref-1',
          cost_basis: new Prisma.Decimal('12.5'),
          createdAt: new Date(),
          item: { sku: 'SKU-1', name: 'Item 1' },
          location: { name: 'Bin A1' },
        },
      ];
      mockPrisma.inventoryTransaction.findMany.mockResolvedValue(mockRecords);

      const result = await service.getTransactionHistory(ITEM_ID, LOCATION_ID);

      expect(mockPrisma.inventoryTransaction.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          item_id: ITEM_ID,
          location_id: LOCATION_ID,
        },
        select: expect.objectContaining({
          id: true,
          quantity: true,
          type: true,
          reference_id: true,
          cost_basis: true,
          createdAt: true,
          item: { select: { sku: true, name: true } },
          location: { select: { name: true } },
        }),
        orderBy: {
          createdAt: 'desc',
        },
      });
      expect(result).toBe(mockRecords);
    });

    it('should fetch transactions without location filter if locationId is omitted', async () => {
      mockPrisma.inventoryTransaction.findMany.mockResolvedValue([]);

      await service.getTransactionHistory(ITEM_ID);

      expect(mockPrisma.inventoryTransaction.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          item_id: ITEM_ID,
        },
        select: expect.any(Object),
        orderBy: {
          createdAt: 'desc',
        },
      });
    });
  });

  describe('verifyLedgerIntegrity', () => {
    it('should return true when transaction quantity sum equals stock quantity', async () => {
      mockPrisma.inventoryTransaction.findMany.mockResolvedValue([
        { quantity: new Prisma.Decimal('10') },
        { quantity: new Prisma.Decimal('5') },
        { quantity: new Prisma.Decimal('-3') },
      ]);
      mockPrisma.inventoryStock.findFirst.mockResolvedValue({
        quantity_on_hand: 12,
      });

      const result = await service.verifyLedgerIntegrity(ITEM_ID, LOCATION_ID);

      expect(mockPrisma.inventoryTransaction.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          item_id: ITEM_ID,
          location_id: LOCATION_ID,
        },
      });
      expect(mockPrisma.inventoryStock.findFirst).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          catalog_item_id: ITEM_ID,
          location_id: LOCATION_ID,
        },
      });
      expect(result).toBe(true);
    });

    it('should return false when transaction quantity sum differs from stock quantity', async () => {
      mockPrisma.inventoryTransaction.findMany.mockResolvedValue([
        { quantity: new Prisma.Decimal('10') },
      ]);
      mockPrisma.inventoryStock.findFirst.mockResolvedValue({
        quantity_on_hand: 8,
      });

      const result = await service.verifyLedgerIntegrity(ITEM_ID, LOCATION_ID);

      expect(result).toBe(false);
    });

    it('should return true when no transactions exist and stock is null/0', async () => {
      mockPrisma.inventoryTransaction.findMany.mockResolvedValue([]);
      mockPrisma.inventoryStock.findFirst.mockResolvedValue(null);

      const result = await service.verifyLedgerIntegrity(ITEM_ID, LOCATION_ID);

      expect(result).toBe(true);
    });
  });
});
