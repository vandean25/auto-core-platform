import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  PartsReservationKind,
  PartsReservationStatus,
  PartsRequisitionStatus,
  Prisma,
  TransactionType,
} from '@prisma/client';
import {
  assertLineAllocationFits,
  assertUniqueSelections,
  groupReservationsByLine,
  handleToteReturnStock,
  toRequisitionResponse,
  toReservationResponse,
  toShortageResponse,
  validateRequisitionPoItems,
  ZERO,
} from './parts-requisition-lifecycle.helpers.js';

describe('parts-requisition-lifecycle.helpers', () => {
  const tenantId = 'tenant-1';
  const siteId = 'site-1';

  describe('assertUniqueSelections', () => {
    it('passes when all IDs are unique', () => {
      expect(() =>
        assertUniqueSelections(['id-1', 'id-2', 'id-3']),
      ).not.toThrow();
    });

    it('throws UnprocessableEntityException when duplicate IDs exist', () => {
      expect(() =>
        assertUniqueSelections(['id-1', 'id-2', 'id-1']),
      ).toThrow(UnprocessableEntityException);
    });
  });

  describe('groupReservationsByLine', () => {
    it('groups reservations by workshop_task_line_item_id', () => {
      const res1 = {
        id: 'r1',
        tenant_id: tenantId,
        workshop_task_line_item_id: 'line-1',
        quantity: new Prisma.Decimal(2),
        quantity_consumed: ZERO,
        quantity_staged: ZERO,
        quantity_returned: ZERO,
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const res2 = {
        id: 'r2',
        tenant_id: tenantId,
        workshop_task_line_item_id: 'line-1',
        quantity: new Prisma.Decimal(3),
        quantity_consumed: ZERO,
        quantity_staged: ZERO,
        quantity_returned: ZERO,
        kind: PartsReservationKind.REQUISITION,
        status: PartsReservationStatus.ORDERED,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const res3 = {
        id: 'r3',
        tenant_id: tenantId,
        workshop_task_line_item_id: 'line-2',
        quantity: new Prisma.Decimal(1),
        quantity_consumed: ZERO,
        quantity_staged: ZERO,
        quantity_returned: ZERO,
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const grouped = groupReservationsByLine([res1, res2, res3]);
      expect(grouped.get('line-1')).toEqual([res1, res2]);
      expect(grouped.get('line-2')).toEqual([res3]);
    });
  });

  describe('assertLineAllocationFits', () => {
    it('allows allocation when remaining capacity is sufficient', () => {
      const lineQuantity = new Prisma.Decimal(10);
      const reservations = [
        {
          id: 'r1',
          tenant_id: tenantId,
          workshop_task_line_item_id: 'line-1',
          quantity: new Prisma.Decimal(5),
          quantity_consumed: new Prisma.Decimal(2),
          quantity_staged: ZERO,
          quantity_returned: ZERO,
          kind: PartsReservationKind.ON_HAND,
          status: PartsReservationStatus.OPEN,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      // consumed = 2, active remaining commitment = 5 - 2 = 3. Total committed = 5.
      // Line quantity is 10. Requesting 5 should fit.
      expect(() =>
        assertLineAllocationFits(lineQuantity, reservations, new Prisma.Decimal(5)),
      ).not.toThrow();
    });

    it('throws ConflictException when requested quantity exceeds capacity', () => {
      const lineQuantity = new Prisma.Decimal(10);
      const reservations = [
        {
          id: 'r1',
          tenant_id: tenantId,
          workshop_task_line_item_id: 'line-1',
          quantity: new Prisma.Decimal(8),
          quantity_consumed: new Prisma.Decimal(2),
          quantity_staged: ZERO,
          quantity_returned: ZERO,
          kind: PartsReservationKind.ON_HAND,
          status: PartsReservationStatus.OPEN,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      // consumed = 2, remaining = 8 - 2 = 6. Total = 8.
      // Requesting 3 would make total 11 > 10.
      expect(() =>
        assertLineAllocationFits(lineQuantity, reservations, new Prisma.Decimal(3)),
      ).toThrow(ConflictException);
    });
  });

  describe('toReservationResponse', () => {
    it('maps reservation fields to DTO strings correctly', () => {
      const now = new Date();
      const res = {
        id: 'res-1',
        tenant_id: tenantId,
        workshop_task_line_item_id: 'line-1',
        quantity: new Prisma.Decimal('3.500'),
        quantity_received: new Prisma.Decimal('1.000'),
        quantity_consumed: new Prisma.Decimal('0.500'),
        quantity_staged: new Prisma.Decimal('2.000'),
        quantity_returned: new Prisma.Decimal('0.000'),
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.STAGED,
        location_id: 'loc-1',
        createdAt: now,
        updatedAt: now,
      };

      const result = toReservationResponse(res);
      expect(result).toEqual({
        id: 'res-1',
        tenantId,
        workshopTaskLineItemId: 'line-1',
        quantity: '3.5',
        quantityReceived: '1',
        quantityConsumed: '0.5',
        quantityStaged: '2',
        quantityReturned: '0',
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.STAGED,
        locationId: 'loc-1',
        createdAt: now,
        updatedAt: now,
      });
    });

    it('handles null location and undefined quantity_received', () => {
      const now = new Date();
      const res = {
        id: 'res-2',
        tenant_id: tenantId,
        workshop_task_line_item_id: 'line-2',
        quantity: new Prisma.Decimal('4.000'),
        quantity_consumed: ZERO,
        quantity_staged: ZERO,
        quantity_returned: ZERO,
        kind: PartsReservationKind.REQUISITION,
        status: PartsReservationStatus.OPEN,
        location_id: null,
        createdAt: now,
        updatedAt: now,
      };

      const result = toReservationResponse(res);
      expect(result.locationId).toBeNull();
      expect(result.quantityReceived).toBe('0');
    });
  });

  describe('toShortageResponse', () => {
    it('returns shortage response when line has uncommitted shortage', () => {
      const shortageLine = {
        id: 'line-1',
        workshop_task_id: 'task-1',
        item_no: 'PART-100',
        description: 'Oil Filter',
        quantity: new Prisma.Decimal(5),
        parts_reservations: [
          {
            quantity: new Prisma.Decimal(2),
            quantity_consumed: ZERO,
            quantity_staged: ZERO,
            quantity_returned: ZERO,
            status: PartsReservationStatus.OPEN,
          },
        ],
        workshop_task: {
          id: 'task-1',
          workshop_order: {
            id: 'order-1',
            order_number: 'WO-001',
            site_id: siteId,
            vehicle: {
              make: 'BMW',
              make_brand_id: 10,
            },
          },
        },
      };

      const result = toShortageResponse(shortageLine);
      expect(result).toEqual({
        workshopOrderId: 'order-1',
        workshopOrderNumber: 'WO-001',
        workshopTaskId: 'task-1',
        workshopTaskLineItemId: 'line-1',
        itemNo: 'PART-100',
        description: 'Oil Filter',
        lineQuantity: '5',
        consumedQuantity: '0',
        activeCommitment: '2',
        shortageQuantity: '3',
        siteId,
        vehicleMake: 'BMW',
        vehicleMakeBrandId: 10,
      });
    });

    it('returns null when there is no shortage', () => {
      const shortageLine = {
        id: 'line-2',
        workshop_task_id: 'task-2',
        item_no: 'PART-200',
        description: 'Air Filter',
        quantity: new Prisma.Decimal(2),
        parts_reservations: [
          {
            quantity: new Prisma.Decimal(2),
            quantity_consumed: ZERO,
            quantity_staged: ZERO,
            quantity_returned: ZERO,
            status: PartsReservationStatus.OPEN,
          },
        ],
        workshop_task: {
          id: 'task-2',
          workshop_order: {
            id: 'order-2',
            order_number: 'WO-002',
            site_id: siteId,
            vehicle: {
              make: 'BMW',
              make_brand_id: 10,
            },
          },
        },
      };

      const result = toShortageResponse(shortageLine);
      expect(result).toBeNull();
    });
  });

  describe('toRequisitionResponse', () => {
    it('maps requisition detail to DTO response', () => {
      const now = new Date();
      const requisition = {
        id: 'req-1',
        tenant_id: tenantId,
        vehicle_make_brand_id: 12,
        status: PartsRequisitionStatus.DRAFT,
        createdAt: now,
        updatedAt: now,
        lines: [
          {
            id: 'req-line-1',
            createdAt: now,
            updatedAt: now,
            reservation: {
              id: 'res-1',
              workshop_task_line_item_id: 'line-1',
              quantity: new Prisma.Decimal('2.000'),
              status: PartsReservationStatus.OPEN,
              purchase_order_item_id: null,
              createdAt: now,
              updatedAt: now,
              workshop_task_line_item: {
                item_no: 'SPARK-1',
                description: 'Spark Plug',
                workshop_task: {
                  workshop_order: {
                    id: 'order-1',
                    order_number: 'WO-101',
                  },
                },
              },
            },
          },
          {
            id: 'req-line-2',
            createdAt: now,
            updatedAt: now,
            reservation: null,
          },
        ],
      };

      const response = toRequisitionResponse(requisition);
      expect(response.id).toBe('req-1');
      expect(response.vehicleMakeBrandId).toBe(12);
      expect(response.lines).toHaveLength(1);
      expect(response.lines[0]).toEqual({
        id: 'req-line-1',
        reservationId: 'res-1',
        workshopTaskLineItemId: 'line-1',
        workshopOrderId: 'order-1',
        workshopOrderNumber: 'WO-101',
        itemNo: 'SPARK-1',
        description: 'Spark Plug',
        quantity: '2',
        status: PartsReservationStatus.OPEN,
        purchaseOrderItemId: null,
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  describe('validateRequisitionPoItems', () => {
    it('validates supported brand and returns catalog item map', async () => {
      const tx = {
        catalogItem: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'cat-1',
              brand_id: 5,
              brand: { id: 5, name: 'Bosch' },
            },
          ]),
        },
      } as any;

      const vendor = {
        id: 'vendor-1',
        name: 'AutoParts Direct',
        supportedBrands: [{ id: 5, name: 'Bosch' }],
      };

      const reservations = [
        {
          id: 'res-1',
          kind: PartsReservationKind.REQUISITION,
          status: PartsReservationStatus.OPEN,
          purchase_order_item_id: null,
          requisition_line: { requisition_id: 'req-1' },
          workshop_task_line_item: {
            catalog_item_id: 'cat-1',
            workshop_task: {
              workshop_order: { site_id: siteId },
            },
          },
        },
      ];

      const catalogMap = await validateRequisitionPoItems(
        tx,
        tenantId,
        siteId,
        'req-1',
        [{ reservationId: 'res-1', unitCost: '50.00' }],
        vendor,
        reservations as any,
      );

      expect(catalogMap.get('cat-1')).toBeDefined();
    });

    it('throws BadRequestException if vendor does not support catalog brand', async () => {
      const tx = {
        catalogItem: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'cat-1',
              brand_id: 8,
              brand: { id: 8, name: 'Denso' },
            },
          ]),
        },
      } as any;

      const vendor = {
        id: 'vendor-1',
        name: 'Bosch Dealer',
        supportedBrands: [{ id: 5, name: 'Bosch' }],
      };

      const reservations = [
        {
          id: 'res-1',
          kind: PartsReservationKind.REQUISITION,
          status: PartsReservationStatus.OPEN,
          purchase_order_item_id: null,
          requisition_line: { requisition_id: 'req-1' },
          workshop_task_line_item: {
            catalog_item_id: 'cat-1',
            workshop_task: {
              workshop_order: { site_id: siteId },
            },
          },
        },
      ];

      await expect(
        validateRequisitionPoItems(
          tx,
          tenantId,
          siteId,
          'req-1',
          [{ reservationId: 'res-1', unitCost: '50.00' }],
          vendor,
          reservations as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleToteReturnStock', () => {
    it('validates return location and records transfer transactions in ledger', async () => {
      const tx = {
        storageLocation: {
          findFirst: jest.fn().mockResolvedValue({ id: 'loc-return' }),
        },
      } as any;

      const ledgerService = {
        recordTransactions: jest.fn().mockResolvedValue([]),
      } as any;

      const line = {
        catalog_item_id: 'cat-1',
        workshop_task: {
          workshop_order: { staging_location_id: 'tote-1' },
        },
      };

      const reservation = {
        id: 'res-1',
        tote_cost_basis: new Prisma.Decimal('12.50'),
      };

      await handleToteReturnStock(
        tx,
        tenantId,
        siteId,
        line,
        reservation,
        new Prisma.Decimal(2),
        'loc-return',
        ledgerService,
      );

      expect(tx.storageLocation.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'loc-return',
          tenant_id: tenantId,
          site_id: siteId,
          deletedAt: null,
          type: LocationType.bin,
          site: { is_active: true },
        },
        select: { id: true },
      });

      expect(ledgerService.recordTransactions).toHaveBeenCalledWith(
        [
          {
            itemId: 'cat-1',
            locationId: 'tote-1',
            quantity: new Prisma.Decimal(-2),
            type: TransactionType.TRANSFER_OUT,
            referenceId: 'WO-RELEASE-res-1',
            costBasis: new Prisma.Decimal('12.50'),
            partsReservationId: 'res-1',
          },
          {
            itemId: 'cat-1',
            locationId: 'loc-return',
            quantity: new Prisma.Decimal(2),
            type: TransactionType.TRANSFER_IN,
            referenceId: 'WO-RELEASE-res-1',
            costBasis: new Prisma.Decimal('12.50'),
            partsReservationId: 'res-1',
          },
        ],
        tx,
      );
    });
  });
});
