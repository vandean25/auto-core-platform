import { LocationType } from '@prisma/client';
import { LedgerService } from '../inventory/ledger.service.js';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import {
  buildStockTransferService,
  buildTransactionClient,
  buildTransfer,
  fromSiteId,
  itemId,
  sourceBinId,
  tenantId,
  toSiteId,
  transferId,
  userId,
} from './stock-transfer.service.spec.support.js';

/**
 * Locks public create payload shape and AUT-466 regression paths before/after the service split.
 */
describe('StockTransferService characterization', () => {
  const tenantContext = {
    getTenantId: jest.fn(),
    getAuthenticatedUser: jest.fn(),
  };
  const ledgerService = { recordTransactions: jest.fn() } as unknown as Pick<
    LedgerService,
    'recordTransactions'
  >;
  const realtimeService = {
    emitStockTransferUpdated: jest.fn(),
  } as unknown as Pick<DashboardRealtimeService, 'emitStockTransferUpdated'>;

  let prisma: ReturnType<typeof buildTransactionClient> & {
    $transaction: jest.Mock;
  };
  let tx: ReturnType<typeof buildTransactionClient>;
  let service: ReturnType<typeof buildStockTransferService>;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = buildTransactionClient();
    prisma = Object.assign(buildTransactionClient(), {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    });

    tenantContext.getTenantId.mockResolvedValue(tenantId);
    tenantContext.getAuthenticatedUser.mockReturnValue({
      userId: 'firebase-1',
      email: 'clerk@example.com',
      tenantId,
      role: 'SALES',
    });

    prisma.user.findFirst.mockResolvedValue({ id: userId });
    prisma.siteMembership.findMany.mockResolvedValue([
      {
        site_id: fromSiteId,
        tenantMember: { role: 'SALES' },
        user: { firebaseUid: 'firebase-1' },
      },
      {
        site_id: toSiteId,
        tenantMember: { role: 'SALES' },
        user: { firebaseUid: 'firebase-1' },
      },
    ]);

    tx.site.findMany.mockResolvedValue([
      { id: fromSiteId, is_active: true, legal_entity_id: 'gmbh-1' },
      { id: toSiteId, is_active: true, legal_entity_id: 'gmbh-1' },
    ]);
    tx.financeSettings.upsert.mockResolvedValue({});
    tx.financeSettings.update.mockResolvedValue({
      next_stock_transfer_number: 2,
      stock_transfer_prefix: 'TR-2026-',
    });
    tx.stockTransfer.create.mockResolvedValue(buildTransfer());

    service = buildStockTransferService(
      prisma,
      tenantContext,
      ledgerService,
      realtimeService,
    );
  });

  // AUT-466: nested line create must not repeat composite-relation columns.
  it.each([
    {
      direction: 'from -> to',
      fromId: fromSiteId,
      toId: toSiteId,
      sourceLocationId: undefined,
    },
    {
      direction: 'to -> from',
      fromId: toSiteId,
      toId: fromSiteId,
      sourceLocationId: undefined,
    },
    {
      direction: 'from -> to with a source bin',
      fromId: fromSiteId,
      toId: toSiteId,
      sourceLocationId: sourceBinId,
    },
    {
      direction: 'to -> from with a source bin',
      fromId: toSiteId,
      toId: fromSiteId,
      sourceLocationId: sourceBinId,
    },
  ])(
    'create nests only item, quantity and optional bin under the transfer ($direction)',
    async ({ fromId, toId, sourceLocationId }) => {
      tx.catalogItem.findMany.mockResolvedValue([{ id: itemId }]);
      tx.storageLocation.findMany.mockResolvedValue([
        {
          id: sourceBinId,
          site_id: fromId,
          type: LocationType.bin,
          deletedAt: null,
        },
      ]);

      await service.create({
        fromSiteId: fromId,
        toSiteId: toId,
        lines: [
          {
            catalogItemId: itemId,
            requestedQty: 2,
            ...(sourceLocationId ? { sourceLocationId } : {}),
          },
        ],
      });

      expect(tx.stockTransfer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            from_site_id: fromId,
            to_site_id: toId,
            lines: {
              create: [
                {
                  catalog_item_id: itemId,
                  requested_qty: 2,
                  ...(sourceLocationId
                    ? { source_location_id: sourceLocationId }
                    : {}),
                },
              ],
            },
          }),
        }),
      );
    },
  );
});
