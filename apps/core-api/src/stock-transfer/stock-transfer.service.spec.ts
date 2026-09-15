import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ConflictException,
  ForbiddenException,
  Logger,
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
import {
  ApproveStockTransferDto,
  ReceiveStockTransferDto,
  ReturnStockTransferDto,
  ShipStockTransferDto,
} from './dto/stock-transfer.dto';

const tenantId = 'tenant-1';
const userId = 'user-1';
const fromSiteId = 'site-from';
const toSiteId = 'site-to';
const thirdSiteId = 'site-third';
const transferId = 'transfer-1';
const itemId = 'item-1';
const sourceBinId = 'bin-1';
const destBinId = 'bin-2';
const transitLocationId = 'transit-1';
const validationLineId = '550e8400-e29b-41d4-a716-446655440000';
const validationLocationId = '550e8400-e29b-41d4-a716-446655440001';

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
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    inventoryTransaction: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
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
    prisma.stockTransfer.findFirst.mockResolvedValue(buildTransfer());
    prisma.stockTransferCommand.findFirst.mockResolvedValue(null);
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
    tx.financeSettings.update.mockResolvedValue({
      next_stock_transfer_number: 2,
      stock_transfer_prefix: 'TR-2026-',
    });
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
    tx.catalogItem.findMany.mockResolvedValue([
      { id: itemId, cost_price: decimal('12.50') },
    ]);
    tx.inventoryTransaction.findMany.mockResolvedValue([]);
    tx.stockTransferLine.updateMany.mockResolvedValue({ count: 1 });
    tx.stockTransfer.updateMany.mockResolvedValue({ count: 1 });

    (ledgerService.recordTransactions as jest.Mock).mockResolvedValue(
      undefined,
    );
    realtimeService.emitStockTransferUpdated.mockReturnValue(undefined);

    service = new StockTransferService(
      prisma,
      tenantContext,
      ledgerService as never,
      realtimeService as never,
    );
  });

  describe('commit boundary', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    function prepareAction(action: string) {
      prisma.siteMembership.findMany.mockResolvedValue([
        {
          site_id: fromSiteId,
          tenantMember: { role: 'OWNER' },
          user: { firebaseUid: 'firebase-1' },
        },
        {
          site_id: toSiteId,
          tenantMember: { role: 'OWNER' },
          user: { firebaseUid: 'firebase-2' },
        },
      ]);
      const line = buildLine({
        approved_qty: decimal('5'),
        shipped_qty: decimal('5'),
        source_location_id: sourceBinId,
      });
      const status =
        action === 'ship'
          ? StockTransferStatus.APPROVED
          : action === 'receive' || action === 'return'
            ? StockTransferStatus.SHIPPED
            : StockTransferStatus.REQUESTED;
      tx.stockTransfer.findFirst.mockResolvedValue(
        buildTransfer({ status, lines: [line] }),
      );
      tx.stockTransfer.create.mockResolvedValue(buildTransfer());
      tx.stockTransferLine.findMany.mockResolvedValue([line]);
      tx.storageLocation.findMany.mockImplementation(({ where }) =>
        Promise.resolve(
          where.id.in.map((id: string) => ({
            id,
            site_id: id === destBinId ? toSiteId : fromSiteId,
            type: LocationType.bin,
            deletedAt: null,
          })),
        ),
      );
      tx.inventoryStock.findMany.mockResolvedValue([{ id: 'stock-1' }]);
      tx.$queryRaw.mockResolvedValue([
        {
          id: 'stock-1',
          catalog_item_id: itemId,
          location_id: sourceBinId,
          quantity_on_hand: decimal('10'),
          quantity_reserved: decimal('0'),
        },
      ]);

      const version = { expectedVersion: 1 };
      const actions = {
        create: () =>
          service.create({
            fromSiteId,
            toSiteId,
            lines: [{ catalogItemId: itemId, requestedQty: 5 }],
          }),
        approve: () => service.approve(transferId, version),
        reject: () => service.reject(transferId, version),
        cancel: () => service.cancel(transferId, version),
        ship: () =>
          service.ship(transferId, { ...version, lines: [{ id: 'line-1' }] }),
        receive: () =>
          service.receive(transferId, {
            ...version,
            idempotencyKey: 'commit-key',
            lines: [{ id: 'line-1', receiveQty: 1, destLocationId: destBinId }],
          }),
        return: () =>
          service.returnTransfer(transferId, {
            ...version,
            idempotencyKey: 'commit-key',
            lines: [{ id: 'line-1', returnQty: 1 }],
          }),
      };
      return actions[action as keyof typeof actions];
    }

    it.each([
      ['create', 'recipient lookup'],
      ['create', 'emission'],
      ['receive', 'recipient lookup'],
      ['receive', 'emission'],
    ])(
      '%s returns its committed response when post-commit %s fails',
      async (action, failurePoint) => {
        const invoke = prepareAction(action);
        const failure = new Error('Notification unavailable');
        const warning = jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);
        prisma.$transaction.mockImplementation(async (callback) => {
          const committed = await callback(tx);
          if (failurePoint === 'recipient lookup') {
            prisma.siteMembership.findMany.mockRejectedValue(failure);
          } else {
            realtimeService.emitStockTransferUpdated.mockImplementation(() => {
              throw failure;
            });
          }
          return committed;
        });

        await expect(invoke()).resolves.toMatchObject({
          id: transferId,
          transferNumber: 'TR-2026-0001',
          status:
            action === 'create'
              ? StockTransferStatus.REQUESTED
              : StockTransferStatus.SHIPPED,
          version: 1,
        });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.stockTransferCommand.findFirst).toHaveBeenCalledTimes(
          action === 'create' ? 0 : 1,
        );
        expect(warning).toHaveBeenCalledWith(
          expect.stringContaining('Notification unavailable'),
        );
      },
    );

    it.each([
      'create',
      'approve',
      'reject',
      'cancel',
      'ship',
      'receive',
      'return',
    ])('%s emits only after commit', async (action) => {
      const invoke = prepareAction(action);
      const events: string[] = [];
      prisma.$transaction.mockImplementation(async (callback) => {
        const result = await callback(tx);
        events.push('commit');
        return result;
      });
      realtimeService.emitStockTransferUpdated.mockImplementation(() => {
        events.push('emit');
      });

      await invoke();

      expect(events).toEqual(['commit', 'emit']);
    });

    it.each([
      'create',
      'approve',
      'reject',
      'cancel',
      'ship',
      'receive',
      'return',
    ])('%s emits nothing when commit fails', async (action) => {
      const invoke = prepareAction(action);
      prisma.$transaction.mockImplementation(async (callback) => {
        await callback(tx);
        throw new Error('Commit failed');
      });

      await expect(invoke()).rejects.toThrow('Commit failed');

      expect(realtimeService.emitStockTransferUpdated).not.toHaveBeenCalled();
    });
  });

  describe.each(['receive', 'return'] as const)(
    '%s replay authorization',
    (action) => {
      const dto = {
        expectedVersion: 1,
        idempotencyKey: 'replay-key',
        lines: [
          {
            id: 'line-1',
            receiveQty: 1,
            returnQty: 1,
            destLocationId: destBinId,
          },
        ],
      };
      const invoke = () =>
        action === 'receive'
          ? service.receive(transferId, dto)
          : service.returnTransfer(transferId, dto);

      it('uses an explicitly tenant-scoped command lookup', async () => {
        const command = {
          request_hash: hashCommandRequest(dto),
          response_body: {
            transfer: serializeStockTransfer(buildTransfer(), {
              includeSourceBin: true,
            }),
          },
        };
        prisma.stockTransferCommand.findUnique.mockRejectedValue(
          new Error('findUnique bypasses tenant isolation'),
        );
        prisma.stockTransferCommand.findFirst.mockResolvedValue(command);

        await expect(invoke()).resolves.toMatchObject({ id: transferId });

        expect(prisma.stockTransferCommand.findFirst).toHaveBeenCalledWith({
          where: {
            tenant_id: tenantId,
            transfer_id: transferId,
            action: action.toUpperCase(),
            idempotency_key: 'replay-key',
          },
        });
      });

      it.each(['matching', 'mismatching', 'missing'])(
        'returns 404 before disclosing a %s command to an outsider',
        async (kind) => {
          prisma.siteMembership.findMany.mockResolvedValue([
            { site_id: thirdSiteId, tenantMember: { role: 'SALES' } },
          ]);
          const command =
            kind === 'missing'
              ? null
              : {
                  request_hash:
                    kind === 'matching' ? hashCommandRequest(dto) : 'different',
                  response_body: {},
                };
          prisma.stockTransferCommand.findUnique.mockResolvedValue(command);
          prisma.stockTransferCommand.findFirst.mockResolvedValue(command);
          tx.stockTransfer.findFirst.mockResolvedValue(buildTransfer());

          await expect(invoke()).rejects.toBeInstanceOf(NotFoundException);

          expect(prisma.stockTransferCommand.findFirst).not.toHaveBeenCalled();
          expect(prisma.stockTransferCommand.findUnique).not.toHaveBeenCalled();
          expect(prisma.$transaction).not.toHaveBeenCalled();
        },
      );

      it('authorizes access again before disclosing a winner hash mismatch', async () => {
        prisma.stockTransfer.findFirst
          .mockResolvedValueOnce(buildTransfer())
          .mockResolvedValue(null);
        const winner = { request_hash: 'different', response_body: {} };
        prisma.stockTransferCommand.findUnique
          .mockResolvedValueOnce(null)
          .mockResolvedValue(winner);
        prisma.stockTransferCommand.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValue(winner);
        prisma.$transaction.mockRejectedValue(
          new ConflictException('Version conflict'),
        );

        await expect(invoke()).rejects.toBeInstanceOf(NotFoundException);
      });
    },
  );

  describe('multiline stock movements', () => {
    function prepareMovement(action: 'ship' | 'receive' | 'return') {
      const lines = [
        buildLine({
          approved_qty: decimal('2'),
          shipped_qty: decimal('2'),
          source_location_id: sourceBinId,
        }),
        buildLine({
          id: 'line-2',
          catalog_item_id: 'item-2',
          approved_qty: decimal('3'),
          shipped_qty: decimal('3'),
          source_location_id: 'source-2',
        }),
        buildLine({
          id: 'line-3',
          approved_qty: decimal('4'),
          shipped_qty: decimal('4'),
          source_location_id: 'source-2',
        }),
      ];
      tx.stockTransfer.findFirst.mockResolvedValue(
        buildTransfer({
          status:
            action === 'ship'
              ? StockTransferStatus.APPROVED
              : StockTransferStatus.SHIPPED,
          lines,
        }),
      );
      tx.stockTransferLine.findMany.mockResolvedValue(lines);
      tx.stockTransferLine.findFirstOrThrow.mockImplementation(({ where }) =>
        Promise.resolve(lines.find((line) => line.id === where.id)),
      );
      const items = [
        { id: itemId, cost_price: decimal('12.50') },
        { id: 'item-2', cost_price: decimal('0') },
      ];
      tx.catalogItem.findMany.mockResolvedValue(items);
      tx.catalogItem.findFirstOrThrow.mockImplementation(({ where }) =>
        Promise.resolve(items.find((item) => item.id === where.id)),
      );
      tx.storageLocation.findMany.mockImplementation(({ where }) =>
        Promise.resolve(
          where.id.in.map((id: string) => ({
            id,
            site_id: id === destBinId ? toSiteId : fromSiteId,
            type: LocationType.bin,
            deletedAt: null,
          })),
        ),
      );
      const stocks = lines.map((line) => ({
        id: `stock-${line.id}`,
        catalog_item_id: line.catalog_item_id,
        location_id: line.source_location_id,
        quantity_on_hand: decimal('20'),
        quantity_reserved: decimal('1'),
      }));
      tx.inventoryStock.findMany.mockResolvedValue(stocks);
      tx.$queryRaw.mockResolvedValue(stocks);
      const shipMovements = [
        {
          item_id: itemId,
          location_id: sourceBinId,
          cost_basis: decimal('10.25'),
          seq: 1,
        },
        {
          item_id: 'item-2',
          location_id: 'source-2',
          cost_basis: decimal('0'),
          seq: 2,
        },
        { item_id: itemId, location_id: 'source-2', cost_basis: null, seq: 3 },
        {
          item_id: itemId,
          location_id: sourceBinId,
          cost_basis: decimal('999'),
          seq: 4,
        },
      ];
      tx.inventoryTransaction.findMany.mockResolvedValue(shipMovements);
      tx.inventoryTransaction.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(
          shipMovements.find(
            (movement) =>
              movement.item_id === where.item_id &&
              movement.location_id === where.location_id,
          ),
        ),
      );

      const version = { expectedVersion: 1, idempotencyKey: 'multiline-key' };
      const actions = {
        ship: () =>
          service.ship(transferId, {
            ...version,
            lines: lines.map((line) => ({ id: line.id })),
          }),
        receive: () =>
          service.receive(transferId, {
            ...version,
            lines: lines.map((line) => ({
              id: line.id,
              receiveQty: 1,
              destLocationId: destBinId,
            })),
          }),
        return: () =>
          service.returnTransfer(transferId, {
            ...version,
            lines: lines.map((line) => ({ id: line.id, returnQty: 1 })),
          }),
      };
      return actions[action];
    }

    it('ships from loaded lines with one catalog cost fetch', async () => {
      await prepareMovement('ship')();

      const [movements] = (ledgerService.recordTransactions as jest.Mock).mock
        .calls[0] as [Array<Record<string, unknown>>];
      expect(
        movements.map(({ itemId, costBasis, quantity }) => ({
          itemId,
          costBasis,
          quantity,
        })),
      ).toEqual([
        { itemId, costBasis: 12.5, quantity: -2 },
        { itemId, costBasis: 12.5, quantity: 2 },
        { itemId: 'item-2', costBasis: 0, quantity: -3 },
        { itemId: 'item-2', costBasis: 0, quantity: 3 },
        { itemId, costBasis: 12.5, quantity: -4 },
        { itemId, costBasis: 12.5, quantity: 4 },
      ]);
      expect(tx.catalogItem.findMany).toHaveBeenCalledWith({
        where: { tenant_id: tenantId, id: { in: [itemId, 'item-2'] } },
        select: { id: true, cost_price: true },
      });
      expect(tx.catalogItem.findMany).toHaveBeenCalledTimes(1);
      expect(tx.stockTransferLine.findFirstOrThrow).not.toHaveBeenCalled();
      expect(tx.catalogItem.findFirstOrThrow).not.toHaveBeenCalled();
    });

    it.each(['receive', 'return'] as const)(
      '%s prefetches historical costs once, keyed by item and source bin',
      async (action) => {
        await prepareMovement(action)();

        const [movements] = (ledgerService.recordTransactions as jest.Mock).mock
          .calls[0] as [Array<Record<string, unknown>>];
        expect(movements.map(({ costBasis }) => costBasis)).toEqual([
          10.25,
          10.25,
          0,
          0,
          null,
          null,
        ]);
        expect(tx.inventoryTransaction.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              tenant_id: tenantId,
              site_id: fromSiteId,
              stock_transfer_id: transferId,
              type: 'TRANSFER_OUT',
            }),
            orderBy: { seq: 'asc' },
          }),
        );
        expect(tx.inventoryTransaction.findMany).toHaveBeenCalledTimes(1);
        expect(tx.inventoryTransaction.findFirst).not.toHaveBeenCalled();
        expect(tx.catalogItem.findMany).not.toHaveBeenCalled();
      },
    );

    it.each(['ship', 'receive', 'return'] as const)(
      '%s dispatches independent guarded line writes together',
      async (action) => {
        const invoke = prepareMovement(action);
        let pending = 0;
        let peakPending = 0;
        tx.stockTransferLine.updateMany.mockImplementation(() => {
          pending += 1;
          peakPending = Math.max(peakPending, pending);
          return new Promise((resolve) =>
            setImmediate(() => {
              pending -= 1;
              resolve({ count: 1 });
            }),
          );
        });

        await invoke();

        expect(peakPending).toBe(3);
      },
    );

    it.each(['ship', 'receive', 'return'] as const)(
      '%s rolls back on a guarded line conflict before ledger writes',
      async (action) => {
        const invoke = prepareMovement(action);
        tx.stockTransferLine.updateMany
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 });

        await expect(invoke()).rejects.toBeInstanceOf(ConflictException);

        expect(ledgerService.recordTransactions).not.toHaveBeenCalled();
        expect(realtimeService.emitStockTransferUpdated).not.toHaveBeenCalled();
      },
    );
  });

  describe('create', () => {
    const createDto = {
      fromSiteId,
      toSiteId,
      lines: [{ catalogItemId: itemId, requestedQty: 5 }],
    };

    it.each(['MOVE-VIE-', 'TR-2025-', ''])(
      'preserves configured prefix %s when allocating a number',
      async (prefix) => {
        tx.catalogItem.findMany.mockResolvedValue([{ id: itemId }]);
        tx.financeSettings.update.mockImplementation(({ data }) =>
          Promise.resolve({
            next_stock_transfer_number: 43,
            stock_transfer_prefix: data.stock_transfer_prefix ?? prefix,
          }),
        );
        tx.stockTransfer.create.mockImplementation(({ data }) =>
          Promise.resolve(
            buildTransfer({ transfer_number: data.transfer_number }),
          ),
        );

        const result = await service.create(createDto);

        expect(result.transferNumber).toBe(`${prefix}0042`);
      },
    );

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
      const requested = buildTransfer({
        status: StockTransferStatus.REQUESTED,
      });
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
      const [recorded, , options] = (
        ledgerService.recordTransactions as jest.Mock
      ).mock.calls[0];
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

    it('ships zero-approved lines with zero quantity, no source bin, and no ledger pair', async () => {
      const zeroApprovedItemId = 'item-zero-approved';
      tx.stockTransfer.findFirst.mockReset();
      tx.stockTransfer.findFirst
        .mockResolvedValueOnce(
          buildTransfer({
            status: StockTransferStatus.APPROVED,
            lines: [
              buildLine({
                approved_qty: decimal('5'),
                source_location_id: null,
              }),
              buildLine({
                id: 'line-zero-approved',
                catalog_item_id: zeroApprovedItemId,
                approved_qty: decimal('0'),
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
                approved_qty: decimal('5'),
                source_location_id: sourceBinId,
              }),
              buildLine({
                id: 'line-zero-approved',
                catalog_item_id: zeroApprovedItemId,
                approved_qty: decimal('0'),
                shipped_qty: decimal('0'),
                source_location_id: null,
              }),
            ],
          }),
        );

      const result = await service.ship(transferId, shipDto);

      expect(result.lines[1]).toMatchObject({
        shippedQty: '0',
        sourceLocationId: null,
      });
      expect(tx.stockTransferLine.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'line-zero-approved' }),
          data: expect.objectContaining({
            shipped_qty: decimal('0'),
            source_location_id: null,
          }),
        }),
      );
      const recorded = (ledgerService.recordTransactions as jest.Mock).mock
        .calls[0][0] as Array<{ itemId: string }>;
      expect(recorded).toHaveLength(2);
      expect(recorded.every((entry) => entry.itemId === itemId)).toBe(true);
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
            buildLine({
              approved_qty: decimal('5'),
              requested_qty: decimal('5'),
            }),
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

    it('rejects duplicate line ids with 422 (ruling 27)', async () => {
      await expect(
        service.ship(transferId, {
          expectedVersion: 1,
          lines: [{ id: 'line-1' }, { id: 'line-1' }],
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
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
      prisma.stockTransferCommand.findFirst.mockResolvedValue({
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

    it('returns 404 instead of replaying to a caller outside both transfer sites', async () => {
      prisma.siteMembership.findMany.mockResolvedValue([
        { site_id: thirdSiteId, tenantMember: { role: 'SALES' } },
      ]);
      prisma.stockTransfer.findFirst.mockResolvedValue({
        from_site_id: fromSiteId,
        to_site_id: toSiteId,
      });
      prisma.stockTransferCommand.findFirst.mockResolvedValue({
        request_hash: hashCommandRequest(receiveDto),
        response_body: {
          transfer: serializeStockTransfer(shippedTransfer(), {
            includeSourceBin: true,
          }),
        },
      });

      await expect(
        service.receive(transferId, receiveDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('redacts source data and does not expose the stored command envelope on destination-only replay', async () => {
      prisma.siteMembership.findMany.mockResolvedValue([
        { site_id: toSiteId, tenantMember: { role: 'SALES' } },
      ]);
      prisma.stockTransfer.findFirst.mockResolvedValue({
        from_site_id: fromSiteId,
        to_site_id: toSiteId,
      });
      prisma.stockTransferCommand.findFirst.mockResolvedValue({
        request_hash: hashCommandRequest(receiveDto),
        response_body: {
          action: 'RECEIVE',
          request: receiveDto,
          transfer: serializeStockTransfer(shippedTransfer(), {
            includeSourceBin: true,
          }),
        },
      });

      const result = await service.receive(transferId, receiveDto);

      expect(result.lines[0].sourceLocationId).toBeNull();
      expect(result).not.toHaveProperty('response_body');
    });

    it.each([
      [
        'an OCC conflict',
        new ConflictException(
          'Transfer changed during receiving. Refresh and retry.',
        ),
      ],
      [
        'a P2002 conflict',
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.10.0',
        }),
      ],
    ])('replays the winner response after %s', async (_label, loserError) => {
      const winnerResponse = serializeStockTransfer(
        buildTransfer({ status: StockTransferStatus.COMPLETED, version: 2 }),
        { includeSourceBin: true },
      );
      prisma.stockTransferCommand.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          request_hash: hashCommandRequest(receiveDto),
          response_body: { transfer: winnerResponse },
        });
      prisma.stockTransfer.findFirst.mockResolvedValue({
        from_site_id: fromSiteId,
        to_site_id: toSiteId,
      });
      prisma.$transaction.mockRejectedValue(loserError);

      await expect(service.receive(transferId, receiveDto)).resolves.toEqual(
        winnerResponse,
      );
    });

    it('keeps the idempotency mismatch conflict after a stale-version loser', async () => {
      prisma.stockTransferCommand.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          request_hash: hashCommandRequest({
            ...receiveDto,
            expectedVersion: 2,
          }),
          response_body: {},
        });
      prisma.$transaction.mockRejectedValue(
        new ConflictException('Version conflict: expected 1, current 2.'),
      );

      await expect(service.receive(transferId, receiveDto)).rejects.toThrow(
        'This idempotency key was already used with a different request body.',
      );
    });

    it('conflicts when the same key is reused with a different body', async () => {
      prisma.stockTransferCommand.findFirst.mockResolvedValue({
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
        lines: [
          { id: 'a', qty: 1 },
          { id: 'b', qty: 2 },
        ],
      });
      const b = hashCommandRequest({
        lines: [
          { id: 'b', qty: 2 },
          { id: 'a', qty: 1 },
        ],
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

describe.each([
  [
    'approve',
    ApproveStockTransferDto,
    [{ id: validationLineId }, { id: validationLineId }],
  ],
  [
    'ship',
    ShipStockTransferDto,
    [{ id: validationLineId }, { id: validationLineId }],
  ],
  [
    'receive',
    ReceiveStockTransferDto,
    [
      {
        id: validationLineId,
        receiveQty: 1,
        destLocationId: validationLocationId,
      },
      {
        id: validationLineId,
        receiveQty: 1,
        destLocationId: validationLocationId,
      },
    ],
  ],
  [
    'return',
    ReturnStockTransferDto,
    [
      { id: validationLineId, returnQty: 1 },
      { id: validationLineId, returnQty: 1 },
    ],
  ],
])('%s command DTO', (_command, DtoClass, lines) => {
  it('rejects duplicate line ids at the validation boundary', async () => {
    const dto = plainToInstance(DtoClass, {
      expectedVersion: 1,
      idempotencyKey: 'validation-key',
      lines,
    });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'lines',
          constraints: expect.objectContaining({
            arrayUnique: expect.any(String),
          }),
        }),
      ]),
    );
  });
});
