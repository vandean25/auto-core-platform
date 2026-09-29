import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  PartsReservationStatus,
  PurchaseOrderStatus,
  Prisma,
} from '@prisma/client';
import {
  recomputePurchaseOrderStatus,
  validateCatalogItemsForVendor,
  assertPurchaseOrderCanBeDeleted,
  assertPurchaseOrderItemCanBeDeleted,
  assertPurchaseOrderItemCanBeUpdated,
  buildPurchaseOrderItemUpdatePayload,
  extractRequisitionIdsFromReservations,
  recomputeLinkedRequisitions,
  cancelLinkedOpenReservations,
  cancelLinkedItemReservation,
  transitionReservationsToOrdered,
  syncPurchaseOrderStatusAndFetch,
  executeMarkAsSent,
  executeRemovePurchaseOrder,
  buildLegacyPurchaseOrderWhere,
  isPurchaseOrderFindManyArgs,
} from './purchase-order.helpers.js';

import Decimal = Prisma.Decimal;

describe('purchase-order.helpers', () => {
  describe('recomputePurchaseOrderStatus', () => {
    it('should return DRAFT for empty items', () => {
      expect(recomputePurchaseOrderStatus([])).toBe(PurchaseOrderStatus.DRAFT);
    });

    it('should return COMPLETED when all items are received', () => {
      const items = [
        { quantity: new Decimal(10), quantity_received: new Decimal(10) },
        { quantity: new Decimal(5), quantity_received: new Decimal(5) },
      ];
      expect(recomputePurchaseOrderStatus(items)).toBe(
        PurchaseOrderStatus.COMPLETED,
      );
    });

    it('should return COMPLETED when received exceeds quantity', () => {
      const items = [{ quantity: 10, quantity_received: 12 }];
      expect(recomputePurchaseOrderStatus(items)).toBe(
        PurchaseOrderStatus.COMPLETED,
      );
    });

    it('should return PARTIAL when some items are received', () => {
      const items = [
        { quantity: new Decimal(10), quantity_received: new Decimal(5) },
        { quantity: new Decimal(5), quantity_received: new Decimal(0) },
      ];
      expect(recomputePurchaseOrderStatus(items)).toBe(
        PurchaseOrderStatus.PARTIAL,
      );
    });

    it('should return SENT when none received and previousStatus is SENT', () => {
      const items = [{ quantity: 10, quantity_received: 0 }];
      expect(
        recomputePurchaseOrderStatus(items, PurchaseOrderStatus.SENT),
      ).toBe(PurchaseOrderStatus.SENT);
    });

    it('should return DRAFT when none received and previousStatus is DRAFT or omitted', () => {
      const items = [{ quantity: 10, quantity_received: 0 }];
      expect(
        recomputePurchaseOrderStatus(items, PurchaseOrderStatus.DRAFT),
      ).toBe(PurchaseOrderStatus.DRAFT);
      expect(recomputePurchaseOrderStatus(items)).toBe(
        PurchaseOrderStatus.DRAFT,
      );
    });
  });

  describe('validateCatalogItemsForVendor', () => {
    const mockVendor = {
      name: 'Bosch Vendor',
      supportedBrands: [
        { id: 1, name: 'Bosch' },
        { id: 2, name: 'Brembo' },
      ],
    };

    const mockCatalogItemsMap = new Map<
      string,
      Prisma.CatalogItemGetPayload<{ include: { brand: true } }>
    >([
      [
        'item-1',
        {
          id: 'item-1',
          name: 'Brake Pads',
          brand_id: 1,
          brand: { id: 1, name: 'Bosch' },
        } as any,
      ],
      [
        'item-2',
        {
          id: 'item-2',
          name: 'Oil Filter',
          brand_id: 3,
          brand: { id: 3, name: 'Mann' },
        } as any,
      ],
      [
        'item-generic',
        {
          id: 'item-generic',
          name: 'Generic Bolt',
          brand_id: null,
          brand: null,
        } as any,
      ],
    ]);

    it('should succeed when vendor supports item brand', () => {
      expect(() =>
        validateCatalogItemsForVendor(
          [{ catalogItemId: 'item-1' }],
          mockCatalogItemsMap,
          mockVendor,
        ),
      ).not.toThrow();
    });

    it('should succeed when item has no brand (generic)', () => {
      expect(() =>
        validateCatalogItemsForVendor(
          [{ catalogItemId: 'item-generic' }],
          mockCatalogItemsMap,
          mockVendor,
        ),
      ).not.toThrow();
    });

    it('should throw BadRequestException when item is not in map', () => {
      expect(() =>
        validateCatalogItemsForVendor(
          [{ catalogItemId: 'non-existent' }],
          mockCatalogItemsMap,
          mockVendor,
        ),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException when vendor does not support item brand', () => {
      expect(() =>
        validateCatalogItemsForVendor(
          [{ catalogItemId: 'item-2' }],
          mockCatalogItemsMap,
          mockVendor,
        ),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException when item is already in PO', () => {
      const existingPoItems = [{ catalog_item_id: 'item-1' }];
      expect(() =>
        validateCatalogItemsForVendor(
          [{ catalogItemId: 'item-1' }],
          mockCatalogItemsMap,
          mockVendor,
          existingPoItems,
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('assertPurchaseOrderCanBeDeleted', () => {
    it('should pass for clean DRAFT PO', () => {
      const po = {
        status: PurchaseOrderStatus.DRAFT,
        items: [
          {
            quantity_received: 0,
            quantity_invoiced: 0,
            purchase_invoice_lines: [],
            parts_reservation: { quantity_staged: 0 },
          },
        ],
      };
      expect(() => assertPurchaseOrderCanBeDeleted(po)).not.toThrow();
    });

    it('should throw ConflictException if status is not DRAFT', () => {
      const po = {
        status: PurchaseOrderStatus.SENT,
        items: [],
      };
      expect(() => assertPurchaseOrderCanBeDeleted(po)).toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException if items were already received', () => {
      const po = {
        status: PurchaseOrderStatus.DRAFT,
        items: [
          {
            quantity_received: new Decimal(2),
            quantity_invoiced: 0,
            purchase_invoice_lines: [],
            parts_reservation: null,
          },
        ],
      };
      expect(() => assertPurchaseOrderCanBeDeleted(po)).toThrow(
        'Purchase order cannot be deleted because items were already received.',
      );
    });

    it('should throw ConflictException if linked reservation is staged', () => {
      const po = {
        status: PurchaseOrderStatus.DRAFT,
        items: [
          {
            quantity_received: 0,
            quantity_invoiced: 0,
            purchase_invoice_lines: [],
            parts_reservation: { quantity_staged: new Decimal(1) },
          },
        ],
      };
      expect(() => assertPurchaseOrderCanBeDeleted(po)).toThrow(
        'Purchase order cannot be deleted because linked reservation slices are staged.',
      );
    });

    it('should throw BadRequestException if quantity_invoiced > 0', () => {
      const po = {
        status: PurchaseOrderStatus.DRAFT,
        items: [
          {
            quantity_received: 0,
            quantity_invoiced: new Decimal(3),
            purchase_invoice_lines: [],
            parts_reservation: null,
          },
        ],
      };
      expect(() => assertPurchaseOrderCanBeDeleted(po)).toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if purchase_invoice_lines is non-empty', () => {
      const po = {
        status: PurchaseOrderStatus.DRAFT,
        items: [
          {
            quantity_received: 0,
            quantity_invoiced: 0,
            purchase_invoice_lines: [{ id: 'pil-1' }],
            parts_reservation: null,
          },
        ],
      };
      expect(() => assertPurchaseOrderCanBeDeleted(po)).toThrow(
        'Purchase order cannot be deleted because it is linked to purchase invoices.',
      );
    });
  });

  describe('assertPurchaseOrderItemCanBeDeleted', () => {
    it('should pass for clean item in DRAFT', () => {
      const item = {
        quantity_received: 0,
        parts_reservation: null,
      };
      expect(() =>
        assertPurchaseOrderItemCanBeDeleted(PurchaseOrderStatus.DRAFT, item),
      ).not.toThrow();
    });

    it('should pass for unstaged reservation in DRAFT', () => {
      const item = {
        quantity_received: 0,
        parts_reservation: { quantity_staged: 0 },
      };
      expect(() =>
        assertPurchaseOrderItemCanBeDeleted(PurchaseOrderStatus.DRAFT, item),
      ).not.toThrow();
    });

    it('should throw BadRequestException if item has been received', () => {
      const item = {
        quantity_received: new Decimal(1),
        parts_reservation: null,
      };
      expect(() =>
        assertPurchaseOrderItemCanBeDeleted(PurchaseOrderStatus.DRAFT, item),
      ).toThrow(BadRequestException);
    });

    it('should throw ConflictException if reservation is linked and PO is SENT', () => {
      const item = {
        quantity_received: 0,
        parts_reservation: { quantity_staged: 0 },
      };
      expect(() =>
        assertPurchaseOrderItemCanBeDeleted(PurchaseOrderStatus.SENT, item),
      ).toThrow(ConflictException);
    });

    it('should throw ConflictException if reservation is staged > 0 even in DRAFT', () => {
      const item = {
        quantity_received: 0,
        parts_reservation: { quantity_staged: new Decimal(2) },
      };
      expect(() =>
        assertPurchaseOrderItemCanBeDeleted(PurchaseOrderStatus.DRAFT, item),
      ).toThrow(ConflictException);
    });
  });

  describe('assertPurchaseOrderItemCanBeUpdated', () => {
    it('should pass for valid updates on unreserved item', () => {
      const item = { quantity_received: 5, parts_reservation: null };
      expect(() =>
        assertPurchaseOrderItemCanBeUpdated(item, {
          quantity: 10,
          unitCost: 100,
        }),
      ).not.toThrow();
    });

    it('should throw ConflictException when updating quantity on reserved item', () => {
      const item = { quantity_received: 0, parts_reservation: { id: 'res-1' } };
      expect(() =>
        assertPurchaseOrderItemCanBeUpdated(item, { quantity: 5 }),
      ).toThrow(ConflictException);
    });

    it('should allow updating unitCost only on reserved item', () => {
      const item = { quantity_received: 0, parts_reservation: { id: 'res-1' } };
      expect(() =>
        assertPurchaseOrderItemCanBeUpdated(item, { unitCost: 120 }),
      ).not.toThrow();
    });

    it('should throw BadRequestException when reducing quantity below received', () => {
      const item = {
        quantity_received: new Decimal(10),
        parts_reservation: null,
      };
      expect(() =>
        assertPurchaseOrderItemCanBeUpdated(item, { quantity: 8 }),
      ).toThrow(BadRequestException);
    });
  });

  describe('buildPurchaseOrderItemUpdatePayload', () => {
    it('should build payload with quantity and unitCost', () => {
      const result = buildPurchaseOrderItemUpdatePayload('item-1', 'tenant-1', {
        quantity: 15,
        unitCost: 45,
      });
      expect(result.data).toEqual({ quantity: 15, unit_cost: 45 });
      expect(result.where).toEqual({
        id: 'item-1',
        tenant_id: 'tenant-1',
        quantity_received: new Decimal(0),
      });
    });

    it('should not include quantity_received restriction if unitCost is undefined', () => {
      const result = buildPurchaseOrderItemUpdatePayload('item-1', 'tenant-1', {
        quantity: 15,
      });
      expect(result.data).toEqual({ quantity: 15 });
      expect(result.where).toEqual({
        id: 'item-1',
        tenant_id: 'tenant-1',
      });
    });
  });

  describe('extractRequisitionIdsFromReservations', () => {
    it('should extract unique non-null requisition IDs', () => {
      const reservations = [
        { requisition_line: { requisition_id: 'req-1' } },
        { requisition_line: { requisition_id: 'req-2' } },
        { requisition_line: { requisition_id: 'req-1' } },
        { requisition_line: { requisition_id: null } },
        { requisition_line: null },
        null,
        undefined,
      ];
      expect(extractRequisitionIdsFromReservations(reservations)).toEqual([
        'req-1',
        'req-2',
      ]);
    });

    it('should return empty array if no requisition IDs', () => {
      expect(extractRequisitionIdsFromReservations([])).toEqual([]);
      expect(extractRequisitionIdsFromReservations([null, undefined])).toEqual(
        [],
      );
    });
  });

  describe('reservation and requisition transaction helpers', () => {
    const mockTx: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: 'site-1', is_active: true }]),
      partsReservation: {
        updateMany: jest.fn(),
      },
      partsRequisition: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
      purchaseOrder: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      purchaseOrderItem: {
        deleteMany: jest.fn(),
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
      mockTx.$queryRaw.mockResolvedValue([{ id: 'site-1', is_active: true }]);
    });

    it('recomputeLinkedRequisitions should process all unique IDs', async () => {
      const reservations = [
        { requisition_line: { requisition_id: 'req-1' } },
        { requisition_line: { requisition_id: 'req-1' } },
      ];
      await recomputeLinkedRequisitions(mockTx, 'tenant-1', reservations);
      expect(mockTx.partsRequisition.findFirst).toHaveBeenCalledTimes(1);
    });

    it('cancelLinkedOpenReservations should do nothing if array is empty', async () => {
      await cancelLinkedOpenReservations(mockTx, 'tenant-1', []);
      expect(mockTx.partsReservation.updateMany).not.toHaveBeenCalled();
    });

    it('cancelLinkedOpenReservations should throw ConflictException if count mismatch', async () => {
      mockTx.partsReservation.updateMany.mockResolvedValue({ count: 1 });
      await expect(
        cancelLinkedOpenReservations(mockTx, 'tenant-1', ['res-1', 'res-2']),
      ).rejects.toThrow(ConflictException);
    });

    it('cancelLinkedItemReservation should update single reservation', async () => {
      mockTx.partsReservation.updateMany.mockResolvedValue({ count: 1 });
      await expect(
        cancelLinkedItemReservation(mockTx, 'tenant-1', { id: 'res-1' }),
      ).resolves.not.toThrow();
    });

    it('cancelLinkedItemReservation should throw ConflictException if not updated', async () => {
      mockTx.partsReservation.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        cancelLinkedItemReservation(mockTx, 'tenant-1', { id: 'res-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('transitionReservationsToOrdered should update open reservations', async () => {
      mockTx.partsReservation.updateMany.mockResolvedValue({ count: 2 });
      await transitionReservationsToOrdered(mockTx, 'tenant-1', [
        'res-1',
        'res-2',
      ]);
      expect(mockTx.partsReservation.updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          id: { in: ['res-1', 'res-2'] },
          status: PartsReservationStatus.OPEN,
        },
        data: { status: PartsReservationStatus.ORDERED },
      });
    });

    describe('executeMarkAsSent', () => {
      it('throws NotFoundException when order not found and not at request start', async () => {
        mockTx.purchaseOrder.findFirst.mockResolvedValue(null);
        await expect(
          executeMarkAsSent(mockTx, 'po-1', 'tenant-1', 'site-1', false),
        ).rejects.toThrow(NotFoundException);
      });

      it('throws ConflictException when order not found and was at request start', async () => {
        mockTx.purchaseOrder.findFirst.mockResolvedValue(null);
        await expect(
          executeMarkAsSent(mockTx, 'po-1', 'tenant-1', 'site-1', true),
        ).rejects.toThrow(ConflictException);
      });

      it('throws BadRequestException when order is not DRAFT', async () => {
        mockTx.purchaseOrder.findFirst.mockResolvedValue({
          id: 'po-1',
          status: PurchaseOrderStatus.SENT,
          site_id: 'site-1',
          items: [],
        });
        await expect(
          executeMarkAsSent(mockTx, 'po-1', 'tenant-1', 'site-1', true),
        ).rejects.toThrow(BadRequestException);
      });

      it('successfully marks order as sent', async () => {
        const order = {
          id: 'po-1',
          status: PurchaseOrderStatus.DRAFT,
          site_id: 'site-1',
          items: [
            {
              id: 'item-1',
              parts_reservation: {
                id: 'res-1',
                requisition_line: { requisition_id: 'req-1' },
              },
            },
          ],
        };
        mockTx.purchaseOrder.findFirst
          .mockResolvedValueOnce(order)
          .mockResolvedValueOnce({
            ...order,
            status: PurchaseOrderStatus.SENT,
          });
        mockTx.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
        mockTx.partsReservation.updateMany.mockResolvedValue({ count: 1 });

        const result = await executeMarkAsSent(
          mockTx,
          'po-1',
          'tenant-1',
          'site-1',
          true,
        );
        expect(result.status).toBe(PurchaseOrderStatus.SENT);
      });
    });

    describe('executeRemovePurchaseOrder', () => {
      it('throws NotFoundException when order not found', async () => {
        mockTx.purchaseOrder.findFirst.mockResolvedValue(null);
        await expect(
          executeRemovePurchaseOrder(mockTx, 'po-1', 'tenant-1', 'site-1'),
        ).rejects.toThrow(NotFoundException);
      });

      it('successfully removes DRAFT order and returns id', async () => {
        const order = {
          id: 'po-1',
          status: PurchaseOrderStatus.DRAFT,
          items: [
            {
              id: 'item-1',
              quantity_received: 0,
              quantity_invoiced: 0,
              purchase_invoice_lines: [],
              parts_reservation: {
                id: 'res-1',
                quantity_staged: 0,
                requisition_line: { requisition_id: 'req-1' },
              },
            },
          ],
        };
        mockTx.purchaseOrder.findFirst.mockResolvedValue(order);
        mockTx.partsReservation.updateMany.mockResolvedValue({ count: 1 });
        mockTx.purchaseOrderItem.deleteMany.mockResolvedValue({ count: 1 });
        mockTx.purchaseOrder.deleteMany.mockResolvedValue({ count: 1 });

        const result = await executeRemovePurchaseOrder(
          mockTx,
          'po-1',
          'tenant-1',
          'site-1',
        );
        expect(result).toEqual({ id: 'po-1' });
      });
    });

    describe('syncPurchaseOrderStatusAndFetch', () => {
      it('syncs status and fetches updated order', async () => {
        mockTx.purchaseOrder.findFirst
          .mockResolvedValueOnce({
            id: 'po-1',
            items: [{ quantity: 10, quantity_received: 10 }],
          })
          .mockResolvedValueOnce({
            id: 'po-1',
            status: PurchaseOrderStatus.COMPLETED,
          });
        mockTx.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });

        const result = await syncPurchaseOrderStatusAndFetch(
          mockTx,
          { orderId: 'po-1', tenantId: 'tenant-1', siteId: 'site-1' },
          PurchaseOrderStatus.DRAFT,
        );
        expect(result?.status).toBe(PurchaseOrderStatus.COMPLETED);
      });
    });
  });

  describe('buildLegacyPurchaseOrderWhere', () => {
    it('builds where clause with open statuses', () => {
      const where = buildLegacyPurchaseOrderWhere('tenant-1', 'site-1', 'open');
      expect(where).toEqual({
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        status: {
          in: [
            PurchaseOrderStatus.DRAFT,
            PurchaseOrderStatus.SENT,
            PurchaseOrderStatus.PARTIAL,
          ],
        },
      });
    });

    it('builds where clause for all statuses', () => {
      const where = buildLegacyPurchaseOrderWhere('tenant-1', 'site-1', 'all');
      expect(where).toEqual({
        tenant_id: 'tenant-1',
        site_id: 'site-1',
      });
    });
  });

  describe('isPurchaseOrderFindManyArgs', () => {
    it('should return true for valid query object', () => {
      expect(isPurchaseOrderFindManyArgs({ where: {} })).toBe(true);
      expect(isPurchaseOrderFindManyArgs({ orderBy: {} })).toBe(true);
      expect(isPurchaseOrderFindManyArgs({ skip: 5 })).toBe(true);
    });

    it('should return false for string or non-matching object', () => {
      expect(isPurchaseOrderFindManyArgs('open')).toBe(false);
      expect(isPurchaseOrderFindManyArgs(undefined)).toBe(false);
      expect(isPurchaseOrderFindManyArgs(null as any)).toBe(false);
      expect(isPurchaseOrderFindManyArgs({ foo: 'bar' } as any)).toBe(false);
    });
  });
});
