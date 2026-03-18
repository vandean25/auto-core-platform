import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseService } from './purchase.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../inventory/ledger.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseOrderStatus, TransactionType } from '@prisma/client';

describe('PurchaseService', () => {
  let service: PurchaseService;

  const mockPrismaService = {
    $transaction: jest
      .fn()
      .mockImplementation((cb: (tx: any) => any) => cb(mockPrismaService)),
    vendor: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    purchaseOrder: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    purchaseOrderItem: {
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([
        { id: 'poi1', quantity: 10, quantity_received: 0, catalog_item_id: 'item1', unit_cost: 50 },
      ]),
      deleteMany: jest.fn(),
    },
    catalogItem: {
      findMany: jest.fn(),
    },
    storageLocation: {
      findFirst: jest.fn(),
    },
  };

  const mockLedgerService = {
    recordTransaction: jest.fn(),
    recordTransactions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: LedgerService, useValue: mockLedgerService },
      ],
    }).compile();

    service = module.get<PurchaseService>(PurchaseService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPurchaseOrder', () => {
    it('should throw if vendor not found', async () => {
      mockPrismaService.vendor.findUnique.mockResolvedValue(null);
      await expect(service.createPurchaseOrder('v1', [])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw if brand not supported', async () => {
      mockPrismaService.vendor.findUnique.mockResolvedValue({
        id: 'v1',
        name: 'VW Vendor',
        supportedBrands: [{ id: 'brand_vw', name: 'VW' }],
      });
      mockPrismaService.catalogItem.findMany.mockResolvedValue([
        {
          id: 'item1',
          brand: { id: 'brand_bmw', name: 'BMW' },
          brand_id: 'brand_bmw',
        },
      ]);

      await expect(
        service.createPurchaseOrder('v1', [
          { catalogItemId: 'item1', quantity: 1, unitCost: 10 },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create PO if brand supported', async () => {
      mockPrismaService.vendor.findUnique.mockResolvedValue({
        id: 'v1',
        name: 'VW Vendor',
        supportedBrands: [{ id: 'brand_vw', name: 'VW' }],
      });
      mockPrismaService.catalogItem.findMany.mockResolvedValue([
        {
          id: 'item1',
          brand: { id: 'brand_vw', name: 'VW' },
          brand_id: 'brand_vw',
        },
      ]);
      mockPrismaService.purchaseOrder.create.mockResolvedValue({
        id: 'po1',
        order_number: 'PO-2024-001',
        status: PurchaseOrderStatus.DRAFT,
      });

      const result = await service.createPurchaseOrder('v1', [
        { catalogItemId: 'item1', quantity: 1, unitCost: 10 },
      ]);
      expect(result.id).toBe('po1');
      expect(mockPrismaService.purchaseOrder.create).toHaveBeenCalled();
    });

    it('should use secure random number generator for order number', async () => {
      mockPrismaService.vendor.findUnique.mockResolvedValue({
        id: 'v1',
        name: 'VW Vendor',
        supportedBrands: [{ id: 'brand_vw', name: 'VW' }],
      });
      mockPrismaService.catalogItem.findMany.mockResolvedValue([
        {
          id: 'item1',
          brand: { id: 'brand_vw', name: 'VW' },
          brand_id: 'brand_vw',
        },
      ]);
      mockPrismaService.purchaseOrder.create.mockResolvedValue({
        id: 'po1',
        order_number: 'PO-2024-001',
        status: PurchaseOrderStatus.DRAFT,
      });

      const mathRandomSpy = jest.spyOn(Math, 'random');

      await service.createPurchaseOrder('v1', [
        { catalogItemId: 'item1', quantity: 1, unitCost: 10 },
      ]);

      expect(mathRandomSpy).not.toHaveBeenCalled();

      // Verify order number format in the create call arguments
      const createCallArgs =
        mockPrismaService.purchaseOrder.create.mock.calls[0][0];
      expect(createCallArgs.data.order_number).toMatch(/^PO-\d{4}-\d{4}$/);

      mathRandomSpy.mockRestore();
    });
  });

  describe('receiveItems', () => {
    it('should receive items and record ledger transaction', async () => {
      const mockPO = {
        id: 'order1',
        order_number: 'PO-1',
        status: PurchaseOrderStatus.SENT,
        items: [
          {
            id: 'poi1',
            catalog_item_id: 'item1',
            quantity: 10,
            quantity_received: 0,
            unit_cost: 50,
          },
        ],
      };

      mockPrismaService.purchaseOrder.findUnique.mockResolvedValue(mockPO);
      mockPrismaService.storageLocation.findFirst.mockResolvedValue({
        id: 'loc1',
        type: 'warehouse',
      });
      mockPrismaService.purchaseOrderItem.update.mockResolvedValue({});
      mockPrismaService.purchaseOrder.update.mockResolvedValue({});

      await service.receiveItems('order1', [{ itemId: 'item1', quantity: 5 }]);

      expect(mockPrismaService.purchaseOrderItem.update).toHaveBeenCalledWith({
        where: { id: 'poi1' },
        data: { quantity_received: { increment: 5 } },
      });

      expect(mockLedgerService.recordTransactions).toHaveBeenCalledTimes(1);
      expect(mockLedgerService.recordTransactions).toHaveBeenCalledWith([
        expect.objectContaining({
          itemId: 'item1',
          locationId: 'loc1',
          quantity: 5,
          type: TransactionType.PURCHASE_RECEIPT,
          costBasis: 50,
        })],
        expect.anything(),
      );
    });
  });

  describe('findAll', () => {
    it('should return all orders by default when no filter is specified', async () => {
      mockPrismaService.purchaseOrder.findMany.mockResolvedValue([]);
      await service.findAll();
      // Based on code: filter defaults to 'all', which means where is {}
      expect(mockPrismaService.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });

    it('should filter by open status explicitly', async () => {
      mockPrismaService.purchaseOrder.findMany.mockResolvedValue([]);
      await service.findAll('open');
      expect(mockPrismaService.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: {
              in: [
                PurchaseOrderStatus.DRAFT,
                PurchaseOrderStatus.SENT,
                PurchaseOrderStatus.PARTIAL,
              ],
            },
          },
        }),
      );
    });

    it('should return all if filter is all', async () => {
      mockPrismaService.purchaseOrder.findMany.mockResolvedValue([]);
      await service.findAll('all');
      expect(mockPrismaService.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });
  });

  describe('remove', () => {
    it('should delete DRAFT purchase order with no received or invoiced items', async () => {
      mockPrismaService.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-1',
        status: PurchaseOrderStatus.DRAFT,
        items: [
          {
            quantity_received: 0,
            quantity_invoiced: 0,
            purchase_invoice_lines: [],
          },
        ],
      });
      mockPrismaService.purchaseOrderItem.deleteMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.purchaseOrder.delete.mockResolvedValue({ id: 'po-1' });

      await service.remove('po-1');

      expect(
        mockPrismaService.purchaseOrderItem.deleteMany,
      ).toHaveBeenCalledWith({
        where: { purchase_order_id: 'po-1' },
      });
      expect(mockPrismaService.purchaseOrder.delete).toHaveBeenCalledWith({
        where: { id: 'po-1' },
      });
    });

    it('should block deleting non-draft purchase order', async () => {
      mockPrismaService.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-2',
        status: PurchaseOrderStatus.PARTIAL,
        items: [],
      });

      await expect(service.remove('po-2')).rejects.toThrow(BadRequestException);
    });

    it('should block deleting purchase order with received items', async () => {
      mockPrismaService.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-3',
        status: PurchaseOrderStatus.DRAFT,
        items: [
          {
            quantity_received: 1,
            quantity_invoiced: 0,
            purchase_invoice_lines: [],
          },
        ],
      });

      await expect(service.remove('po-3')).rejects.toThrow(BadRequestException);
    });

    it('should block deleting purchase order with invoiced items', async () => {
      mockPrismaService.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po-4',
        status: PurchaseOrderStatus.DRAFT,
        items: [
          {
            quantity_received: 0,
            quantity_invoiced: 0,
            purchase_invoice_lines: [{ id: 'pil-1' }],
          },
        ],
      });

      await expect(service.remove('po-4')).rejects.toThrow(BadRequestException);
      expect(
        mockPrismaService.purchaseOrderItem.deleteMany,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.purchaseOrder.delete).not.toHaveBeenCalled();
    });
  });
});
