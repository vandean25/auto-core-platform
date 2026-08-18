import { UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopPickPartsService } from './workshop-pick-parts.service';
import {
  mockLedgerService,
  mockPrisma,
  resetWorkshopMocks,
  workshopLedgerProvider,
  workshopPrismaProvider,
  workshopTenantProvider,
  TransactionType,
  WorkshopOrderStatus,
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
      ],
    }).compile();

    service = module.get(WorkshopPickPartsService);
    resetWorkshopMocks();
  });
  it('rejects pick-parts when workshop order status is not eligible', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
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

  it('allocates from multiple source bins and records paired ledger transfers', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      order_number: 'WO-2026-0001',
    });
    mockPrisma.storageLocation.findFirst.mockResolvedValue({
      id: 'tote-1',
      type: 'staging_tote',
      deletedAt: null,
    });
    mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        id: 'line-1',
        item_no: 'SKU-1',
      },
    ]);
    mockPrisma.catalogItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        sku: 'SKU-1',
      },
    ]);
    mockPrisma.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        location_id: 'bin-a',
        quantity_on_hand: 2,
      },
      {
        id: 'stock-2',
        location_id: 'bin-b',
        quantity_on_hand: 3,
      },
    ]);
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
      status: WorkshopOrderStatus.IN_PROGRESS,
      order_number: 'WO-2026-0001',
    });
    mockPrisma.storageLocation.findFirst.mockResolvedValue({
      id: 'tote-1',
      type: 'staging_tote',
      deletedAt: null,
    });
    mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        id: 'line-1',
        item_no: 'SKU-1',
      },
      {
        id: 'line-2',
        item_no: 'SKU-1',
      },
    ]);
    mockPrisma.catalogItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        sku: 'SKU-1',
      },
    ]);
    mockPrisma.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        location_id: 'bin-a',
        quantity_on_hand: 1,
      },
      {
        id: 'stock-2',
        location_id: 'bin-b',
        quantity_on_hand: 1,
      },
    ]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.pickParts('wo-1', {
      destinationLocationId: 'tote-1',
      items: [
        {
          workshopTaskLineItemId: 'line-1',
          quantity: 1,
        },
        {
          workshopTaskLineItemId: 'line-2',
          quantity: 1,
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
          quantity: -1,
        }),
        expect.objectContaining({
          locationId: 'bin-b',
          quantity: -1,
        }),
      ]),
    );
  });
});
