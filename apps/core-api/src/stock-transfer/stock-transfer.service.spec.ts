import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LocationType, Prisma, StockTransferStatus } from '@prisma/client';
import { LedgerService } from '../inventory/ledger.service';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';
import { StockTransferService } from './stock-transfer.service';
import {
  hashCommandRequest,
  redactStoredCommandResponse,
  serializeStockTransfer,
} from './stock-transfer-serializer';

const tenantId = 'tenant-1';
const userId = 'user-1';
const fromSiteId = 'site-from';
const toSiteId = 'site-to';
const transferId = 'transfer-1';
const itemId = 'item-1';
const sourceBinId = 'bin-1';
const destBinId = 'bin-2';
const transitLocationId = 'transit-1';

function decimal(value: string) {
  return new Prisma.Decimal(value);
}

function buildLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    tenant_id: tenantId,
    transfer_id: transferId,
    from_site_id: fromSiteId,
    to_site_id: toSiteId,
    catalog_item_id: itemId,
    source_location_id: null,
    dest_location_id: null,
    requested_qty: decimal('5'),
    approved_qty: decimal('0'),
    shipped_qty: decimal('0'),
    received_qty: decimal('0'),
    returned_qty: decimal('0'),
    ...overrides,
  };
}

function buildTransfer(overrides: Record<string, unknown> = {}) {
  return {
    id: transferId,
    tenant_id: tenantId,
    transfer_number: 'TR-2026-0001',
    from_site_id: fromSiteId,
    to_site_id: toSiteId,
    status: StockTransferStatus.REQUESTED,
    version: 1,
    requested_by_user_id: userId,
    approved_by_user_id: null,
    shipped_by_user_id: null,
    received_by_user_id: null,
    reject_reason: null,
    cancel_reason: null,
    createdAt: new Date('2026-09-14T10:00:00.000Z'),
    updatedAt: new Date('2026-09-14T10:00:00.000Z'),
    from_site: { name: 'Wien' },
    to_site: { name: 'Graz' },
    lines: [buildLine()],
    ...overrides,
  };
}

function buildTransactionClient() {
  return {
    $queryRaw: jest.fn(),
    user: {
      findFirst: jest.fn(),
    },
    siteMembership: {
      findMany: jest.fn(),
    },
    site: {
      findMany: jest.fn(),
    },
    stockTransfer: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    stockTransferLine: {
      findMany: jest.fn(),
      findFirstOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    stockTransferCommand: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    inventoryTransaction: {
      findFirst: jest.fn(),
    },
    catalogItem: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
    },
    storageLocation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    inventoryStock: {
      findMany: jest.fn(),
    },
    financeSettings: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('StockTransferService', () => {
  const tenantContext = {
    getTenantId: jest.fn(),
    getAuthenticatedUser: jest.fn(),
  };
  const ledgerService = {
    recordTransactions: jest.fn(),
  } as unknown as Pick<LedgerService, 'recordTransactions'>;
  const realtimeService = {
    emitStockTransferUpdated: jest.fn(),
  } as unknown as Pick<DashboardRealtimeService, 'emitStockTransferUpdated'>;

  let prisma: ReturnType<typeof buildTransactionClient> & {
    $transaction: jest.Mock;
  };
  let tx: ReturnType<typeof buildTransactionClient>;
  let service: StockTransferService;

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

    tx.$queryRaw.mockResolvedValue([]);
    tx.site.findMany.mockResolvedValue([
      { id: fromSiteId, is_active: true, legal_entity_id: 'gmbh-1' },
      { id: toSiteId, is_active: true, legal_entity_id: 'gmbh-1' },
    ]);
    tx.financeSettings.upsert.mockResolvedValue({});
    tx.financeSettings.update.mockResolvedValue({ next_stock_transfer_number: 2 });
    tx.stockTransferCommand.findUnique.mockResolvedValue(null);
    tx.stockTransferCommand.create.mockResolvedValue({});
    tx.storageLocation.findFirst.mockResolvedValue({
      id: transitLocationId,
      site_id: fromSiteId,
      type: LocationType.in_transit,
      is_system: true,
      deletedAt: null,
    });
    tx.stockTransferLine.findFirstOrThrow.mockResolvedValue({
      catalog_item_id: itemId,
      approved_qty: decimal('5'),
    });
    tx.catalogItem.findFirstOrThrow.mockResolvedValue({
      cost_price: decimal('12.50'),
    });
    tx.stockTransferLine.updateMany.mockResolvedValue({ count: 1 });
    tx.stockTransfer.updateMany.mockResolvedValue({ count: 1 });

    (ledgerService.recordTransactions as jest.Mock).mockResolvedValue(undefined);
    realtimeService.emitStockTransferUpdated.mockReturnValue(undefined);

    service = new StockTransferService(
      prisma as never,
      tenantContext as never,
      ledgerService as never,
      realtimeService as never,
    );
  });

  describe('create', () => {
    const createDto = {
      fromSiteId,
      toSiteId,
      lines: [{ catalogItemId: itemId, requestedQty: 5 }],
    };

    it('creates a REQUESTED transfer and assigns a tenant-wide number (ruling 52)', async () => {
      tx.catalogItem.findMany.mockResolvedValue([{ id: itemId }]);
      tx.stockTransfer.create.mockResolvedValue(buildTransfer());

      const result = await service.create(createDto);

      expect(result.status).toBe(StockTransferStatus.REQUESTED);
      expect(result.version).toBe(1);
      expect(tx.financeSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            next_stock_transfer_number: { increment: 1 },
          }),
        }),
      );
      expect(tx.stockTransfer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REQUESTED',
            requested_by_user_id: userId,
          }),
        }),
      );
      expect(realtimeService.emitStockTransferUpdated).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({ action: 'CREATED', fromSiteId, toSiteId }),
      );
    });

    it('rejects transfers between sites of different legal entities with 422 (ruling 25)', async () => {
      tx.site.findMany.mockResolvedValue([
        { id: fromSiteId, is_active: true, legal_entity_id: 'gmbh-1' },
        { id: toSiteId, is_active: true, legal_entity_id: 'gmbh-2' },
      ]);

      await expect(service.create(createDto)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('rejects create when from and to sites are identical', async () => {
      await expect(
        service.create({ ...createDto, toSiteId: fromSiteId }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('a dest-only caller cannot suggest a source bin (ruling 26)', async () => {
      prisma.siteMembership.findMany.mockResolvedValue([
        { site_id: toSiteId, tenantMember: { role: 'SALES' } },
      ]);

      await expect(
        service.create({
          ...createDto,
          lines: [
            {
              catalogItemId: itemId,
              requestedQty: 5,
              sourceLocationId: sourceBinId,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rejects inactive endpoint sites with 422 (ruling 41)', async () => {
      tx.site.findMany.mockResolvedValue([
        { id: fromSiteId, is_active: false, legal_entity_id: 'gmbh-1' },
        { id: toSiteId, is_active: true, legal_entity_id: 'gmbh-1' },
      ]);

      await expect(service.create(createDto)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });

  describe('approve', () => {
    beforeEach(() => {
      prisma.siteMembership.findMany.mockResolvedValue([
        {
          site_id: fromSiteId,
          tenantMember: { role: 'OWNER' },
          user: { firebaseUid: 'firebase-1' },
        },
      ]);
    });

    it('expands omitted lines to approved_qty = requested_qty (ruling 27)', async () => {
      const requested = buildTransfer({ status: StockTransferStatus.REQUESTED });
      tx.stockTransfer.findFirst
        .mockResolvedValueOnce(requested)
        .mockResolvedValueOnce(
          buildTransfer({ status: StockTransferStatus.APPROVED, version: 2 }),
        );

      const result = await service.approve(transferId, { expectedVersion: 1 });

      expect(result.status).toBe(StockTransferStatus.APPROVED);
      expect(tx.stockTransferLine.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ approved_qty: decimal('5') }),
        }),
      );
    });

    it('rejects a stale expectedVersion with 409', async () => {
      tx.stockTransfer.findFirst.mockResolvedValue(
        buildTransfer({ status: StockTransferStatus.REQUESTED }),
      );

      await expect(
        service.approve(transferId, { expectedVersion: 99 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('forbids non-admin from-site members (ruling 32)', async () => {
      prisma.siteMembership.findMany.mockResolvedValue([
        {
          site_id: fromSiteId,
          tenantMember: { role: 'SALES' },
          user: { firebaseUid: 'firebase-1' },
        },
      ]);
      tx.stockTransfer.findFirst.mockResolvedValue(
        buildTransfer({ status: StockTransferStatus.REQUESTED }),
      );

      await expect(
        service.approve(transferId, { expectedVersion: 1 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns 404 when the caller has no membership on either site (ruling 43)', async () => {
      prisma.siteMembership.findMany.mockResolvedValue([]);
      tx.stockTransfer.findFirst.mockResolvedValue(
        buildTransfer({ status: StockTransferStatus.REQUESTED }),
      );
      await expect(
        service.approve(transferId, { expectedVersion: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an approvedQty above the requested quantity with 422', async () => {
      tx.stockTransfer.findFirst.mockResolvedValue(
        buildTransfer({ status: StockTransferStatus.REQUESTED }),
      );

      await expect(
        service.approve(transferId, {
          expectedVersion: 1,
          lines: [{ id: 'line-1', approvedQty: 99 }],
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('ship', () => {
    const shipDto = {
      expectedVersion: 1,
      lines: [{ id: 'line-1', sourceLocationId: sourceBinId }],
    };

    beforeEach(() => {
      const approved = buildTransfer({
        status: StockTransferStatus.APPROVED,
        lines: [
          buildLine({
            requested_qty: decimal('5'),
            approved_qty: decimal('5'),
            source_location_id: null,
          }),
        ],
      });
      const shipped = buildTransfer({
        status: StockTransferStatus.SHIPPED,
        version: 2,
        lines: [
          buildLine({
            approved_qty: decimal('5'),
            shipped_qty: decimal('5'),
            source_location_id: sourceBinId,
          }),
        ],
      });
      tx.stockTransfer.findFirst
        .mockResolvedValueOnce(approved)
        .mockResolvedValue(shipped);
      tx.storageLocation.findMany.mockResolvedValue([
        {
          id: sourceBinId,
          site_id: fromSiteId,
          type: LocationType.bin,
          deletedAt: null,
        },
      ]);
      tx.inventoryStock.findMany.mockResolvedValue([{ id: 'stock-1' }]);
      tx.$queryRaw.mockResolvedValue([
        {
          id: 'stock-1',
          catalog_item_id: itemId,
          location_id: sourceBinId,
          quantity_on_hand: decimal('10'),
          quantity_reserved: decimal('2'),
        },
      ]);
    });

    it('writes one paired ledger movement against the in-transit location (ruling 34)', async () => {
      const result = await service.ship(transferId, shipDto);

      expect(result.status).toBe(StockTransferStatus.SHIPPED);
      expect(ledgerService.recordTransactions).toHaveBeenCalledTimes(1);
      const [recorded, , options] = (ledgerService.recordTransactions as jest.Mock)
        .mock.calls[0];
      expect(recorded).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            locationId: sourceBinId,
            type: 'TRANSFER_OUT',
            quantity: -5,
            stockTransferId: transferId,
          }),
          expect.objectContaining({
            locationId: transitLocationId,
            type: 'TRANSFER_IN',
            quantity: 5,
            stockTransferId: transferId,
          }),
        ]),
      );
      expect(options.allowedLocationTypes.has(LocationType.in_transit)).toBe(
        true,
      );
      expect(options.allowedLocationTypes.has(LocationType.bin)).toBe(true);
      expect(options.allowedLocationTypes.has(LocationType.warehouse)).toBe(
        false,
      );
    });

    it('rejects shipping when on_hand - reserved is insufficient (ruling 33)', async () => {
      tx.$queryRaw.mockResolvedValue([
        {
          id: 'stock-1',
          catalog_item_id: itemId,
          location_id: sourceBinId,
          quantity_on_hand: decimal('4'),
          quantity_reserved: decimal('2'),
        },
      ]);

      await expect(service.ship(transferId, shipDto)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('requires every positive-approved line to be included (ruling 29)', async () => {
      tx.stockTransfer.findFirst.mockReset();
      tx.stockTransfer.findFirst.mockResolvedValue(
        buildTransfer({
          status: StockTransferStatus.APPROVED,
          lines: [
            buildLine({ approved_qty: decimal('5'), requested_qty: decimal('5') }),
            buildLine({
              id: 'line-2',
              approved_qty: decimal('3'),
              requested_qty: decimal('3'),
            }),
          ],
        }),
      );

      await expect(
        service.ship(transferId, {
          expectedVersion: 1,
          lines: [{ id: 'line-1', sourceLocationId: sourceBinId }],
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rejects duplicate line ids with 400 (ruling 27)', async () => {
      await expect(
        service.ship(transferId, {
          expectedVersion: 1,
          lines: [{ id: 'line-1' }, { id: 'line-1' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('receive', () => {
    const receiveDto = {
      expectedVersion: 1,
      idempotencyKey: 'key-1',
      lines: [{ id: 'line-1', receiveQty: 5, destLocationId: destBinId }],
    };

    function shippedTransfer() {
      return buildTransfer({
        status: StockTransferStatus.SHIPPED,
        version: 1,
        lines: [
          buildLine({
            requested_qty: decimal('5'),
            approved_qty: decimal('5'),
            shipped_qty: decimal('5'),
            source_location_id: sourceBinId,
          }),
        ],
      });
    }

    beforeEach(() => {
      const shipped = shippedTransfer();
      const settled = buildTransfer({
        status: StockTransferStatus.COMPLETED,
        version: 2,
        lines: [
          buildLine({
            requested_qty: decimal('5'),
            approved_qty: decimal('5'),
            shipped_qty: decimal('5'),
            received_qty: decimal('5'),
            source_location_id: sourceBinId,
            dest_location_id: destBinId,
          }),
        ],
      });
      tx.stockTransfer.findFirst
        .mockResolvedValueOnce(shipped)
        .mockResolvedValue(settled);
      tx.storageLocation.findMany.mockResolvedValue([
        {
          id: destBinId,
          site_id: toSiteId,
          type: LocationType.bin,
          deletedAt: null,
        },
      ]);
      tx.stockTransferLine.findMany.mockResolvedValue([
        buildLine({
          shipped_qty: decimal('5'),
          received_qty: decimal('5'),
          source_location_id: sourceBinId,
          dest_location_id: destBinId,
        }),
      ]);
      tx.inventoryStock.findMany.mockResolvedValue([]);
    });

    it('receives into the dest bin via the from-site in-transit location (ruling 34/51)', async () => {
      const result = await service.receive(transferId, receiveDto);

      expect(result.status).toBe(StockTransferStatus.COMPLETED);
      const recorded = (ledgerService.recordTransactions as jest.Mock).mock
        .calls[0][0] as Array<Record<string, unknown>>;
      expect(recorded).toHaveLength(2);
      expect(recorded[0]).toMatchObject({
        locationId: transitLocationId,
        type: 'TRANSFER_OUT',
      });
      expect(recorded[1]).toMatchObject({
        locationId: destBinId,
        type: 'TRANSFER_IN',
      });
      expect(tx.stockTransferCommand.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'RECEIVE',
            idempotency_key: 'key-1',
          }),
        }),
      );
    });

    it('replays the stored response for a repeated idempotency key without new ledger writes (ruling 30)', async () => {
      prisma.stockTransfer.findFirst.mockResolvedValue({
        from_site_id: fromSiteId,
        to_site_id: toSiteId,
      });
      prisma.stockTransferCommand.findUnique.mockResolvedValue({
        id: 'command-1',
        tenant_id: tenantId,
        transfer_id: transferId,
        action: 'RECEIVE',
        idempotency_key: 'key-1',
        request_hash: hashCommandRequest(receiveDto),
        response_status: 200,
        response_body: {
          transfer: serializeStockTransfer(shippedTransfer(), {
            includeSourceBin: true,
          }),
        },
        createdAt: new Date(),
      });

      const result = await service.receive(transferId, receiveDto);

      expect(result.id).toBe(transferId);
      expect(ledgerService.recordTransactions).not.toHaveBeenCalled();
    });

    it('conflicts when the same key is reused with a different body', async () => {
      prisma.stockTransferCommand.findUnique.mockResolvedValue({
        id: 'command-1',
        tenant_id: tenantId,
        transfer_id: transferId,
        action: 'RECEIVE',
        idempotency_key: 'key-1',
        request_hash: hashCommandRequest({ different: true }),
        response_status: 200,
        response_body: {},
        createdAt: new Date(),
      });

      await expect(
        service.receive(transferId, receiveDto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('freezes the destination bin: a different later destLocationId is 422 (ruling 31)', async () => {
      const frozen = shippedTransfer();
      tx.stockTransfer.findFirst.mockReset();
      tx.stockTransfer.findFirst
        .mockResolvedValueOnce({
          ...frozen,
          lines: [
            buildLine({
              shipped_qty: decimal('5'),
              source_location_id: sourceBinId,
              dest_location_id: 'bin-frozen',
            }),
          ],
        })
        .mockResolvedValue(frozen);

      await expect(
        service.receive(transferId, {
          ...receiveDto,
          lines: [{ id: 'line-1', receiveQty: 2, destLocationId: destBinId }],
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rejects a receive quantity above the outstanding shipped quantity', async () => {
      const over = shippedTransfer();
      tx.stockTransfer.findFirst.mockReset();
      tx.stockTransfer.findFirst
        .mockResolvedValueOnce(over)
        .mockResolvedValue(over);

      await expect(
        service.receive(transferId, {
          ...receiveDto,
          lines: [{ id: 'line-1', receiveQty: 6, destLocationId: destBinId }],
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('redacts the source bin for a to-site-only receiver (ruling 43)', async () => {
      prisma.siteMembership.findMany.mockResolvedValue([
        {
          site_id: toSiteId,
          tenantMember: { role: 'SALES' },
          user: { firebaseUid: 'firebase-1' },
        },
      ]);
      tx.stockTransfer.findFirst.mockReset();
      tx.stockTransfer.findFirst
        .mockResolvedValueOnce(shippedTransfer())
        .mockResolvedValueOnce(
          buildTransfer({
            status: StockTransferStatus.COMPLETED,
            version: 2,
            lines: [
              buildLine({
                shipped_qty: decimal('5'),
                received_qty: decimal('5'),
                source_location_id: sourceBinId,
                dest_location_id: destBinId,
              }),
            ],
          }),
        );

      const result = await service.receive(transferId, receiveDto);

      expect(result.lines[0].sourceLocationId).toBeNull();
      expect(result.lines[0].destLocationId).toBe(destBinId);
    });

    it('a from-site-only member cannot receive (ruling 32)', async () => {
      prisma.siteMembership.findMany.mockResolvedValue([
        { site_id: fromSiteId, tenantMember: { role: 'ADMIN' } },
      ]);
      tx.stockTransfer.findFirst.mockResolvedValue(shippedTransfer());

      await expect(
        service.receive(transferId, receiveDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('return', () => {
    const returnDto = {
      expectedVersion: 1,
      idempotencyKey: 'key-1',
      lines: [{ id: 'line-1', returnQty: 3 }],
    };

    beforeEach(() => {
      tx.stockTransfer.findFirst
        .mockResolvedValueOnce(
          buildTransfer({
            status: StockTransferStatus.SHIPPED,
            lines: [
              buildLine({
                requested_qty: decimal('5'),
                approved_qty: decimal('5'),
                shipped_qty: decimal('5'),
                source_location_id: sourceBinId,
              }),
            ],
          }),
        )
        .mockResolvedValue(
          buildTransfer({
            status: StockTransferStatus.SHIPPED,
            version: 2,
            lines: [
              buildLine({
                shipped_qty: decimal('5'),
                returned_qty: decimal('2'),
                source_location_id: sourceBinId,
              }),
            ],
          }),
        );
      tx.storageLocation.findMany.mockResolvedValue([
        {
          id: sourceBinId,
          site_id: fromSiteId,
          type: LocationType.bin,
          deletedAt: null,
        },
      ]);
      tx.stockTransferLine.findMany.mockResolvedValue([
        buildLine({ shipped_qty: decimal('5'), returned_qty: decimal('2') }),
      ]);
    });

    it('returns unreceived stock from in-transit back to the original source bin', async () => {
      const result = await service.returnTransfer(transferId, returnDto);

      expect(result.version).toBe(2);
      const recorded = (ledgerService.recordTransactions as jest.Mock).mock
        .calls[0][0] as Array<Record<string, unknown>>;
      expect(recorded[0]).toMatchObject({
        locationId: transitLocationId,
        type: 'TRANSFER_OUT',
      });
      expect(recorded[1]).toMatchObject({
        locationId: sourceBinId,
        type: 'TRANSFER_IN',
      });
    });

    it('allows a from-site OWNER/ADMIN to return (ruling 32)', async () => {
      prisma.siteMembership.findMany.mockResolvedValue([
        {
          site_id: fromSiteId,
          tenantMember: { role: 'OWNER' },
          user: { firebaseUid: 'firebase-1' },
        },
      ]);

      const result = await service.returnTransfer(transferId, returnDto);
      expect(result.version).toBe(2);
    });

    it('forbids a from-site non-admin member', async () => {
      prisma.siteMembership.findMany.mockResolvedValue([
        { site_id: fromSiteId, tenantMember: { role: 'SALES' } },
      ]);

      await expect(
        service.returnTransfer(transferId, returnDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a return quantity above the unreceived quantity', async () => {
      tx.stockTransfer.findFirst.mockReset();
      const over = buildTransfer({
        status: StockTransferStatus.SHIPPED,
        lines: [
          buildLine({
            shipped_qty: decimal('5'),
            received_qty: decimal('3'),
            source_location_id: sourceBinId,
          }),
        ],
      });
      tx.stockTransfer.findFirst
        .mockResolvedValueOnce(over)
        .mockResolvedValue(over);

      await expect(
        service.returnTransfer(transferId, {
          ...returnDto,
          lines: [{ id: 'line-1', returnQty: 3 }],
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('cancel', () => {
    it('the requester can cancel a REQUESTED transfer', async () => {
      tx.stockTransfer.findFirst
        .mockResolvedValueOnce(
          buildTransfer({ status: StockTransferStatus.REQUESTED }),
        )
        .mockResolvedValueOnce(
          buildTransfer({ status: StockTransferStatus.CANCELLED, version: 2 }),
        );

      const result = await service.cancel(transferId, { expectedVersion: 1 });
      expect(result.status).toBe(StockTransferStatus.CANCELLED);
    });

    it('a non-requester without from-admin rights is forbidden', async () => {
      tx.stockTransfer.findFirst
        .mockResolvedValueOnce(
          buildTransfer({
            status: StockTransferStatus.REQUESTED,
            requested_by_user_id: 'someone-else',
          }),
        )
        .mockResolvedValueOnce(
          buildTransfer({ status: StockTransferStatus.REQUESTED }),
        );

      await expect(
        service.cancel(transferId, { expectedVersion: 1 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a SHIPPED transfer cannot be cancelled (ruling 29)', async () => {
      tx.stockTransfer.findFirst
        .mockResolvedValueOnce(
          buildTransfer({ status: StockTransferStatus.SHIPPED }),
        )
        .mockResolvedValueOnce(
          buildTransfer({ status: StockTransferStatus.SHIPPED }),
        );

      await expect(
        service.cancel(transferId, { expectedVersion: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('serializer + hashing', () => {
    it('hashCommandRequest is order-insensitive', () => {
      const a = hashCommandRequest({
        expectedVersion: 1,
        lines: [{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }],
      });
      const b = hashCommandRequest({
        lines: [{ id: 'b', qty: 2 }, { id: 'a', qty: 1 }],
        expectedVersion: 1,
      });
      expect(a).toBe(b);
    });

    it('redactStoredCommandResponse nulls source bins for dest-only callers', () => {
      const stored = serializeStockTransfer(buildTransfer(), {
        includeSourceBin: true,
      });
      const withSource = {
        ...stored,
        lines: [{ ...stored.lines[0], sourceLocationId: sourceBinId }],
      };

      const redacted = redactStoredCommandResponse(withSource, false);

      expect(redacted.lines[0].sourceLocationId).toBeNull();
    });

    it('serializeStockTransfer nulls the source bin without from-site access', () => {
      const transfer = buildTransfer({
        lines: [buildLine({ source_location_id: sourceBinId })],
      });

      const result = serializeStockTransfer(transfer, {
        includeSourceBin: false,
      });

      expect(result.lines[0].sourceLocationId).toBeNull();
      expect(result.fromSiteName).toBe('Wien');
    });
  });
});
