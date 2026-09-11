import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  PartsReservationStatus,
  PurchaseOrderStatus,
  TransactionType,
  Prisma,
} from '@prisma/client';
import { PurchaseReceiptService } from './purchase-receipt.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../inventory/ledger.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { SiteContextService } from '../common/services/site-context.service';
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
    partsReservation: {
      updateMany: jest.fn(),
    },
    workshopTask: {
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

  const mockSiteContextService = {
    getSiteId: jest.fn().mockResolvedValue('site-1'),
  };

  const mockSiteService = {
    resolveDefaultSiteId: jest.fn().mockResolvedValue('site-1'),
  };

  const warehouse = {
    id: 'wh-1',
    code: 'WH-001',
    site_id: 'site-1',
    type: 'warehouse',
  };
  const generalBin = {
    id: 'bin-1',
    code: 'WH-001-GEN',
    parent_id: 'wh-1',
    type: 'bin',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseReceiptService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: LedgerService, useValue: mockLedgerService },
        { provide: TenantContextService, useValue: mockTenantContextService },
        { provide: SiteContextService, useValue: mockSiteContextService },
        { provide: SiteService, useValue: mockSiteService },
      ],
    }).compile();

    service = module.get<PurchaseReceiptService>(PurchaseReceiptService);

    jest.clearAllMocks();
    mockPrismaService.$queryRaw.mockReset().mockResolvedValue([]);
    mockPrismaService.$transaction
      .mockReset()
      .mockImplementation((cb: (tx: any) => any) => cb(mockPrismaService));
    mockPrismaService.purchaseOrder.findFirst.mockReset();
    mockPrismaService.purchaseOrder.updateMany.mockReset();
    mockPrismaService.purchaseOrderItem.updateMany.mockReset();
    mockPrismaService.partsReservation.updateMany.mockReset();
    mockPrismaService.workshopTask.updateMany.mockReset();
    mockPrismaService.storageLocation.findFirst.mockReset();
    mockPrismaService.storageLocation.create.mockReset();
    mockLedgerService.recordTransactions.mockReset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  function buildReservation(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: 'res-1',
      status: PartsReservationStatus.ORDERED,
      detached_at: null,
      quantity: new Decimal(4),
      quantity_received: new Decimal(0),
      workshop_task_line_item: {
        id: 'line-1',
        workshop_task_id: 'task-1',
        workshop_task: {
          id: 'task-1',
          workshop_order: {
            id: 'order-1',
            site_id: 'site-1',
            staging_location_id: 'tote-1',
          },
        },
      },
      ...overrides,
    };
  }

  function buildPoItem(
    reservation: Record<string, unknown> | null,
  ): Record<string, unknown> {
    return {
      id: 'poi-1',
      catalog_item_id: 'cat-1',
      quantity: new Decimal(4),
      quantity_received: new Decimal(0),
      unit_cost: new Decimal(10),
      parts_reservation: reservation,
    };
  }

  function mockReceiptOrder(
    items: Record<string, unknown>[],
    status: PurchaseOrderStatus = PurchaseOrderStatus.SENT,
  ): void {
    const relationOrder = {
      id: 'order-1',
      order_number: 'PO-2026-0001',
      status,
      items,
    };
    const finalOrder = {
      id: 'order-1',
      order_number: 'PO-2026-0001',
      status: PurchaseOrderStatus.COMPLETED,
      items: items.map((item) => ({
        ...item,
        quantity_received: item.quantity as Decimal,
      })),
    };

    mockPrismaService.purchaseOrder.findFirst.mockImplementation(
      async (args: { include?: unknown }) => {
        const include = args?.include as
          | { items?: unknown }
          | undefined;
        if (include?.items && typeof include.items === 'object') {
          return relationOrder;
        }
        return finalOrder;
      },
    );
  }

  describe('resolveWarehouseAndGeneralBin', () => {
    it('returns existing warehouse and general bin if both exist', async () => {
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
      const createdWarehouse = { ...warehouse, id: 'wh-created' };
      const createdBin = { ...generalBin, id: 'bin-created' };

      mockPrismaService.storageLocation.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      mockPrismaService.storageLocation.create
        .mockResolvedValueOnce(createdWarehouse)
        .mockResolvedValueOnce(createdBin);

      const result = await service.resolveWarehouseAndGeneralBin(
        mockPrismaService as any,
        'tenant-1',
      );

      expect(result).toEqual({
        warehouse: createdWarehouse,
        generalBin: createdBin,
      });
      expect(mockSiteService.resolveDefaultSiteId).toHaveBeenCalledWith(
        'tenant-1',
      );
      expect(mockPrismaService.storageLocation.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('receiveItems', () => {
    beforeEach(() => {
      mockPrismaService.storageLocation.findFirst
        .mockResolvedValueOnce(warehouse)
        .mockResolvedValueOnce(generalBin);
      mockPrismaService.purchaseOrderItem.updateMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.purchaseOrder.updateMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.partsReservation.updateMany.mockResolvedValue({
        count: 1,
      });
      mockPrismaService.workshopTask.updateMany.mockResolvedValue({
        count: 1,
      });
    });

    it('throws NotFoundException if purchase order not found', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.receiveItems('order-1', [{ itemId: 'poi-1', quantity: 5 }]),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if PO status is not receivable', async () => {
      mockPrismaService.purchaseOrder.findFirst.mockResolvedValue({
        id: 'order-1',
        status: PurchaseOrderStatus.COMPLETED,
        items: [],
      });

      await expect(
        service.receiveItems('order-1', [{ itemId: 'poi-1', quantity: 5 }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('receives an unlinked item into the default general bin', async () => {
      const items = [buildPoItem(null)];
      mockReceiptOrder(items);

      const result = await service.receiveItems('order-1', [
        { itemId: 'poi-1', quantity: 4 },
      ]);

      expect(mockPrismaService.purchaseOrderItem.updateMany).toHaveBeenCalledWith(
        {
          where: {
            id: 'poi-1',
            tenant_id: 'tenant-1',
            quantity_received: new Decimal(0),
          },
          data: { quantity_received: { increment: new Decimal(4) } },
        },
      );

      expect(mockLedgerService.recordTransactions).toHaveBeenCalledWith(
        [
          {
            itemId: 'cat-1',
            locationId: 'bin-1',
            quantity: new Decimal(4),
            type: TransactionType.PURCHASE_RECEIPT,
            referenceId: 'PO-2026-0001',
            costBasis: new Decimal(10),
          },
        ],
        mockPrismaService,
      );
      expect(
        mockPrismaService.partsReservation.updateMany,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.workshopTask.updateMany).not.toHaveBeenCalled();
      expect(result.status).toBe(PurchaseOrderStatus.COMPLETED);
    });

    it('receives an allocated item into the job tote and stages the reservation', async () => {
      const items = [buildPoItem(buildReservation())];
      mockReceiptOrder(items);

      await service.receiveItems('order-1', [
        { itemId: 'poi-1', quantity: 4 },
      ]);

      expect(mockLedgerService.recordTransactions).toHaveBeenCalledWith(
        [
          {
            itemId: 'cat-1',
            locationId: 'tote-1',
            quantity: new Decimal(4),
            type: TransactionType.PURCHASE_RECEIPT,
            referenceId: 'PO-2026-0001',
            costBasis: new Decimal(10),
            partsReservationId: 'res-1',
          },
        ],
        mockPrismaService,
      );

      expect(
        mockPrismaService.partsReservation.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          id: 'res-1',
          status: {
            in: [
              PartsReservationStatus.OPEN,
              PartsReservationStatus.ORDERED,
            ],
          },
          detached_at: null,
          quantity_received: new Decimal(0),
        },
        data: {
          quantity_received: { increment: new Decimal(4) },
          quantity_staged: { increment: new Decimal(4) },
          status: PartsReservationStatus.STAGED,
          location_id: 'tote-1',
          tote_cost_basis: new Decimal(10),
        },
      });

      expect(mockPrismaService.workshopTask.updateMany).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1', id: { in: ['task-1'] } },
        data: { line_items_version: { increment: 1 } },
      });
    });

    it('keeps a partially received slice ORDERED and does not refreeze cost basis', async () => {
      const items = [
        buildPoItem(
          buildReservation({
            quantity: new Decimal(4),
            quantity_received: new Decimal(2),
          }),
        ),
      ];
      mockReceiptOrder(items);

      await service.receiveItems('order-1', [
        { itemId: 'poi-1', quantity: 1 },
      ]);

      expect(
        mockPrismaService.partsReservation.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          id: 'res-1',
          status: {
            in: [
              PartsReservationStatus.OPEN,
              PartsReservationStatus.ORDERED,
            ],
          },
          detached_at: null,
          quantity_received: new Decimal(2),
        },
        data: {
          quantity_received: { increment: new Decimal(1) },
          quantity_staged: { increment: new Decimal(1) },
          status: PartsReservationStatus.ORDERED,
          location_id: 'tote-1',
        },
      });
    });

    it('requires locationId to receive a released reservation as free stock', async () => {
      const items = [
        buildPoItem(
          buildReservation({
            status: PartsReservationStatus.CANCELLED,
            detached_at: new Date(),
          }),
        ),
      ];
      mockReceiptOrder(items);

      await expect(
        service.receiveItems('order-1', [{ itemId: 'poi-1', quantity: 4 }]),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(
        mockPrismaService.partsReservation.updateMany,
      ).not.toHaveBeenCalled();
    });

    it('receives a released reservation into the provided free-stock bin', async () => {
      const items = [
        buildPoItem(
          buildReservation({
            status: PartsReservationStatus.CANCELLED,
            detached_at: new Date(),
          }),
        ),
      ];
      mockReceiptOrder(items);
      mockPrismaService.storageLocation.findFirst.mockResolvedValueOnce({
        id: 'bin-9',
      });

      await service.receiveItems('order-1', [
        { itemId: 'poi-1', quantity: 4, locationId: 'bin-9' },
      ]);

      expect(mockLedgerService.recordTransactions).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            itemId: 'cat-1',
            locationId: 'bin-9',
            quantity: new Decimal(4),
            type: TransactionType.PURCHASE_RECEIPT,
          }),
        ],
        mockPrismaService,
      );
      expect(
        mockPrismaService.partsReservation.updateMany,
      ).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the purchase order item was updated concurrently', async () => {
      const items = [buildPoItem(null)];
      mockReceiptOrder(items);
      mockPrismaService.purchaseOrderItem.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      await expect(
        service.receiveItems('order-1', [{ itemId: 'poi-1', quantity: 4 }]),
      ).rejects.toThrow(ConflictException);
    });

    it.each([
      ['1.5', new Decimal('1.5')],
      ['0.001', new Decimal('0.001')],
    ])(
      'preserves decimal quantity %s through the ledger pipeline without truncation',
      async (rawQty, expectedDecimal) => {
        const items = [buildPoItem(null)];
        mockReceiptOrder(items);

        await service.receiveItems('order-1', [
          { itemId: 'poi-1', quantity: parseFloat(rawQty) },
        ]);

        expect(
          mockPrismaService.purchaseOrderItem.updateMany,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { quantity_received: { increment: expectedDecimal } },
          }),
        );

        expect(mockLedgerService.recordTransactions).toHaveBeenCalledWith(
          [
            expect.objectContaining({
              quantity: expectedDecimal,
              type: TransactionType.PURCHASE_RECEIPT,
            }),
          ],
          mockPrismaService,
        );
      },
    );
  });
});
