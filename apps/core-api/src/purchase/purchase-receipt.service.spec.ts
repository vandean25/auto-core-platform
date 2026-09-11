import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PurchaseOrderStatus, TransactionType, Prisma } from '@prisma/client';
import { PurchaseReceiptService } from './purchase-receipt.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../inventory/ledger.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { SiteService } from '../site/site.service';

import Decimal = Prisma.Decimal;

describe('PurchaseReceiptService', () => {
  let service: PurchaseReceiptService;

  const mockPrismaService = {
    $transaction: jest
      .fn()
      .mockImplementation((cb: (tx: any) => any) => cb(mockPrismaService)),
    $queryRaw: jest.fn().mockResolvedValue([]),
    purchaseOrder: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    purchaseOrderItem: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    storageLocation: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockLedgerService = {
    recordTransactions: jest.fn(),
  };

  const mockTenantContextService = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };

  const mockSiteService = {
    resolveDefaultSiteId: jest.fn().mockResolvedValue('site-1'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseReceiptService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: LedgerService, useValue: mockLedgerService },
        { provide: TenantContextService, useValue: mockTenantContextService },
        { provide: SiteService, useValue: mockSiteService },
      ],
    }).compile();

    service = module.get<PurchaseReceiptService>(PurchaseReceiptService);

    jest.clearAllMocks();
    mockPrismaService.purchaseOrder.findFirst.mockReset();
    mockPrismaService.purchaseOrder.updateMany.mockReset();
    mockPrismaService.purchaseOrderItem.findMany.mockReset();
    mockPrismaService.purchaseOrderItem.updateMany.mockReset();
    mockPrismaService.storageLocation.findFirst.mockReset();
    mockPrismaService.storageLocation.create.mockReset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resolveWarehouseAndGeneralBin', () => {
    it('returns existing warehouse and general bin if both exist', async () => {
      const warehouse = { id: 'wh-1', code: 'WH-001', site_id: 'site-1', type: 'warehouse' };
      const generalBin = { id: 'bin-1', code: 'WH-001-GEN', parent_id: 'wh-1', type: 'bin' };

      mockPrismaService.storageLocation.findFirst
        .mockResolvedValueOnce(warehouse)
        .mockResolvedValueOnce(generalBin);

      const result = await service.resolveWarehouseAndGeneralBin(
        mockPrismaService as any,
        'tenant-1',
      );

      expect(result).toEqual({ warehouse, generalBin });
      expect(mockPrismaService.storageLocation.create).not.toHaveBeenCalled();
    });

    it('creates warehouse and general bin if neither exists', async () => {
      const warehouse = { id: 'wh-created', code: 'WH-001', site_id: 'site-1', type: 'warehouse' };
      const generalBin = { id: 'bin-created', code: 'WH-001-GEN', parent_id: 'wh-created', type: 'bin' };

      mockPrismaService.storageLocation.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      mockPrismaService.storageLocation.create
        .mockResolvedValueOnce(warehouse)
        .mockResolvedValueOnce(generalBin);

      const result = await service.resolveWarehouseAndGeneralBin(
        mockPrismaService as any,
        'tenant-1',
      );

      expect(result).toEqual({ warehouse, generalBin });
      expect(mockSiteService.resolveDefaultSiteId).toHaveBeenCalledWith('tenant-1');
      expect(mockPrismaService.storageLocation.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('receiveItems', () => {
    it('throws NotFoundException if purchase order not found', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.receiveItems('order-1', [{ itemId: 'item-1', quantity: 5 }]),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if PO status is not DRAFT, SENT, or PARTIAL', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({
        id: 'order-1',
        status: PurchaseOrderStatus.COMPLETED,
        items: [],
      });

      await expect(
        service.receiveItems('order-1', [{ itemId: 'item-1', quantity: 5 }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('receives items, updates line items, records ledger transactions, and transitions status to PARTIAL', async () => {
      const po = {
        id: 'order-1',
        order_number: 'PO-2026-0001',
        status: PurchaseOrderStatus.SENT,
        items: [
          {
            id: 'poi-1',
            catalog_item_id: 'cat-1',
            quantity: new Decimal(10),
            quantity_received: new Decimal(0),
            unit_cost: new Decimal(50),
          },
        ],
      };

      const warehouse = { id: 'wh-1', code: 'WH-001', site_id: 'site-1' };
      const generalBin = { id: 'bin-1', code: 'WH-001-GEN', parent_id: 'wh-1' };

      mockPrismaService.purchaseOrder.findFirst
        .mockResolvedValueOnce(po) // initial lookup
        .mockResolvedValueOnce({
          ...po,
          items: [{ ...po.items[0], quantity_received: new Decimal(4) }],
        }) // post-update reload
        .mockResolvedValueOnce({
          ...po,
          status: PurchaseOrderStatus.PARTIAL,
          items: [{ ...po.items[0], quantity_received: new Decimal(4) }],
        }); // refreshed after status change

      mockPrismaService.storageLocation.findFirst
        .mockResolvedValueOnce(warehouse)
        .mockResolvedValueOnce(generalBin);

      mockPrismaService.purchaseOrderItem.findMany.mockResolvedValueOnce(po.items);
      mockPrismaService.purchaseOrderItem.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrismaService.purchaseOrder.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.receiveItems('order-1', [
        { itemId: 'cat-1', quantity: 4 },
      ]);

      expect(mockPrismaService.purchaseOrderItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'poi-1',
          tenant_id: 'tenant-1',
          quantity_received: new Decimal(0),
        },
        data: { quantity_received: { increment: new Decimal(4) } },
      });

      expect(mockLedgerService.recordTransactions).toHaveBeenCalledWith(
        [
          {
            itemId: 'cat-1',
            locationId: 'bin-1',
            quantity: new Decimal(4),
            type: TransactionType.PURCHASE_RECEIPT,
            referenceId: 'PO-2026-0001',
            costBasis: new Decimal(50),
          },
        ],
        mockPrismaService,
      );

      expect(result.status).toBe(PurchaseOrderStatus.PARTIAL);
    });

    it('receives full remaining quantity and transitions status to COMPLETED with guarded transition', async () => {
      const po = {
        id: 'order-1',
        order_number: 'PO-2026-0001',
        status: PurchaseOrderStatus.SENT,
        items: [
          {
            id: 'poi-1',
            catalog_item_id: 'cat-1',
            quantity: new Decimal(10),
            quantity_received: new Decimal(0),
            unit_cost: new Decimal(50),
          },
        ],
      };

      const warehouse = { id: 'wh-1', code: 'WH-001', site_id: 'site-1' };
      const generalBin = { id: 'bin-1', code: 'WH-001-GEN', parent_id: 'wh-1' };

      mockPrismaService.purchaseOrder.findFirst
        .mockResolvedValueOnce(po) // initial lookup
        .mockResolvedValueOnce({
          ...po,
          items: [{ ...po.items[0], quantity_received: new Decimal(10) }],
        }) // post-update reload
        .mockResolvedValueOnce({
          ...po,
          status: PurchaseOrderStatus.COMPLETED,
          items: [{ ...po.items[0], quantity_received: new Decimal(10) }],
        }); // refreshed after status change

      mockPrismaService.storageLocation.findFirst
        .mockResolvedValueOnce(warehouse)
        .mockResolvedValueOnce(generalBin);

      mockPrismaService.purchaseOrderItem.findMany.mockResolvedValueOnce(po.items);
      mockPrismaService.purchaseOrderItem.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrismaService.purchaseOrder.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await service.receiveItems('order-1', [
        { itemId: 'cat-1', quantity: 10 },
      ]);

      expect(mockPrismaService.purchaseOrderItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'poi-1',
          tenant_id: 'tenant-1',
          quantity_received: new Decimal(0),
        },
        data: { quantity_received: { increment: new Decimal(10) } },
      });

      expect(mockPrismaService.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'order-1',
          tenant_id: 'tenant-1',
          status: PurchaseOrderStatus.SENT,
        },
        data: { status: PurchaseOrderStatus.COMPLETED },
      });

      expect(result.status).toBe(PurchaseOrderStatus.COMPLETED);
    });

    it('throws ConflictException when concurrent update occurs during line-item receipt', async () => {
      const po = {
        id: 'order-1',
        order_number: 'PO-2026-0001',
        status: PurchaseOrderStatus.SENT,
        items: [
          {
            id: 'poi-1',
            catalog_item_id: 'cat-1',
            quantity: new Decimal(10),
            quantity_received: new Decimal(0),
            unit_cost: new Decimal(50),
          },
        ],
      };

      mockPrismaService.purchaseOrder.findFirst.mockResolvedValueOnce(po);
      mockPrismaService.storageLocation.findFirst
        .mockResolvedValueOnce({ id: 'wh-1', code: 'WH-001' })
        .mockResolvedValueOnce({ id: 'bin-1', code: 'WH-001-GEN' });
      mockPrismaService.purchaseOrderItem.findMany.mockResolvedValueOnce(po.items);
      mockPrismaService.purchaseOrderItem.updateMany.mockResolvedValueOnce({ count: 0 }); // Concurrency conflict!

      await expect(
        service.receiveItems('order-1', [{ itemId: 'cat-1', quantity: 2 }]),
      ).rejects.toThrow(ConflictException);
    });
  });
});
