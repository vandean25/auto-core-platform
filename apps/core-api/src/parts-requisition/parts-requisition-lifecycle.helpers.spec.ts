import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  PartsReservationKind,
  PartsReservationStatus,
  PartsRequisitionStatus,
  Prisma,
  TransactionType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import {
  assertLineAllocationFits,
  assertUniqueSelections,
  cancelReservationRecord,
  executeReleaseReservation,
  groupReservationsByLine,
  handleToteReturnStock,
  loadAndLockReservationForRelease,
  releaseOnHandReservationCommitment,
  releaseStagedReservationStock,
  syncLineItemStatusAfterRelease,
  syncRequisitionAfterRelease,
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

  describe('loadAndLockReservationForRelease', () => {
    it('loads reservation and acquires locks on task, line, and reservation', async () => {
      const mockReservation = {
        id: 'res-1',
        workshop_task_line_item: {
          id: 'line-1',
          workshop_task_id: 'task-1',
        },
      };
      const tx = {
        partsReservation: {
          findFirst: jest.fn().mockResolvedValue(mockReservation),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      } as any;

      const result = await loadAndLockReservationForRelease(
        tx,
        tenantId,
        siteId,
        'res-1',
      );

      expect(result).toBe(mockReservation);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    });

    it('throws UnprocessableEntityException when reservation is fulfilled', async () => {
      const tx = {
        partsReservation: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ status: PartsReservationStatus.FULFILLED }),
        },
      } as any;

      await expect(
        loadAndLockReservationForRelease(tx, tenantId, siteId, 'res-1'),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws NotFoundException when reservation does not exist', async () => {
      const tx = {
        partsReservation: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as any;

      await expect(
        loadAndLockReservationForRelease(tx, tenantId, siteId, 'res-nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('releaseStagedReservationStock', () => {
    it('delegates to handleToteReturnStock when staged quantity is positive', async () => {
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
        tote_cost_basis: new Prisma.Decimal('10.00'),
      };

      await releaseStagedReservationStock(tx, {
        tenantId,
        siteId,
        line,
        reservation,
        staged: new Prisma.Decimal(3),
        returnLocationId: 'loc-return',
        ledgerService,
      });

      expect(ledgerService.recordTransactions).toHaveBeenCalled();
    });

    it('no-ops when staged quantity is zero', async () => {
      const tx = {
        storageLocation: { findFirst: jest.fn() },
      } as any;
      const ledgerService = { recordTransactions: jest.fn() } as any;

      await releaseStagedReservationStock(tx, {
        tenantId,
        siteId,
        line: {} as any,
        reservation: { id: 'res-1' },
        staged: ZERO,
        returnLocationId: 'loc-return',
        ledgerService,
      });

      expect(tx.storageLocation.findFirst).not.toHaveBeenCalled();
      expect(ledgerService.recordTransactions).not.toHaveBeenCalled();
    });
  });

  describe('releaseOnHandReservationCommitment', () => {
    it('releases on-hand commitment when reservation is OPEN and ON_HAND', async () => {
      const tx = {
        inventoryStock: {
          findFirst: jest.fn().mockResolvedValue({ id: 'stock-1' }),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      } as any;
      const atpService = {
        releaseOnHand: jest.fn().mockResolvedValue(undefined),
      } as any;

      const line = { catalog_item_id: 'cat-1' };
      const reservation = {
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: 'loc-1',
        quantity: new Prisma.Decimal(5),
        quantity_consumed: ZERO,
        quantity_returned: ZERO,
      };

      await releaseOnHandReservationCommitment(tx, {
        tenantId,
        siteId,
        line,
        reservation,
        staged: new Prisma.Decimal(2),
        atpService,
      });

      expect(tx.inventoryStock.findFirst).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
          catalog_item_id: 'cat-1',
          location_id: 'loc-1',
          site_id: siteId,
        },
        select: { id: true },
      });
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(atpService.releaseOnHand).toHaveBeenCalledWith(
        { stockId: 'stock-1', quantity: new Prisma.Decimal(3) },
        tx,
      );
    });

    it('does nothing when reservation is not ON_HAND', async () => {
      const tx = { inventoryStock: { findFirst: jest.fn() } } as any;
      const atpService = { releaseOnHand: jest.fn() } as any;

      await releaseOnHandReservationCommitment(tx, {
        tenantId,
        siteId,
        line: { catalog_item_id: 'cat-1' },
        reservation: {
          kind: PartsReservationKind.REQUISITION,
          status: PartsReservationStatus.OPEN,
          location_id: 'loc-1',
          quantity: new Prisma.Decimal(5),
          quantity_consumed: ZERO,
          quantity_returned: ZERO,
        },
        staged: ZERO,
        atpService,
      });

      expect(tx.inventoryStock.findFirst).not.toHaveBeenCalled();
      expect(atpService.releaseOnHand).not.toHaveBeenCalled();
    });
  });

  describe('cancelReservationRecord', () => {
    it('updates reservation status to CANCELLED and increments returned qty', async () => {
      const tx = {
        partsReservation: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;

      const reservation = {
        id: 'res-1',
        status: PartsReservationStatus.OPEN,
        quantity_staged: new Prisma.Decimal(2),
        purchase_order_item_id: 'poi-1',
        detached_at: null,
      };

      await cancelReservationRecord(
        tx,
        tenantId,
        reservation,
        new Prisma.Decimal(2),
      );

      expect(tx.partsReservation.updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
          id: 'res-1',
          status: PartsReservationStatus.OPEN,
          quantity_staged: new Prisma.Decimal(2),
        },
        data: expect.objectContaining({
          status: PartsReservationStatus.CANCELLED,
          quantity_staged: 0,
          quantity_returned: { increment: new Prisma.Decimal(2) },
          detached_at: expect.any(Date),
        }),
      });
    });

    it('throws ConflictException when concurrent update occurs', async () => {
      const tx = {
        partsReservation: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as any;

      const reservation = {
        id: 'res-1',
        status: PartsReservationStatus.OPEN,
        quantity_staged: ZERO,
      };

      await expect(
        cancelReservationRecord(tx, tenantId, reservation, ZERO),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('syncLineItemStatusAfterRelease', () => {
    it('sets line status to CONSUMED when no active slices remain and consumed > 0', async () => {
      const tx = {
        partsReservation: {
          findMany: jest.fn().mockResolvedValue([
            {
              status: PartsReservationStatus.CANCELLED,
              quantity: new Prisma.Decimal(2),
              quantity_consumed: new Prisma.Decimal(2),
              quantity_returned: ZERO,
              quantity_staged: ZERO,
            },
          ]),
        },
        workshopTaskLineItem: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workshopTask: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;

      await syncLineItemStatusAfterRelease(tx, tenantId, 'line-1', 'task-1');

      expect(tx.workshopTaskLineItem.updateMany).toHaveBeenCalledWith({
        where: { tenant_id: tenantId, id: 'line-1' },
        data: {
          quantity: new Prisma.Decimal(2),
          part_execution_status: WorkshopPartLineExecutionStatus.CONSUMED,
        },
      });
      expect(tx.workshopTask.updateMany).toHaveBeenCalledWith({
        where: { id: 'task-1', tenant_id: tenantId },
        data: { line_items_version: { increment: 1 } },
      });
    });

    it('sets line status to CANCELLED when no active slices remain and consumed is 0', async () => {
      const tx = {
        partsReservation: {
          findMany: jest.fn().mockResolvedValue([
            {
              status: PartsReservationStatus.CANCELLED,
              quantity: new Prisma.Decimal(2),
              quantity_consumed: ZERO,
              quantity_returned: new Prisma.Decimal(2),
              quantity_staged: ZERO,
            },
          ]),
        },
        workshopTaskLineItem: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workshopTask: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;

      await syncLineItemStatusAfterRelease(tx, tenantId, 'line-1', 'task-1');

      expect(tx.workshopTaskLineItem.updateMany).toHaveBeenCalledWith({
        where: { tenant_id: tenantId, id: 'line-1' },
        data: {
          quantity: ZERO,
          part_execution_status: WorkshopPartLineExecutionStatus.CANCELLED,
        },
      });
    });

    it('sets line status to STAGED when active staged slices remain', async () => {
      const tx = {
        partsReservation: {
          findMany: jest.fn().mockResolvedValue([
            {
              status: PartsReservationStatus.STAGED,
              quantity: new Prisma.Decimal(2),
              quantity_consumed: ZERO,
              quantity_returned: ZERO,
              quantity_staged: new Prisma.Decimal(2),
            },
          ]),
        },
        workshopTaskLineItem: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workshopTask: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;

      await syncLineItemStatusAfterRelease(tx, tenantId, 'line-1', 'task-1');

      expect(tx.workshopTaskLineItem.updateMany).toHaveBeenCalledWith({
        where: { tenant_id: tenantId, id: 'line-1' },
        data: {
          part_execution_status: WorkshopPartLineExecutionStatus.STAGED,
        },
      });
    });
  });

  describe('syncRequisitionAfterRelease', () => {
    it('triggers status recompute when requisitionId is provided', async () => {
      const tx = {
        partsRequisition: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as any;

      await syncRequisitionAfterRelease(tx, tenantId, 'req-1');
      expect(tx.partsRequisition.findFirst).toHaveBeenCalledWith({
        where: { id: 'req-1', tenant_id: tenantId },
        select: { status: true },
      });
    });

    it('does nothing when requisitionId is not provided', async () => {
      const tx = { partsRequisition: { findFirst: jest.fn() } } as any;
      await syncRequisitionAfterRelease(tx, tenantId, null);
      expect(tx.partsRequisition.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('executeReleaseReservation', () => {
    it('orchestrates full release flow successfully', async () => {
      const now = new Date();
      const mockReservation = {
        id: 'res-1',
        tenant_id: tenantId,
        workshop_task_line_item_id: 'line-1',
        quantity: new Prisma.Decimal('2'),
        quantity_consumed: ZERO,
        quantity_returned: ZERO,
        quantity_staged: ZERO,
        kind: PartsReservationKind.REQUISITION,
        status: PartsReservationStatus.OPEN,
        location_id: null,
        workshop_task_line_item: {
          id: 'line-1',
          workshop_task_id: 'task-1',
          catalog_item_id: 'cat-1',
          workshop_task: {
            workshop_order: { staging_location_id: 'tote-1' },
          },
        },
        requisition_line: { requisition_id: 'req-1' },
        createdAt: now,
        updatedAt: now,
      };

      const finalReservation = {
        ...mockReservation,
        status: PartsReservationStatus.CANCELLED,
        quantity_returned: new Prisma.Decimal('2'),
      };

      const tx = {
        partsReservation: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(mockReservation)
            .mockResolvedValueOnce(finalReservation),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest.fn().mockResolvedValue([finalReservation]),
        },
        workshopTaskLineItem: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workshopTask: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        partsRequisition: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      } as any;

      const atpService = { releaseOnHand: jest.fn() } as any;
      const ledgerService = { recordTransactions: jest.fn() } as any;

      const result = await executeReleaseReservation(
        tx,
        tenantId,
        siteId,
        'res-1',
        {},
        atpService,
        ledgerService,
      );

      expect(result.id).toBe('res-1');
      expect(result.status).toBe(PartsReservationStatus.CANCELLED);
      expect(tx.partsReservation.updateMany).toHaveBeenCalled();
      expect(tx.workshopTaskLineItem.updateMany).toHaveBeenCalled();
    });
  });
});
