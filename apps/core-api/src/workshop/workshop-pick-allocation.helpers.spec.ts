import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  PartsReservationKind,
  PartsReservationStatus,
  Prisma,
  TransactionType,
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { mockPrisma, resetWorkshopMocks } from './workshop.spec.support';
import {
  aggregateRequestedPicks,
  buildLedgerTransactions,
  buildMovedLines,
  buildStagePlans,
  calculatePickAllocations,
  calculateStagedQuantitiesByLine,
  findFullyStagedLineIds,
  findLatestInboundCosts,
  getUnstagedQuantity,
  loadAndLockPickContext,
  loadSourceStocksAndLocations,
} from './workshop-pick-allocation.helpers';
import type {
  PickLine,
  ReservationSlice,
  SourceStock,
  StagePlan,
} from './workshop-pick-allocation.helpers';

const Decimal = Prisma.Decimal;

describe('workshop-pick-allocation.helpers', () => {
  const mockTx = mockPrisma as unknown as Prisma.TransactionClient;
  const mockLockRows = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    resetWorkshopMocks();
    mockLockRows.mockReset().mockResolvedValue(undefined);
  });

  describe('getUnstagedQuantity', () => {
    it('returns unstaged quantity when received is less than or equal to quantity', () => {
      const result = getUnstagedQuantity(new Decimal(5), new Decimal(2));
      expect(result.toString()).toBe('3');

      const zeroUnstaged = getUnstagedQuantity(new Decimal(5), new Decimal(5));
      expect(zeroUnstaged.toString()).toBe('0');
    });

    it('throws InternalServerErrorException when received exceeds quantity', () => {
      expect(() => getUnstagedQuantity(new Decimal(3), new Decimal(5))).toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('aggregateRequestedPicks', () => {
    it('aggregates quantities for identical line items', () => {
      const result = aggregateRequestedPicks([
        { workshopTaskLineItemId: 'line-1', quantity: 2 },
        { workshopTaskLineItemId: 'line-1', quantity: 3 },
        { workshopTaskLineItemId: 'line-2', quantity: 1 },
      ]);

      expect(result.size).toBe(2);
      expect(result.get('line-1')?.quantity.toString()).toBe('5');
      expect(result.get('line-2')?.quantity.toString()).toBe('1');
    });

    it('throws BadRequestException if any pick quantity is zero or negative', () => {
      expect(() =>
        aggregateRequestedPicks([
          { workshopTaskLineItemId: 'line-1', quantity: 0 },
        ]),
      ).toThrow(BadRequestException);

      expect(() =>
        aggregateRequestedPicks([
          { workshopTaskLineItemId: 'line-1', quantity: -2 },
        ]),
      ).toThrow(BadRequestException);
    });
  });

  describe('calculatePickAllocations', () => {
    const line1: PickLine = {
      id: 'line-1',
      workshop_task_id: 'task-1',
      catalog_item_id: 'item-1',
      quantity: new Decimal(5),
      part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
    };

    const makeReservation = (
      id: string,
      qty: number,
      received: number = 0,
      status: PartsReservationStatus = PartsReservationStatus.OPEN,
    ): ReservationSlice => ({
      id,
      workshop_task_line_item_id: 'line-1',
      quantity: new Decimal(qty),
      quantity_received: new Decimal(received),
      quantity_staged: new Decimal(received),
      quantity_consumed: new Decimal(0),
      quantity_returned: new Decimal(0),
      kind: PartsReservationKind.ON_HAND,
      status,
      location_id: 'loc-1',
      tote_cost_basis: null,
      createdAt: new Date('2026-01-01'),
    });

    it('allocates across multiple OPEN reservations FIFO', () => {
      const lines = new Map([['line-1', line1]]);
      const reservations = [
        makeReservation('res-1', 2, 0),
        makeReservation('res-2', 3, 0),
      ];
      const reservationsByLine = new Map([['line-1', reservations]]);
      const requestedPicks = new Map([
        [
          'line-1',
          { workshopTaskLineItemId: 'line-1', quantity: new Decimal(4) },
        ],
      ]);

      const plans = calculatePickAllocations(
        lines,
        reservationsByLine,
        requestedPicks,
      );

      expect(plans).toHaveLength(2);
      expect(plans[0].reservation.id).toBe('res-1');
      expect(plans[0].quantity.toString()).toBe('2');
      expect(plans[1].reservation.id).toBe('res-2');
      expect(plans[1].quantity.toString()).toBe('2');
    });

    it('throws NotFoundException if requested line item is missing', () => {
      const lines = new Map<string, PickLine>();
      const reservationsByLine = new Map<string, ReservationSlice[]>();
      const requestedPicks = new Map([
        [
          'line-missing',
          { workshopTaskLineItemId: 'line-missing', quantity: new Decimal(1) },
        ],
      ]);

      expect(() =>
        calculatePickAllocations(lines, reservationsByLine, requestedPicks),
      ).toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException if line item has no catalog_item_id', () => {
      const nonCatalogLine: PickLine = {
        ...line1,
        catalog_item_id: null,
      };
      const lines = new Map([['line-1', nonCatalogLine]]);
      const reservationsByLine = new Map([
        ['line-1', [makeReservation('res-1', 5)]],
      ]);
      const requestedPicks = new Map([
        [
          'line-1',
          { workshopTaskLineItemId: 'line-1', quantity: new Decimal(2) },
        ],
      ]);

      expect(() =>
        calculatePickAllocations(lines, reservationsByLine, requestedPicks),
      ).toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException if requested quantity exceeds available reservations', () => {
      const lines = new Map([['line-1', line1]]);
      const reservationsByLine = new Map([
        ['line-1', [makeReservation('res-1', 2)]],
      ]);
      const requestedPicks = new Map([
        [
          'line-1',
          { workshopTaskLineItemId: 'line-1', quantity: new Decimal(5) },
        ],
      ]);

      expect(() =>
        calculatePickAllocations(lines, reservationsByLine, requestedPicks),
      ).toThrow(UnprocessableEntityException);
    });

    it('ignores non-OPEN reservations', () => {
      const lines = new Map([['line-1', line1]]);
      const reservations = [
        makeReservation('res-1', 2, 2, PartsReservationStatus.STAGED),
        makeReservation('res-2', 3, 0, PartsReservationStatus.OPEN),
      ];
      const reservationsByLine = new Map([['line-1', reservations]]);
      const requestedPicks = new Map([
        [
          'line-1',
          { workshopTaskLineItemId: 'line-1', quantity: new Decimal(2) },
        ],
      ]);

      const plans = calculatePickAllocations(
        lines,
        reservationsByLine,
        requestedPicks,
      );

      expect(plans).toHaveLength(1);
      expect(plans[0].reservation.id).toBe('res-2');
      expect(plans[0].quantity.toString()).toBe('2');
    });
  });

  describe('findLatestInboundCosts', () => {
    it('returns empty map if all plans already have quantity_received > 0', async () => {
      const plans = [
        {
          line: {
            id: 'line-1',
            workshop_task_id: 't-1',
            catalog_item_id: 'item-1',
            quantity: new Decimal(1),
            part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
          },
          reservation: {
            id: 'res-1',
            workshop_task_line_item_id: 'line-1',
            quantity: new Decimal(1),
            quantity_received: new Decimal(1),
            quantity_staged: new Decimal(1),
            quantity_consumed: new Decimal(0),
            quantity_returned: new Decimal(0),
            kind: PartsReservationKind.ON_HAND,
            status: PartsReservationStatus.OPEN,
            location_id: 'loc-1',
            tote_cost_basis: new Decimal(50),
            createdAt: new Date(),
          },
          quantity: new Decimal(1),
        },
      ];

      const costs = await findLatestInboundCosts(mockTx, 'tenant-1', plans);
      expect(costs.size).toBe(0);
      expect(mockPrisma.inventoryTransaction.findMany).not.toHaveBeenCalled();
    });

    it('queries inbound transactions and returns latest cost basis by item:location', async () => {
      const plans = [
        {
          line: {
            id: 'line-1',
            workshop_task_id: 't-1',
            catalog_item_id: 'item-1',
            quantity: new Decimal(1),
            part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
          },
          reservation: {
            id: 'res-1',
            workshop_task_line_item_id: 'line-1',
            quantity: new Decimal(1),
            quantity_received: new Decimal(0),
            quantity_staged: new Decimal(0),
            quantity_consumed: new Decimal(0),
            quantity_returned: new Decimal(0),
            kind: PartsReservationKind.ON_HAND,
            status: PartsReservationStatus.OPEN,
            location_id: 'loc-1',
            tote_cost_basis: null,
            createdAt: new Date(),
          },
          quantity: new Decimal(1),
        },
      ];

      mockPrisma.inventoryTransaction.findMany.mockResolvedValue([
        {
          item_id: 'item-1',
          location_id: 'loc-1',
          cost_basis: new Decimal(42),
        },
      ]);

      const costs = await findLatestInboundCosts(mockTx, 'tenant-1', plans);
      expect(costs.get('item-1:loc-1')?.toString()).toBe('42');
      expect(mockPrisma.inventoryTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: 'tenant-1',
          }),
        }),
      );
    });
  });

  describe('loadAndLockPickContext', () => {
    it('throws NotFoundException when requested lines do not match initial query count', async () => {
      mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([]);
      const requestedPicks = new Map([
        [
          'line-1',
          { workshopTaskLineItemId: 'line-1', quantity: new Decimal(1) },
        ],
      ]);

      await expect(
        loadAndLockPickContext(
          mockTx,
          'tenant-1',
          'order-1',
          requestedPicks,
          mockLockRows,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('loads lines and reservations and acquires row-level locks', async () => {
      const lineRow = {
        id: 'line-1',
        workshop_task_id: 'task-1',
        catalog_item_id: 'item-1',
        quantity: new Decimal(2),
        part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
      };
      const resRow = {
        id: 'res-1',
        workshop_task_line_item_id: 'line-1',
        quantity: new Decimal(2),
        quantity_received: new Decimal(0),
        quantity_staged: new Decimal(0),
        quantity_consumed: new Decimal(0),
        quantity_returned: new Decimal(0),
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: 'loc-1',
        tote_cost_basis: null,
        createdAt: new Date(),
      };

      mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([lineRow]);
      mockPrisma.partsReservation.findMany.mockResolvedValue([resRow]);

      const requestedPicks = new Map([
        [
          'line-1',
          { workshopTaskLineItemId: 'line-1', quantity: new Decimal(2) },
        ],
      ]);

      const result = await loadAndLockPickContext(
        mockTx,
        'tenant-1',
        'order-1',
        requestedPicks,
        mockLockRows,
      );

      expect(result.lines.get('line-1')).toEqual(lineRow);
      expect(result.reservationsByLine.get('line-1')).toEqual([resRow]);
      expect(mockLockRows).toHaveBeenCalledTimes(3);
      expect(mockLockRows).toHaveBeenCalledWith(
        mockTx,
        'workshop_tasks',
        'tenant-1',
        ['task-1'],
      );
      expect(mockLockRows).toHaveBeenCalledWith(
        mockTx,
        'workshop_task_line_items',
        'tenant-1',
        ['line-1'],
      );
      expect(mockLockRows).toHaveBeenCalledWith(
        mockTx,
        'parts_reservations',
        'tenant-1',
        ['res-1'],
      );
    });
  });

  describe('loadSourceStocksAndLocations', () => {
    const preliminaryPlan = {
      line: {
        id: 'line-1',
        workshop_task_id: 'task-1',
        catalog_item_id: 'item-1',
        quantity: new Decimal(2),
        part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
      },
      reservation: {
        id: 'res-1',
        workshop_task_line_item_id: 'line-1',
        quantity: new Decimal(2),
        quantity_received: new Decimal(0),
        quantity_staged: new Decimal(0),
        quantity_consumed: new Decimal(0),
        quantity_returned: new Decimal(0),
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: 'bin-1',
        tote_cost_basis: null,
        createdAt: new Date(),
      },
      quantity: new Decimal(2),
    };

    it('throws UnprocessableEntityException if source location is missing from active site', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([]);

      await expect(
        loadSourceStocksAndLocations(
          mockTx,
          'tenant-1',
          'site-1',
          'dest-tote',
          [preliminaryPlan],
          mockLockRows,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException if reservation location_id is null', async () => {
      const planWithNullLoc = {
        ...preliminaryPlan,
        reservation: { ...preliminaryPlan.reservation, location_id: null },
      };

      await expect(
        loadSourceStocksAndLocations(
          mockTx,
          'tenant-1',
          'site-1',
          'dest-tote',
          [planWithNullLoc],
          mockLockRows,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws UnprocessableEntityException if stock is missing for item and location', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([
        {
          id: 'bin-1',
          type: LocationType.bin,
          deletedAt: null,
          site_id: 'site-1',
        },
      ]);
      mockPrisma.inventoryStock.findMany.mockResolvedValue([]);

      await expect(
        loadSourceStocksAndLocations(
          mockTx,
          'tenant-1',
          'site-1',
          'dest-tote',
          [preliminaryPlan],
          mockLockRows,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('loads locations and stocks and acquires lock on inventory_stocks', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([
        {
          id: 'bin-1',
          type: LocationType.bin,
          deletedAt: null,
          site_id: 'site-1',
        },
      ]);
      const stockRow = {
        id: 'stock-1',
        catalog_item_id: 'item-1',
        location_id: 'bin-1',
        quantity_on_hand: new Decimal(10),
        quantity_reserved: new Decimal(2),
      };
      mockPrisma.inventoryStock.findMany.mockResolvedValue([stockRow]);

      const result = await loadSourceStocksAndLocations(
        mockTx,
        'tenant-1',
        'site-1',
        'dest-tote',
        [preliminaryPlan],
        mockLockRows,
      );

      expect(result.stockByKey.get('item-1:bin-1')).toEqual(stockRow);
      expect(result.sourceLocationById.get('bin-1')?.id).toBe('bin-1');
      expect(mockLockRows).toHaveBeenCalledWith(
        mockTx,
        'inventory_stocks',
        'tenant-1',
        ['stock-1'],
      );
    });
  });

  describe('buildStagePlans', () => {
    const line: PickLine = {
      id: 'line-1',
      workshop_task_id: 'task-1',
      catalog_item_id: 'item-1',
      quantity: new Decimal(2),
      part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
    };
    const reservation: ReservationSlice = {
      id: 'res-1',
      workshop_task_line_item_id: 'line-1',
      quantity: new Decimal(2),
      quantity_received: new Decimal(0),
      quantity_staged: new Decimal(0),
      quantity_consumed: new Decimal(0),
      quantity_returned: new Decimal(0),
      kind: PartsReservationKind.ON_HAND,
      status: PartsReservationStatus.OPEN,
      location_id: 'bin-1',
      tote_cost_basis: null,
      createdAt: new Date(),
    };

    it('throws InternalServerErrorException when inventory ATP invariant fails (available < 0)', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([
        {
          id: 'bin-1',
          type: LocationType.bin,
          deletedAt: null,
          site_id: 'site-1',
        },
      ]);
      mockPrisma.inventoryStock.findMany.mockResolvedValue([
        {
          id: 'stock-1',
          catalog_item_id: 'item-1',
          location_id: 'bin-1',
          quantity_on_hand: new Decimal(1),
          quantity_reserved: new Decimal(5), // on_hand < reserved
        },
      ]);

      const lines = new Map([['line-1', line]]);
      const reservationsByLine = new Map([['line-1', [reservation]]]);
      const requestedPicks = new Map([
        [
          'line-1',
          { workshopTaskLineItemId: 'line-1', quantity: new Decimal(2) },
        ],
      ]);

      await expect(
        buildStagePlans(
          mockTx,
          'tenant-1',
          'site-1',
          'dest-tote',
          lines,
          reservationsByLine,
          requestedPicks,
          mockLockRows,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('throws UnprocessableEntityException when stock available ATP is less than requested', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([
        {
          id: 'bin-1',
          type: LocationType.bin,
          deletedAt: null,
          site_id: 'site-1',
        },
      ]);
      mockPrisma.inventoryStock.findMany.mockResolvedValue([
        {
          id: 'stock-1',
          catalog_item_id: 'item-1',
          location_id: 'bin-1',
          quantity_on_hand: new Decimal(5),
          quantity_reserved: new Decimal(1), // reserved (1) < requested (2)
        },
      ]);

      const lines = new Map([['line-1', line]]);
      const reservationsByLine = new Map([['line-1', [reservation]]]);
      const requestedPicks = new Map([
        [
          'line-1',
          { workshopTaskLineItemId: 'line-1', quantity: new Decimal(2) },
        ],
      ]);

      await expect(
        buildStagePlans(
          mockTx,
          'tenant-1',
          'site-1',
          'dest-tote',
          lines,
          reservationsByLine,
          requestedPicks,
          mockLockRows,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('builds stage plans successfully with resolved cost basis', async () => {
      mockPrisma.storageLocation.findMany.mockResolvedValue([
        {
          id: 'bin-1',
          type: LocationType.bin,
          deletedAt: null,
          site_id: 'site-1',
        },
      ]);
      mockPrisma.inventoryStock.findMany.mockResolvedValue([
        {
          id: 'stock-1',
          catalog_item_id: 'item-1',
          location_id: 'bin-1',
          quantity_on_hand: new Decimal(5),
          quantity_reserved: new Decimal(5),
        },
      ]);
      mockPrisma.inventoryTransaction.findMany.mockResolvedValue([
        {
          item_id: 'item-1',
          location_id: 'bin-1',
          cost_basis: new Decimal(15),
        },
      ]);

      const lines = new Map([['line-1', line]]);
      const reservationsByLine = new Map([['line-1', [reservation]]]);
      const requestedPicks = new Map([
        [
          'line-1',
          { workshopTaskLineItemId: 'line-1', quantity: new Decimal(2) },
        ],
      ]);

      const plans = await buildStagePlans(
        mockTx,
        'tenant-1',
        'site-1',
        'dest-tote',
        lines,
        reservationsByLine,
        requestedPicks,
        mockLockRows,
      );

      expect(plans).toHaveLength(1);
      expect(plans[0].quantity.toString()).toBe('2');
      expect(plans[0].costBasis?.toString()).toBe('15');
      expect(plans[0].sourceStock.id).toBe('stock-1');
    });
  });

  describe('buildLedgerTransactions', () => {
    it('creates balanced TRANSFER_OUT and TRANSFER_IN entries', () => {
      const plan: StagePlan = {
        line: {
          id: 'line-1',
          workshop_task_id: 'task-1',
          catalog_item_id: 'item-1',
          quantity: new Decimal(2),
          part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
        },
        reservation: {
          id: 'res-1',
          workshop_task_line_item_id: 'line-1',
          quantity: new Decimal(2),
          quantity_received: new Decimal(0),
          quantity_staged: new Decimal(0),
          quantity_consumed: new Decimal(0),
          quantity_returned: new Decimal(0),
          kind: PartsReservationKind.ON_HAND,
          status: PartsReservationStatus.OPEN,
          location_id: 'bin-1',
          tote_cost_basis: null,
          createdAt: new Date(),
        },
        sourceStock: {
          id: 'stock-1',
          catalog_item_id: 'item-1',
          location_id: 'bin-1',
          quantity_on_hand: new Decimal(5),
          quantity_reserved: new Decimal(5),
        },
        quantity: new Decimal(2),
        costBasis: new Decimal(12.5),
      };

      const transactions = buildLedgerTransactions([plan], 'tote-1', 'TG-1');

      expect(transactions).toHaveLength(2);
      expect(transactions[0]).toMatchObject({
        itemId: 'item-1',
        locationId: 'bin-1',
        quantity: new Decimal(-2),
        type: TransactionType.TRANSFER_OUT,
        referenceId: 'TG-1:line-1:1',
        costBasis: new Decimal(12.5),
        partsReservationId: 'res-1',
      });
      expect(transactions[1]).toMatchObject({
        itemId: 'item-1',
        locationId: 'tote-1',
        quantity: new Decimal(2),
        type: TransactionType.TRANSFER_IN,
        referenceId: 'TG-1:line-1:1',
        costBasis: new Decimal(12.5),
        partsReservationId: 'res-1',
      });
    });
  });

  describe('calculateStagedQuantitiesByLine & findFullyStagedLineIds', () => {
    it('calculates total staged quantities and identifies fully staged lines', () => {
      const line1: PickLine = {
        id: 'line-1',
        workshop_task_id: 'task-1',
        catalog_item_id: 'item-1',
        quantity: new Decimal(4),
        part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
      };
      const line2: PickLine = {
        id: 'line-2',
        workshop_task_id: 'task-1',
        catalog_item_id: 'item-2',
        quantity: new Decimal(5),
        part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
      };

      const plan1: StagePlan = {
        line: line1,
        reservation: {
          id: 'res-1',
          workshop_task_line_item_id: 'line-1',
          quantity: new Decimal(4),
          quantity_received: new Decimal(0),
          quantity_staged: new Decimal(2), // already staged 2
          quantity_consumed: new Decimal(0),
          quantity_returned: new Decimal(0),
          kind: PartsReservationKind.ON_HAND,
          status: PartsReservationStatus.OPEN,
          location_id: 'bin-1',
          tote_cost_basis: null,
          createdAt: new Date(),
        },
        sourceStock: {
          id: 'stock-1',
          catalog_item_id: 'item-1',
          location_id: 'bin-1',
          quantity_on_hand: new Decimal(10),
          quantity_reserved: new Decimal(10),
        },
        quantity: new Decimal(2), // staging 2 more -> total staged 4 >= line qty 4 (fully staged)
        costBasis: null,
      };

      const plan2: StagePlan = {
        line: line2,
        reservation: {
          id: 'res-2',
          workshop_task_line_item_id: 'line-2',
          quantity: new Decimal(5),
          quantity_received: new Decimal(0),
          quantity_staged: new Decimal(0),
          quantity_consumed: new Decimal(0),
          quantity_returned: new Decimal(0),
          kind: PartsReservationKind.ON_HAND,
          status: PartsReservationStatus.OPEN,
          location_id: 'bin-2',
          tote_cost_basis: null,
          createdAt: new Date(),
        },
        sourceStock: {
          id: 'stock-2',
          catalog_item_id: 'item-2',
          location_id: 'bin-2',
          quantity_on_hand: new Decimal(10),
          quantity_reserved: new Decimal(10),
        },
        quantity: new Decimal(2), // staging 2 -> total staged 2 < line qty 5 (partially staged)
        costBasis: null,
      };

      const reservationsByLine = new Map([
        ['line-1', [plan1.reservation]],
        ['line-2', [plan2.reservation]],
      ]);

      const stagedByLine = calculateStagedQuantitiesByLine(
        [plan1, plan2],
        reservationsByLine,
      );

      expect(stagedByLine.get('line-1')?.toString()).toBe('4');
      expect(stagedByLine.get('line-2')?.toString()).toBe('2');

      const fullyStaged = findFullyStagedLineIds([plan1, plan2], stagedByLine);
      expect(fullyStaged).toEqual(['line-1']);
    });
  });

  describe('buildMovedLines', () => {
    it('aggregates allocations and moved quantity per workshop task line item', () => {
      const line1: PickLine = {
        id: 'line-1',
        workshop_task_id: 'task-1',
        catalog_item_id: 'item-1',
        quantity: new Decimal(5),
        part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
      };

      const planA: StagePlan = {
        line: line1,
        reservation: {
          id: 'res-1',
          workshop_task_line_item_id: 'line-1',
          quantity: new Decimal(2),
          quantity_received: new Decimal(0),
          quantity_staged: new Decimal(0),
          quantity_consumed: new Decimal(0),
          quantity_returned: new Decimal(0),
          kind: PartsReservationKind.ON_HAND,
          status: PartsReservationStatus.OPEN,
          location_id: 'bin-A',
          tote_cost_basis: null,
          createdAt: new Date(),
        },
        sourceStock: {
          id: 'stock-A',
          catalog_item_id: 'item-1',
          location_id: 'bin-A',
          quantity_on_hand: new Decimal(10),
          quantity_reserved: new Decimal(10),
        },
        quantity: new Decimal(2),
        costBasis: null,
      };

      const planB: StagePlan = {
        line: line1,
        reservation: {
          id: 'res-2',
          workshop_task_line_item_id: 'line-1',
          quantity: new Decimal(3),
          quantity_received: new Decimal(0),
          quantity_staged: new Decimal(0),
          quantity_consumed: new Decimal(0),
          quantity_returned: new Decimal(0),
          kind: PartsReservationKind.ON_HAND,
          status: PartsReservationStatus.OPEN,
          location_id: 'bin-B',
          tote_cost_basis: null,
          createdAt: new Date(),
        },
        sourceStock: {
          id: 'stock-B',
          catalog_item_id: 'item-1',
          location_id: 'bin-B',
          quantity_on_hand: new Decimal(10),
          quantity_reserved: new Decimal(10),
        },
        quantity: new Decimal(3),
        costBasis: null,
      };

      const movedLines = buildMovedLines([planA, planB], 'TG-1');

      expect(movedLines).toHaveLength(1);
      expect(movedLines[0].workshopTaskLineItemId).toBe('line-1');
      expect(movedLines[0].movedQuantity).toBe(5);
      expect(movedLines[0].allocations).toEqual([
        {
          sourceLocationId: 'bin-A',
          quantity: 2,
          referenceId: 'TG-1:line-1:1',
        },
        {
          sourceLocationId: 'bin-B',
          quantity: 3,
          referenceId: 'TG-1:line-1:2',
        },
      ]);
    });
  });
});
