import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseService } from './purchase.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../inventory/ledger.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
      findFirst: jest.fn(),
    },
    purchaseOrderItem: {
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
    purchaseOrder: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    purchaseOrderItem: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'poi1',
          quantity: 10,
          quantity_received: 0,
          catalog_item_id: 'item1',
          unit_cost: 50,
        },
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

  const mockTenantContextService = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: LedgerService, useValue: mockLedgerService },
        { provide: TenantContextService, useValue: mockTenantContextService },
      ],
    }).compile();

    service = module.get<PurchaseService>(PurchaseService);

    jest.clearAllMocks();
    mockPrismaService.purchaseOrder.findFirst.mockReset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPurchaseOrder', () => {
    it('should throw if vendor not found', async () => {
      mockPrismaService.vendor.findFirst.mockResolvedValue(null);
      await expect(service.createPurchaseOrder('v1', [])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw if brand not supported', async () => {
      mockPrismaService.vendor.findFirst.mockResolvedValue({
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
      mockPrismaService.vendor.findFirst.mockResolvedValue({
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
      mockPrismaService.vendor.findFirst.mockResolvedValue({
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

      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue(mockPO);
      mockPrismaService.purchaseOrder.findUnique.mockResolvedValue({
        ...mockPO,
        items: [{ ...mockPO.items[0], quantity_received: 5 }],
      });
      mockPrismaService.storageLocation.findFirst.mockResolvedValue({
        id: 'loc1',
        type: 'warehouse',
      });
      mockPrismaService.purchaseOrderItem.updateMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.purchaseOrder.update.mockResolvedValue({});

      await service.receiveItems('order1', [{ itemId: 'item1', quantity: 5 }]);

      expect(
        mockPrismaService.purchaseOrderItem.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          id: 'poi1',
          tenant_id: 'tenant-1',
          quantity_received: 0,
        },
        data: { quantity_received: { increment: 5 } },
      });

      expect(mockLedgerService.recordTransactions).toHaveBeenCalledTimes(1);
      expect(mockLedgerService.recordTransactions).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            itemId: 'item1',
            locationId: 'loc1',
            quantity: 5,
            type: TransactionType.PURCHASE_RECEIPT,
            costBasis: 50,
          }),
        ],
        expect.anything(),
      );
    });

    it('returns 409 when a concurrent receive already transitioned the PO', async () => {
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

      mockPrismaService.purchaseOrder.findFirst
        .mockResolvedValueOnce(mockPO)
        .mockResolvedValueOnce({
          ...mockPO,
          items: [{ ...mockPO.items[0], quantity_received: 10 }],
        });
      mockPrismaService.storageLocation.findFirst.mockResolvedValue({
        id: 'loc1',
        type: 'warehouse',
      });
      mockPrismaService.purchaseOrderItem.findMany.mockResolvedValue(
        mockPO.items,
      );
      mockPrismaService.purchaseOrderItem.updateMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.purchaseOrder.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(
        service.receiveItems('order1', [{ itemId: 'item1', quantity: 10 }]),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('markAsSent', () => {
    it('transitions DRAFT to SENT with an expected-from guard', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockImplementation(
        async (args: { include?: unknown }) => {
          if (args?.include) {
            return {
              id: 'po-1',
              status: PurchaseOrderStatus.SENT,
              vendor: true,
              items: [],
            };
          }
          return {
            id: 'po-1',
            status: PurchaseOrderStatus.DRAFT,
          };
        },
      );
      mockPrismaService.purchaseOrder.updateMany.mockResolvedValue({
        count: 1,
      });

      await service.markAsSent('po-1');

      expect(mockPrismaService.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'po-1',
          tenant_id: 'tenant-1',
          status: PurchaseOrderStatus.DRAFT,
        },
        data: { status: PurchaseOrderStatus.SENT },
      });
    });

    it('returns 409 when markAsSent loses the DRAFT race', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: PurchaseOrderStatus.DRAFT,
      });
      mockPrismaService.purchaseOrder.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(service.markAsSent('po-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('should return all orders by default when no filter is specified', async () => {
      mockPrismaService.purchaseOrder.findMany.mockResolvedValue([]);
      await service.findAll();
      // Based on code: filter defaults to 'all', which means where only contains tenant_id
      expect(mockPrismaService.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: 'tenant-1' },
        }),
      );
    });

    it('should filter by open status explicitly', async () => {
      mockPrismaService.purchaseOrder.findMany.mockResolvedValue([]);
      await service.findAll('open');
      expect(mockPrismaService.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id: 'tenant-1',
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
          where: { tenant_id: 'tenant-1' },
        }),
      );
    });
  });

  describe('remove', () => {
    it('should delete DRAFT purchase order with no received or invoiced items', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({
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
      mockPrismaService.purchaseOrder.deleteMany.mockResolvedValue({
        id: 'po-1',
        count: 1,
      });

      await service.remove('po-1');

      expect(
        mockPrismaService.purchaseOrderItem.deleteMany,
      ).toHaveBeenCalledWith({
        where: { purchase_order_id: 'po-1' },
      });
      expect(mockPrismaService.purchaseOrder.deleteMany).toHaveBeenCalledWith({
        where: { id: 'po-1', tenant_id: 'tenant-1' },
      });
    });

    it('should block deleting non-draft purchase order', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-2',
        status: PurchaseOrderStatus.PARTIAL,
        items: [],
      });

      await expect(service.remove('po-2')).rejects.toThrow(BadRequestException);
    });

    it('should block deleting purchase order with received items', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({
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
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({
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
      expect(mockPrismaService.purchaseOrder.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('getPurchaseOrderItems', () => {
    it('should return all items for a valid purchase order', async () => {
      const mockItems = [{ id: 'item1' }, { id: 'item2' }];
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        items: mockItems,
      });

      const result = await service.getPurchaseOrderItems('po-1');

      expect(mockPrismaService.purchaseOrder.findFirst).toHaveBeenCalledWith({
        where: { id: 'po-1', tenant_id: 'tenant-1' },
        include: {
          items: {
            include: { catalog_item: true },
          },
        },
      });
      expect(result).toEqual(mockItems);
    });

    it('should throw NotFoundException if purchase order does not exist', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(service.getPurchaseOrderItems('po-unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getPurchaseOrderItem', () => {
    it('should return a specific item for a valid purchase order', async () => {
      const mockItem = { id: 'item1', purchase_order_id: 'po-1' };
      mockPrismaService.purchaseOrderItem.findFirst.mockResolvedValue(mockItem);

      const result = await service.getPurchaseOrderItem('po-1', 'item1');

      expect(
        mockPrismaService.purchaseOrderItem.findFirst,
      ).toHaveBeenCalledWith({
        where: {
          id: 'item1',
          purchase_order_id: 'po-1',
          tenant_id: 'tenant-1',
        },
        include: { catalog_item: true },
      });
      expect(result).toEqual(mockItem);
    });

    it('should throw NotFoundException if item does not exist', async () => {
      mockPrismaService.purchaseOrderItem.findFirst.mockResolvedValue(null);

      await expect(
        service.getPurchaseOrderItem('po-1', 'item-unknown'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('addItemsToPurchaseOrder', () => {
    it('should throw if purchase order not found', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue(null);
      await expect(
        service.addItemsToPurchaseOrder('po-unknown', [
          { catalogItemId: 'item-1', quantity: 1, unitCost: 10 },
        ]),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw on duplicate items in request', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        vendor: { supportedBrands: [] },
        items: [],
      });

      await expect(
        service.addItemsToPurchaseOrder('po-1', [
          { catalogItemId: 'item-1', quantity: 1, unitCost: 10 },
          { catalogItemId: 'item-1', quantity: 2, unitCost: 10 },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if item is already in purchase order', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        vendor: {
          supportedBrands: [{ id: 'brand-1', name: 'Brand 1' }],
        },
        items: [{ catalog_item_id: 'item-1' }],
      });
      mockPrismaService.catalogItem.findMany.mockResolvedValue([
        {
          id: 'item-1',
          name: 'Oil Filter',
          brand_id: 'brand-1',
          brand: { id: 'brand-1', name: 'Brand 1' },
        },
      ]);

      await expect(
        service.addItemsToPurchaseOrder('po-1', [
          { catalogItemId: 'item-1', quantity: 1, unitCost: 10 },
        ]),
      ).rejects.toThrow('already in this purchase order');
    });

    it('should add items successfully', async () => {
      mockPrismaService.purchaseOrder.findFirst
        .mockResolvedValueOnce({
          id: 'po-1',
          status: PurchaseOrderStatus.DRAFT,
          vendor: {
            id: 'v-1',
            name: 'Vendor',
            supportedBrands: [{ id: 'brand-1', name: 'Brand 1' }],
          },
          items: [],
        })
        .mockResolvedValueOnce({
          id: 'po-1',
          status: PurchaseOrderStatus.DRAFT,
          items: [{ quantity: 2, quantity_received: 0 }],
        })
        .mockResolvedValueOnce({
          id: 'po-1',
          items: [{ id: 'poi-new', catalog_item_id: 'item-1' }],
        });

      mockPrismaService.catalogItem.findMany.mockResolvedValue([
        {
          id: 'item-1',
          brand_id: 'brand-1',
          brand: { id: 'brand-1', name: 'Brand 1' },
        },
      ]);
      mockPrismaService.purchaseOrderItem.create.mockResolvedValue({
        id: 'poi-new',
      });

      const result = await service.addItemsToPurchaseOrder('po-1', [
        { catalogItemId: 'item-1', quantity: 2, unitCost: 15 },
      ]);

      expect(result).toBeDefined();
      expect(mockPrismaService.purchaseOrderItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          purchase_order_id: 'po-1',
          catalog_item_id: 'item-1',
          quantity: 2,
          unit_cost: 15,
        }),
      });
    });
  });

  describe('updatePurchaseOrderItem', () => {
    it('should update item quantity and unit cost', async () => {
      mockPrismaService.purchaseOrder.findFirst
        .mockResolvedValueOnce({
          id: 'po-1',
          status: PurchaseOrderStatus.DRAFT,
          items: [{ id: 'item-1', quantity: 5, quantity_received: 0 }],
        })
        .mockResolvedValueOnce({
          id: 'po-1',
          status: PurchaseOrderStatus.DRAFT,
          items: [{ id: 'item-1', quantity: 10, quantity_received: 0 }],
        })
        .mockResolvedValueOnce({
          id: 'po-1',
          items: [{ id: 'item-1', quantity: 10, quantity_received: 0 }],
        });

      mockPrismaService.purchaseOrderItem.updateMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.updatePurchaseOrderItem('po-1', 'item-1', {
        quantity: 10,
        unitCost: 20,
      });

      expect(result).toBeDefined();
      expect(
        mockPrismaService.purchaseOrderItem.updateMany,
      ).toHaveBeenCalledWith({
        where: { id: 'item-1', tenant_id: 'tenant-1' },
        data: { quantity: 10, unit_cost: 20 },
      });
    });

    it('should reject reducing quantity below received quantity', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: PurchaseOrderStatus.PARTIAL,
        items: [{ id: 'item-1', quantity: 10, quantity_received: 5 }],
      });

      await expect(
        service.updatePurchaseOrderItem('po-1', 'item-1', { quantity: 3 }),
      ).rejects.toThrow('Cannot reduce quantity below 5 already received');
    });
  });

  describe('deleteItemFromPurchaseOrder', () => {
    it('should reject deleting received item', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        status: PurchaseOrderStatus.PARTIAL,
        items: [{ id: 'item-1', quantity: 10, quantity_received: 2 }],
      });

      await expect(
        service.deleteItemFromPurchaseOrder('po-1', 'item-1'),
      ).rejects.toThrow('Cannot delete an item that has already been received');
    });

    it('should delete unreceived item', async () => {
      mockPrismaService.purchaseOrder.findFirst
        .mockResolvedValueOnce({
          id: 'po-1',
          status: PurchaseOrderStatus.DRAFT,
          items: [{ id: 'item-1', quantity: 10, quantity_received: 0 }],
        })
        .mockResolvedValueOnce({
          id: 'po-1',
          status: PurchaseOrderStatus.DRAFT,
          items: [],
        })
        .mockResolvedValueOnce({
          id: 'po-1',
          items: [],
        });

      mockPrismaService.purchaseOrderItem.deleteMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.deleteItemFromPurchaseOrder(
        'po-1',
        'item-1',
      );
      expect(result).toBeDefined();
      expect(
        mockPrismaService.purchaseOrderItem.deleteMany,
      ).toHaveBeenCalledWith({
        where: { id: 'item-1', tenant_id: 'tenant-1' },
      });
    });
  });
});
