import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopPickPartsService } from './workshop-pick-parts.service';
import {
  PartsReservationKind,
  PartsReservationStatus,
  Prisma,
  mockLedgerService,
  mockPrisma,
  mockSiteContext,
  resetWorkshopMocks,
  workshopLedgerProvider,
  workshopPrismaProvider,
  workshopSiteProvider,
  workshopTenantProvider,
  TransactionType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from './workshop.spec.support';

describe('WorkshopPickPartsService', () => {
  let service: WorkshopPickPartsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopPickPartsService,
        workshopPrismaProvider,
        workshopLedgerProvider,
        workshopTenantProvider,
        workshopSiteProvider,
      ],
    }).compile();

    service = module.get(WorkshopPickPartsService);
    resetWorkshopMocks();
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockPrisma.catalogItem.findMany.mockResolvedValue([
      { id: 'item-1', sku: 'SKU-1' },
    ]);
    mockPrisma.inventoryStock.findMany.mockResolvedValue([]);
    mockPrisma.inventoryTransaction.findMany.mockResolvedValue([]);
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 1 });
  });
  it('rejects pick-parts when workshop order status is not eligible', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      site_id: 'site-1',
      status: WorkshopOrderStatus.COMPLETED,
      order_number: 'WO-2026-0001',
    });

    await expect(
      service.pickParts('wo-1', {
        destinationLocationId: 'dest-1',
        items: [
          {
            workshopTaskLineItemId: 'line-1',
            quantity: 1,
          },
        ],
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects cancelled workshop lines before reservation or ledger side effects', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      site_id: 'site-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      staging_location_id: null,
    });
    mockPrisma.storageLocation.findFirst.mockResolvedValue({
      id: 'tote-1',
      type: 'staging_tote',
      deletedAt: null,
      site_id: 'site-1',
    });
    const cancelledLine = {
      id: 'line-1',
      workshop_task_id: 'task-1',
      catalog_item_id: 'item-1',
      quantity: new Prisma.Decimal(2),
      part_execution_status: WorkshopPartLineExecutionStatus.CANCELLED,
    };
    mockPrisma.workshopTaskLineItem.findMany.mockImplementation(
      async ({ where }) => (where.part_execution_status ? [] : [cancelledLine]),
    );
    mockPrisma.partsReservation.findMany.mockResolvedValue([
      {
        id: 'reservation-1',
        workshop_task_line_item_id: 'line-1',
        quantity: new Prisma.Decimal(2),
        quantity_received: new Prisma.Decimal(0),
        quantity_staged: new Prisma.Decimal(0),
        quantity_consumed: new Prisma.Decimal(0),
        quantity_returned: new Prisma.Decimal(0),
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: 'bin-a',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    mockPrisma.storageLocation.findMany.mockResolvedValue([
      { id: 'bin-a', type: 'bin', deletedAt: null, site_id: 'site-1' },
    ]);
    mockPrisma.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        catalog_item_id: 'item-1',
        location_id: 'bin-a',
        quantity_on_hand: new Prisma.Decimal(2),
        quantity_reserved: new Prisma.Decimal(2),
      },
    ]);
    mockPrisma.partsReservation.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.pickParts('wo-1', {
        destinationLocationId: 'tote-1',
        items: [{ workshopTaskLineItemId: 'line-1', quantity: 1 }],
      }),
    ).rejects.toThrow(NotFoundException);

    expect(mockPrisma.workshopTaskLineItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          part_execution_status: {
            not: WorkshopPartLineExecutionStatus.CANCELLED,
          },
        }),
      }),
    );
    expect(mockPrisma.partsReservation.findMany).not.toHaveBeenCalled();
    expect(mockLedgerService.recordTransactions).not.toHaveBeenCalled();
  });

  it('rejects a tote pick when the order belongs to another site', async () => {
    mockSiteContext.getSiteId.mockResolvedValueOnce('site-2');
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      site_id: 'site-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      order_number: 'WO-2026-0001',
    });

    await expect(
      service.pickParts('wo-1', {
        destinationLocationId: 'tote-1',
        items: [
          {
            workshopTaskLineItemId: 'line-1',
            quantity: 1,
          },
        ],
      }),
    ).rejects.toThrow(NotFoundException);

    expect(mockPrisma.workshopOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ site_id: 'site-2' }),
      }),
    );
    expect(mockPrisma.storageLocation.findFirst).not.toHaveBeenCalled();
  });

  it('allocates from multiple source bins and records paired ledger transfers', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      site_id: 'site-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      order_number: 'WO-2026-0001',
    });
    mockPrisma.storageLocation.findFirst.mockResolvedValue({
      id: 'tote-1',
      type: 'staging_tote',
      deletedAt: null,
      site_id: 'site-1',
    });
    mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        id: 'line-1',
        workshop_task_id: 'task-1',
        item_no: 'SKU-1',
        catalog_item_id: 'item-1',
        quantity: new Prisma.Decimal(4),
      },
    ]);
    mockPrisma.partsReservation.findMany.mockResolvedValue([
      {
        id: 'reservation-1',
        workshop_task_line_item_id: 'line-1',
        quantity: new Prisma.Decimal(4),
        quantity_received: new Prisma.Decimal(0),
        quantity_staged: new Prisma.Decimal(0),
        quantity_consumed: new Prisma.Decimal(0),
        quantity_returned: new Prisma.Decimal(0),
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: 'bin-a',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    mockPrisma.storageLocation.findMany.mockResolvedValue([
      { id: 'bin-a', type: 'bin', deletedAt: null, site_id: 'site-1' },
    ]);
    mockPrisma.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        catalog_item_id: 'item-1',
        location_id: 'bin-a',
        quantity_on_hand: new Prisma.Decimal(4),
        quantity_reserved: new Prisma.Decimal(4),
      },
    ]);
    mockPrisma.inventoryTransaction.findMany.mockResolvedValue([
      {
        item_id: 'item-1',
        location_id: 'bin-a',
        cost_basis: new Prisma.Decimal('12.50'),
      },
    ]);
    mockPrisma.partsReservation.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.pickParts('wo-1', {
      destinationLocationId: 'tote-1',
      items: [
        {
          workshopTaskLineItemId: 'line-1',
          quantity: 4,
        },
      ],
    });

    expect(mockLedgerService.recordTransactions).toHaveBeenCalledTimes(1);
    expect(mockLedgerService.recordTransactions.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: 'item-1',
          locationId: 'bin-a',
          quantity: new Prisma.Decimal(-4),
          type: TransactionType.TRANSFER_OUT,
          partsReservationId: 'reservation-1',
          costBasis: new Prisma.Decimal('12.50'),
        }),
        expect.objectContaining({
          itemId: 'item-1',
          locationId: 'tote-1',
          quantity: new Prisma.Decimal(4),
          type: TransactionType.TRANSFER_IN,
          partsReservationId: 'reservation-1',
          costBasis: new Prisma.Decimal('12.50'),
        }),
      ]),
    );
    expect(mockPrisma.partsReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'reservation-1' }),
        data: expect.objectContaining({
          quantity_received: { increment: new Prisma.Decimal(4) },
          quantity_staged: { increment: new Prisma.Decimal(4) },
          tote_cost_basis: new Prisma.Decimal('12.50'),
        }),
      }),
    );
    expect(mockPrisma.workshopOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'wo-1',
          status: {
            in: [WorkshopOrderStatus.INTAKE, WorkshopOrderStatus.IN_PROGRESS],
          },
        }),
        data: {
          staging_location_id: 'tote-1',
        },
      }),
    );
  });

  it('does not overcommit the same source bin across same-SKU lines in one request', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      site_id: 'site-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      order_number: 'WO-2026-0001',
    });
    mockPrisma.storageLocation.findFirst.mockResolvedValue({
      id: 'tote-1',
      type: 'staging_tote',
      deletedAt: null,
      site_id: 'site-1',
    });
    mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        id: 'line-1',
        workshop_task_id: 'task-1',
        item_no: 'SKU-1',
        catalog_item_id: 'item-1',
        quantity: new Prisma.Decimal(1),
      },
      {
        id: 'line-2',
        workshop_task_id: 'task-1',
        item_no: 'SKU-1',
        catalog_item_id: 'item-1',
        quantity: new Prisma.Decimal(1),
      },
    ]);
    mockPrisma.partsReservation.findMany.mockResolvedValue([
      {
        id: 'reservation-1',
        workshop_task_line_item_id: 'line-1',
        quantity: new Prisma.Decimal(1),
        quantity_received: new Prisma.Decimal(0),
        quantity_staged: new Prisma.Decimal(0),
        quantity_consumed: new Prisma.Decimal(0),
        quantity_returned: new Prisma.Decimal(0),
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: 'bin-a',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'reservation-2',
        workshop_task_line_item_id: 'line-2',
        quantity: new Prisma.Decimal(1),
        quantity_received: new Prisma.Decimal(0),
        quantity_staged: new Prisma.Decimal(0),
        quantity_consumed: new Prisma.Decimal(0),
        quantity_returned: new Prisma.Decimal(0),
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: 'bin-b',
        createdAt: new Date('2026-01-01T00:00:01Z'),
      },
    ]);
    mockPrisma.storageLocation.findMany.mockResolvedValue([
      { id: 'bin-a', type: 'bin', deletedAt: null, site_id: 'site-1' },
      { id: 'bin-b', type: 'bin', deletedAt: null, site_id: 'site-1' },
    ]);
    mockPrisma.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        catalog_item_id: 'item-1',
        location_id: 'bin-a',
        quantity_on_hand: new Prisma.Decimal(1),
        quantity_reserved: new Prisma.Decimal(1),
      },
      {
        id: 'stock-2',
        catalog_item_id: 'item-1',
        location_id: 'bin-b',
        quantity_on_hand: new Prisma.Decimal(1),
        quantity_reserved: new Prisma.Decimal(1),
      },
    ]);
    mockPrisma.inventoryTransaction.findMany.mockResolvedValue([
      { item_id: 'item-1', location_id: 'bin-a', cost_basis: null },
    ]);
    mockPrisma.partsReservation.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.pickParts('wo-1', {
      destinationLocationId: 'tote-1',
      items: [
        {
          workshopTaskLineItemId: 'line-1',
          quantity: 1,
          sourceLocationId: 'bin-a',
        },
        {
          workshopTaskLineItemId: 'line-2',
          quantity: 1,
          sourceLocationId: 'bin-b',
        },
      ],
    });

    expect(mockLedgerService.recordTransactions).toHaveBeenCalledTimes(1);
    const recordedTransactions =
      mockLedgerService.recordTransactions.mock.calls[0]?.[0] ?? [];
    const transferOutTransactions = recordedTransactions.filter(
      (transaction: any) => transaction.type === TransactionType.TRANSFER_OUT,
    );

    expect(transferOutTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locationId: 'bin-a',
          quantity: new Prisma.Decimal(-1),
        }),
        expect.objectContaining({
          locationId: 'bin-b',
          quantity: new Prisma.Decimal(-1),
        }),
      ]),
    );
  });

  it('rejects pick execution without a persisted OPEN ON_HAND reservation', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      site_id: 'site-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      staging_location_id: null,
    });
    mockPrisma.storageLocation.findFirst.mockResolvedValue({
      id: 'tote-1',
      type: 'staging_tote',
      deletedAt: null,
      site_id: 'site-1',
    });
    mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        id: 'line-1',
        workshop_task_id: 'task-1',
        item_no: 'SKU-1',
        catalog_item_id: 'item-1',
        quantity: new Prisma.Decimal(1),
      },
    ]);
    mockPrisma.partsReservation.findMany.mockResolvedValue([]);

    await expect(
      service.pickParts('wo-1', {
        destinationLocationId: 'tote-1',
        items: [{ workshopTaskLineItemId: 'line-1', quantity: 1 }],
      }),
    ).rejects.toThrow(/OPEN ON_HAND reservation/);

    expect(mockLedgerService.recordTransactions).not.toHaveBeenCalled();
  });

  it('rejects source reservations outside the active site before ledger writes', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      site_id: 'site-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      staging_location_id: null,
    });
    mockPrisma.storageLocation.findFirst.mockResolvedValue({
      id: 'tote-1',
      type: 'staging_tote',
      deletedAt: null,
      site_id: 'site-1',
    });
    mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        id: 'line-1',
        workshop_task_id: 'task-1',
        item_no: 'SKU-1',
        catalog_item_id: 'item-1',
        quantity: new Prisma.Decimal(1),
      },
    ]);
    mockPrisma.partsReservation.findMany.mockResolvedValue([
      {
        id: 'reservation-1',
        workshop_task_line_item_id: 'line-1',
        quantity: new Prisma.Decimal(1),
        quantity_received: new Prisma.Decimal(0),
        quantity_staged: new Prisma.Decimal(0),
        quantity_consumed: new Prisma.Decimal(0),
        quantity_returned: new Prisma.Decimal(0),
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: 'foreign-bin',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    mockPrisma.storageLocation.findMany.mockResolvedValue([]);

    await expect(
      service.pickParts('wo-1', {
        destinationLocationId: 'tote-1',
        items: [{ workshopTaskLineItemId: 'line-1', quantity: 1 }],
      }),
    ).rejects.toThrow(/source location/i);

    expect(mockLedgerService.recordTransactions).not.toHaveBeenCalled();
  });

  it('does not clamp a pick request beyond persisted reservation ATP', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      site_id: 'site-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      staging_location_id: null,
    });
    mockPrisma.storageLocation.findFirst.mockResolvedValue({
      id: 'tote-1',
      type: 'staging_tote',
      deletedAt: null,
      site_id: 'site-1',
    });
    mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        id: 'line-1',
        workshop_task_id: 'task-1',
        item_no: 'SKU-1',
        catalog_item_id: 'item-1',
        quantity: new Prisma.Decimal(2),
      },
    ]);
    mockPrisma.partsReservation.findMany.mockResolvedValue([
      {
        id: 'reservation-1',
        workshop_task_line_item_id: 'line-1',
        quantity: new Prisma.Decimal(1),
        quantity_received: new Prisma.Decimal(0),
        quantity_staged: new Prisma.Decimal(0),
        quantity_consumed: new Prisma.Decimal(0),
        quantity_returned: new Prisma.Decimal(0),
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: 'bin-a',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    await expect(
      service.pickParts('wo-1', {
        destinationLocationId: 'tote-1',
        items: [{ workshopTaskLineItemId: 'line-1', quantity: 2 }],
      }),
    ).rejects.toThrow(/reservation quantity/i);

    expect(mockLedgerService.recordTransactions).not.toHaveBeenCalled();
    expect(mockPrisma.partsReservation.updateMany).not.toHaveBeenCalled();
  });

  it('orders inbound cost by createdAt and seq and freezes a null first snapshot', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      site_id: 'site-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      staging_location_id: null,
    });
    mockPrisma.storageLocation.findFirst.mockResolvedValue({
      id: 'tote-1',
      type: 'staging_tote',
      deletedAt: null,
      site_id: 'site-1',
    });
    mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        id: 'line-1',
        workshop_task_id: 'task-1',
        item_no: 'SKU-1',
        catalog_item_id: 'item-1',
        quantity: new Prisma.Decimal(1),
      },
    ]);
    mockPrisma.partsReservation.findMany.mockResolvedValue([
      {
        id: 'reservation-1',
        workshop_task_line_item_id: 'line-1',
        quantity: new Prisma.Decimal(1),
        quantity_received: new Prisma.Decimal(0),
        quantity_staged: new Prisma.Decimal(0),
        quantity_consumed: new Prisma.Decimal(0),
        quantity_returned: new Prisma.Decimal(0),
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: 'bin-a',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    mockPrisma.storageLocation.findMany.mockResolvedValue([
      { id: 'bin-a', type: 'bin', deletedAt: null, site_id: 'site-1' },
    ]);
    mockPrisma.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        catalog_item_id: 'item-1',
        location_id: 'bin-a',
        quantity_on_hand: new Prisma.Decimal(1),
        quantity_reserved: new Prisma.Decimal(1),
      },
    ]);
    mockPrisma.inventoryTransaction.findMany.mockResolvedValue([
      {
        item_id: 'item-1',
        location_id: 'bin-a',
        cost_basis: null,
        createdAt: new Date('2026-01-02T00:00:00Z'),
        seq: 2,
      },
      {
        item_id: 'item-1',
        location_id: 'bin-a',
        cost_basis: new Prisma.Decimal('7.50'),
        createdAt: new Date('2026-01-02T00:00:00Z'),
        seq: 1,
      },
      {
        item_id: 'item-1',
        location_id: 'bin-a',
        cost_basis: new Prisma.Decimal('99.00'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        seq: 99,
      },
    ]);
    mockPrisma.partsReservation.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.pickParts('wo-1', {
      destinationLocationId: 'tote-1',
      items: [{ workshopTaskLineItemId: 'line-1', quantity: 1 }],
    });

    expect(mockPrisma.inventoryTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }],
      }),
    );
    expect(mockPrisma.partsReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tote_cost_basis: null }),
      }),
    );
  });

  it('preserves the first tote cost basis when staging a later received slice', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      site_id: 'site-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      staging_location_id: null,
    });
    mockPrisma.storageLocation.findFirst.mockResolvedValue({
      id: 'tote-1',
      type: 'staging_tote',
      deletedAt: null,
      site_id: 'site-1',
    });
    mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        id: 'line-1',
        workshop_task_id: 'task-1',
        item_no: 'SKU-1',
        catalog_item_id: 'item-1',
        quantity: new Prisma.Decimal(2),
      },
    ]);
    mockPrisma.partsReservation.findMany.mockResolvedValue([
      {
        id: 'reservation-1',
        workshop_task_line_item_id: 'line-1',
        quantity: new Prisma.Decimal(2),
        quantity_received: new Prisma.Decimal(1),
        quantity_staged: new Prisma.Decimal(1),
        quantity_consumed: new Prisma.Decimal(0),
        quantity_returned: new Prisma.Decimal(0),
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: 'bin-a',
        tote_cost_basis: new Prisma.Decimal('12.50'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    mockPrisma.storageLocation.findMany.mockResolvedValue([
      { id: 'bin-a', type: 'bin', deletedAt: null, site_id: 'site-1' },
    ]);
    mockPrisma.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        catalog_item_id: 'item-1',
        location_id: 'bin-a',
        quantity_on_hand: new Prisma.Decimal(1),
        quantity_reserved: new Prisma.Decimal(1),
      },
    ]);
    mockPrisma.partsReservation.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.pickParts('wo-1', {
      destinationLocationId: 'tote-1',
      items: [{ workshopTaskLineItemId: 'line-1', quantity: 1 }],
    });

    expect(mockPrisma.inventoryTransaction.findMany).not.toHaveBeenCalled();
    expect(mockLedgerService.recordTransactions.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partsReservationId: 'reservation-1',
          costBasis: new Prisma.Decimal('12.50'),
        }),
      ]),
    );
    expect(mockPrisma.partsReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          tote_cost_basis: expect.anything(),
        }),
      }),
    );
  });
});
