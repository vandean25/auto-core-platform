import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  Prisma,
  StockTransferCommandAction,
  StockTransferStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TenantContextService } from '../common/services/tenant-context.service';
import { chunkedPromiseAll } from '../common/utils/promise.util';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';
import {
  LedgerService,
  RecordTransactionParams,
} from '../inventory/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ApproveStockTransferDto,
  ApproveStockTransferLineDto,
  CancelStockTransferDto,
  CreateStockTransferDto,
  ReceiveStockTransferDto,
  RejectStockTransferDto,
  ReturnStockTransferDto,
  ShipStockTransferDto,
} from './dto/stock-transfer.dto';
import { buildTransferLedgerPair } from './stock-transfer-ledger.helpers';
import {
  hashCommandRequest,
  redactStoredCommandResponse,
  serializeStockTransfer,
  SerializedStockTransfer,
  StockTransferWithSitesAndLines,
} from './stock-transfer-serializer';
import {
  TENANT_ADMIN_ROLES,
  TRANSFER_ENABLED_LOCATION_TYPES,
} from './stock-transfer.constants';

import Decimal = Prisma.Decimal;

const TRANSFER_INCLUDE = {
  from_site: { select: { name: true } },
  to_site: { select: { name: true } },
  lines: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.StockTransferInclude;

interface CallerAccess {
  userId: string;
  tenantId: string;
  accessBySite: Map<string, string>;
  isAdmin: boolean;
}

interface StoredCommandReplay {
  command: {
    request_hash: string;
    response_body: Prisma.JsonValue;
  };
  requestBody: unknown;
  fromAccess: boolean;
}

@Injectable()
export class StockTransferService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    @Inject(LedgerService) private readonly ledgerService: LedgerService,
    private readonly realtimeService: DashboardRealtimeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async list(): Promise<SerializedStockTransfer[]> {
    const access = await this.loadCallerAccess();
    const siteIds = [...access.accessBySite.keys()];
    if (siteIds.length === 0) {
      return [];
    }

    const transfers = await this.prisma.stockTransfer.findMany({
      where: {
        tenant_id: access.tenantId,
        OR: [
          { from_site_id: { in: siteIds } },
          { to_site_id: { in: siteIds } },
        ],
      },
      include: TRANSFER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return transfers.map((transfer) =>
      serializeStockTransfer(transfer, {
        includeSourceBin: access.accessBySite.has(transfer.from_site_id),
      }),
    );
  }

  async detail(id: string): Promise<SerializedStockTransfer> {
    const access = await this.loadCallerAccess();
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, tenant_id: access.tenantId },
      include: TRANSFER_INCLUDE,
    });

    const includeSourceBin =
      !!transfer && access.accessBySite.has(transfer.from_site_id);
    const hasAnyAccess =
      !!transfer &&
      (access.accessBySite.has(transfer.from_site_id) ||
        access.accessBySite.has(transfer.to_site_id));
    if (!transfer || !hasAnyAccess) {
      throw new NotFoundException('Stock transfer not found');
    }
    return serializeStockTransfer(transfer, { includeSourceBin });
  }

  // ---------------------------------------------------------------------------
  // Create (ruling 26)
  // ---------------------------------------------------------------------------

  async create(dto: CreateStockTransferDto): Promise<SerializedStockTransfer> {
    const access = await this.loadCallerAccess();
    if (dto.fromSiteId === dto.toSiteId) {
      throw new UnprocessableEntityException(
        'fromSiteId and toSiteId must differ.',
      );
    }
    const fromAccess = access.accessBySite.has(dto.fromSiteId);
    const toAccess = access.accessBySite.has(dto.toSiteId);
    if (!fromAccess && !toAccess) {
      throw new UnprocessableEntityException(
        'Creating a stock transfer requires an active membership on the from-site or the to-site.',
      );
    }
    if (
      !fromAccess &&
      dto.lines.some((line) => line.sourceLocationId !== undefined)
    ) {
      throw new UnprocessableEntityException(
        'Only callers with from-site membership may suggest a source bin.',
      );
    }

    return this.commitTransfer(access, 'CREATED', async (tx) => {
      const [fromSite, toSite] = await this.lockSites(tx, access.tenantId, [
        dto.fromSiteId,
        dto.toSiteId,
      ]);
      if (fromSite.legal_entity_id !== toSite.legal_entity_id) {
        throw new UnprocessableEntityException(
          'Stock transfers cannot cross legal entities (same-GmbH only).',
        );
      }

      const catalogItemIds = [
        ...new Set(dto.lines.map((l) => l.catalogItemId)),
      ];
      const items = await tx.catalogItem.findMany({
        where: { tenant_id: access.tenantId, id: { in: catalogItemIds } },
        select: { id: true },
      });
      if (items.length !== catalogItemIds.length) {
        throw new BadRequestException(
          'One or more catalog items do not exist in this tenant.',
        );
      }

      const sourceLocationIds = [
        ...new Set(
          dto.lines
            .map((line) => line.sourceLocationId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      await this.assertSourceBinsValid(
        tx,
        access.tenantId,
        dto.fromSiteId,
        sourceLocationIds,
      );

      const transferNumber = await this.generateTransferNumber(tx);
      const transfer = await tx.stockTransfer.create({
        data: {
          tenant_id: access.tenantId,
          transfer_number: transferNumber,
          from_site_id: dto.fromSiteId,
          to_site_id: dto.toSiteId,
          status: StockTransferStatus.REQUESTED,
          version: 1,
          requested_by_user_id: access.userId,
          lines: {
            create: dto.lines.map((line) => ({
              tenant_id: access.tenantId,
              from_site_id: dto.fromSiteId,
              to_site_id: dto.toSiteId,
              catalog_item_id: line.catalogItemId,
              requested_qty: line.requestedQty,
              ...(line.sourceLocationId
                ? { source_location_id: line.sourceLocationId }
                : {}),
            })),
          },
        },
        include: TRANSFER_INCLUDE,
      });

      return transfer;
    });
  }

  // ---------------------------------------------------------------------------
  // Approve / reject / cancel
  // ---------------------------------------------------------------------------

  async approve(
    id: string,
    dto: ApproveStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    const access = await this.loadCallerAccess();
    assertUniqueLineIds(dto.lines?.map((line) => line.id) ?? []);

    return this.commitTransfer(access, 'UPDATED', async (tx) => {
      const transfer = await this.loadTransfer(tx, access.tenantId, id);
      this.assertTransferAccess(access, transfer, {
        requireFrom: true,
        requireAdmin: true,
      });
      if (transfer.status !== StockTransferStatus.REQUESTED) {
        throw new ConflictException(
          `Only REQUESTED transfers can be approved (current: ${transfer.status}).`,
        );
      }
      if (transfer.version !== dto.expectedVersion) {
        throw new ConflictException(
          `Version conflict: expected ${dto.expectedVersion}, current ${transfer.version}.`,
        );
      }
      await this.lockSitesForTransfer(tx, access.tenantId, transfer);

      const linesById = new Map(transfer.lines.map((line) => [line.id, line]));
      const updates: ApproveStockTransferLineDto[] =
        dto.lines === undefined
          ? transfer.lines.map((line) => ({ id: line.id }))
          : dto.lines;

      const sourceLocationIds = [
        ...new Set(
          updates
            .map((update) => update.sourceLocationId)
            .filter((value): value is string => Boolean(value)),
        ),
      ];
      await this.assertSourceBinsValid(
        tx,
        access.tenantId,
        transfer.from_site_id,
        sourceLocationIds,
      );

      for (const update of updates) {
        const line = linesById.get(update.id);
        if (!line) {
          throw new UnprocessableEntityException(
            `Line ${update.id} does not belong to this transfer.`,
          );
        }
        const approvedQty = new Decimal(
          update.approvedQty ?? line.requested_qty.toNumber(),
        );
        if (approvedQty.lt(0) || approvedQty.gt(line.requested_qty)) {
          throw new UnprocessableEntityException(
            `approvedQty must be between 0 and requestedQty for line ${line.id}.`,
          );
        }
        if (
          update.sourceLocationId &&
          line.source_location_id &&
          line.source_location_id !== update.sourceLocationId
        ) {
          throw new UnprocessableEntityException(
            `Source bin for line ${line.id} is already set and cannot be changed.`,
          );
        }
      }

      for (const update of updates) {
        const line = linesById.get(update.id)!;
        const approvedQty = new Decimal(
          update.approvedQty ?? line.requested_qty.toNumber(),
        );
        const result = await tx.stockTransferLine.updateMany({
          where: {
            tenant_id: access.tenantId,
            id: update.id,
            transfer_id: id,
            approved_qty: line.approved_qty,
          },
          data: {
            approved_qty: approvedQty,
            ...(update.sourceLocationId && !line.source_location_id
              ? { source_location_id: update.sourceLocationId }
              : {}),
          },
        });
        if (result.count !== 1) {
          throw new ConflictException(
            `Line ${update.id} changed during approval. Refresh and retry.`,
          );
        }
      }

      const guarded = await tx.stockTransfer.updateMany({
        where: {
          id,
          tenant_id: access.tenantId,
          status: StockTransferStatus.REQUESTED,
          version: dto.expectedVersion,
        },
        data: {
          status: StockTransferStatus.APPROVED,
          version: { increment: 1 },
          approved_by_user_id: access.userId,
        },
      });
      if (guarded.count !== 1) {
        throw new ConflictException(
          'Transfer changed during approval. Refresh and retry.',
        );
      }

      return this.loadTransfer(tx, access.tenantId, id);
    });
  }

  async reject(
    id: string,
    dto: RejectStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    const access = await this.loadCallerAccess();

    return this.commitTransfer(access, 'UPDATED', async (tx) => {
      const transfer = await this.loadTransfer(tx, access.tenantId, id);
      this.assertTransferAccess(access, transfer, {
        requireFrom: true,
        requireAdmin: true,
      });
      if (transfer.status !== StockTransferStatus.REQUESTED) {
        throw new ConflictException(
          `Only REQUESTED transfers can be rejected (current: ${transfer.status}).`,
        );
      }

      const guarded = await tx.stockTransfer.updateMany({
        where: {
          id,
          tenant_id: access.tenantId,
          status: StockTransferStatus.REQUESTED,
          version: dto.expectedVersion,
        },
        data: {
          status: StockTransferStatus.REJECTED,
          version: { increment: 1 },
          reject_reason: dto.reason ?? null,
        },
      });
      if (guarded.count !== 1) {
        throw new ConflictException(
          'Transfer changed during rejection. Refresh and retry.',
        );
      }

      return this.loadTransfer(tx, access.tenantId, id);
    });
  }

  async cancel(
    id: string,
    dto: CancelStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    const access = await this.loadCallerAccess();

    return this.commitTransfer(access, 'UPDATED', async (tx) => {
      const transfer = await this.loadTransfer(tx, access.tenantId, id);
      const { fromAccess } = this.assertTransferAccess(access, transfer, {});
      if (
        transfer.requested_by_user_id !== access.userId &&
        !(fromAccess && access.isAdmin)
      ) {
        throw new ForbiddenException(
          'Only the requester or a from-site OWNER/ADMIN can cancel a transfer.',
        );
      }
      if (
        transfer.status !== StockTransferStatus.REQUESTED &&
        transfer.status !== StockTransferStatus.APPROVED
      ) {
        throw new ConflictException(
          `Only REQUESTED or APPROVED transfers can be cancelled (current: ${transfer.status}).`,
        );
      }

      const guarded = await tx.stockTransfer.updateMany({
        where: {
          id,
          tenant_id: access.tenantId,
          status: { in: ['REQUESTED', 'APPROVED'] },
          version: dto.expectedVersion,
        },
        data: {
          status: StockTransferStatus.CANCELLED,
          version: { increment: 1 },
          cancel_reason: dto.reason ?? null,
        },
      });
      if (guarded.count !== 1) {
        throw new ConflictException(
          'Transfer changed during cancellation. Refresh and retry.',
        );
      }

      return this.loadTransfer(tx, access.tenantId, id);
    });
  }

  // ---------------------------------------------------------------------------
  // Ship (one-shot and full, ruling 29)
  // ---------------------------------------------------------------------------

  async ship(
    id: string,
    dto: ShipStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    const access = await this.loadCallerAccess();
    assertUniqueLineIds(dto.lines.map((line) => line.id));

    return this.commitTransfer(access, 'UPDATED', async (tx) => {
      const transfer = await this.loadTransfer(tx, access.tenantId, id);
      this.assertTransferAccess(access, transfer, {
        requireFrom: true,
      });
      if (transfer.status !== StockTransferStatus.APPROVED) {
        throw new ConflictException(
          `Only APPROVED transfers can be shipped (current: ${transfer.status}).`,
        );
      }
      if (transfer.version !== dto.expectedVersion) {
        throw new ConflictException(
          `Version conflict: expected ${dto.expectedVersion}, current ${transfer.version}.`,
        );
      }
      await this.lockSitesForTransfer(tx, access.tenantId, transfer);

      const linesById = new Map(transfer.lines.map((line) => [line.id, line]));
      const bodyById = new Map(dto.lines.map((line) => [line.id, line]));

      const positiveLines = transfer.lines.filter((line) =>
        line.approved_qty.gt(0),
      );
      if (positiveLines.length === 0) {
        throw new UnprocessableEntityException(
          'At least one line must have approved_qty > 0 to ship.',
        );
      }
      for (const line of positiveLines) {
        if (!bodyById.has(line.id)) {
          throw new UnprocessableEntityException(
            `Line ${line.id} has approved qty and must be included in the ship request.`,
          );
        }
      }

      const sourceLocationIds: string[] = [];
      const frozenSourceByLine = new Map<string, string>();
      for (const [lineId, update] of bodyById) {
        const line = linesById.get(lineId);
        if (!line) {
          throw new UnprocessableEntityException(
            `Line ${lineId} does not belong to this transfer.`,
          );
        }
        if (line.approved_qty.eq(0)) {
          if (update.sourceLocationId) {
            throw new UnprocessableEntityException(
              `Line ${lineId} has no approved qty; a source bin cannot be set.`,
            );
          }
          continue;
        }
        const sourceLocationId =
          update.sourceLocationId ?? line.source_location_id;
        if (!sourceLocationId) {
          throw new UnprocessableEntityException(
            `Line ${lineId} requires sourceLocationId to ship.`,
          );
        }
        if (
          line.source_location_id &&
          update.sourceLocationId &&
          line.source_location_id !== update.sourceLocationId
        ) {
          throw new UnprocessableEntityException(
            `Source bin for line ${lineId} is frozen and cannot be changed.`,
          );
        }
        frozenSourceByLine.set(lineId, sourceLocationId);
        sourceLocationIds.push(sourceLocationId);
      }
      await this.assertSourceBinsValid(
        tx,
        access.tenantId,
        transfer.from_site_id,
        sourceLocationIds,
      );

      await this.assertShipAvailability(
        tx,
        access.tenantId,
        [...frozenSourceByLine.entries()].map(([lineId, locationId]) => {
          const line = linesById.get(lineId)!;
          return {
            itemId: line.catalog_item_id,
            locationId,
            quantity: line.approved_qty,
          };
        }),
      );

      const guarded = await tx.stockTransfer.updateMany({
        where: {
          id,
          tenant_id: access.tenantId,
          status: StockTransferStatus.APPROVED,
          version: dto.expectedVersion,
        },
        data: {
          status: StockTransferStatus.SHIPPED,
          version: { increment: 1 },
          shipped_by_user_id: access.userId,
        },
      });
      if (guarded.count !== 1) {
        throw new ConflictException(
          'Transfer changed during shipping. Refresh and retry.',
        );
      }

      await chunkedPromiseAll(transfer.lines, async (line) => {
        const sourceLocationId = frozenSourceByLine.get(line.id) ?? null;
        const result = await tx.stockTransferLine.updateMany({
          where: {
            tenant_id: access.tenantId,
            id: line.id,
            transfer_id: id,
            shipped_qty: line.shipped_qty,
          },
          data: {
            shipped_qty: line.approved_qty,
            source_location_id: sourceLocationId,
          },
        });
        if (result.count !== 1) {
          throw new ConflictException(
            `Line ${line.id} changed during shipping. Refresh and retry.`,
          );
        }
      });

      await this.writeShipLedgerPairs(tx, access.tenantId, {
        transfer,
        sourceByLine: [...frozenSourceByLine.entries()],
      });

      return this.loadTransfer(tx, access.tenantId, id);
    });
  }

  // ---------------------------------------------------------------------------
  // Receive / return (ruling 30 durable idempotency)
  // ---------------------------------------------------------------------------

  async receive(
    id: string,
    dto: ReceiveStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    const access = await this.loadCallerAccess();
    assertUniqueLineIds(dto.lines.map((line) => line.id));

    const replayed = await this.findReplayableCommand(
      access.tenantId,
      id,
      StockTransferCommandAction.RECEIVE,
      dto.idempotencyKey,
      dto,
      access,
    );
    if (replayed) {
      return replayed;
    }

    try {
      return await this.commitTransfer(access, 'UPDATED', async (tx) => {
        const transfer = await this.loadTransfer(tx, access.tenantId, id);
        this.assertTransferAccess(access, transfer, {
          requireTo: true,
        });
        if (transfer.status !== StockTransferStatus.SHIPPED) {
          throw new ConflictException(
            `Only SHIPPED transfers can receive stock (current: ${transfer.status}).`,
          );
        }
        if (transfer.version !== dto.expectedVersion) {
          throw new ConflictException(
            `Version conflict: expected ${dto.expectedVersion}, current ${transfer.version}.`,
          );
        }
        await this.lockSitesForTransfer(tx, access.tenantId, transfer);

        const linesById = new Map(
          transfer.lines.map((line) => [line.id, line]),
        );
        for (const update of dto.lines) {
          const line = linesById.get(update.id);
          if (!line) {
            throw new UnprocessableEntityException(
              `Line ${update.id} does not belong to this transfer.`,
            );
          }
          if (line.shipped_qty.eq(0)) {
            throw new UnprocessableEntityException(
              `Line ${update.id} has nothing shipped to receive.`,
            );
          }
          const outstanding = line.shipped_qty
            .minus(line.received_qty)
            .minus(line.returned_qty);
          if (outstanding.lt(update.receiveQty)) {
            throw new UnprocessableEntityException(
              `Receive quantity exceeds the outstanding shipped quantity for line ${update.id}.`,
            );
          }
          if (
            line.dest_location_id &&
            line.dest_location_id !== update.destLocationId
          ) {
            throw new UnprocessableEntityException(
              `Destination bin for line ${update.id} is frozen; received quantity must go to ${line.dest_location_id}.`,
            );
          }
        }

        const destLocationIds = [
          ...new Set(dto.lines.map((update) => update.destLocationId)),
        ];
        await this.assertDestBinsValid(
          tx,
          access.tenantId,
          transfer.to_site_id,
          destLocationIds,
        );

        const guarded = await tx.stockTransfer.updateMany({
          where: {
            id,
            tenant_id: access.tenantId,
            status: StockTransferStatus.SHIPPED,
            version: dto.expectedVersion,
          },
          data: {
            version: { increment: 1 },
            received_by_user_id: access.userId,
          },
        });
        if (guarded.count !== 1) {
          throw new ConflictException(
            'Transfer changed during receiving. Refresh and retry.',
          );
        }

        await chunkedPromiseAll(dto.lines, async (update) => {
          const line = linesById.get(update.id)!;
          const result = await tx.stockTransferLine.updateMany({
            where: {
              tenant_id: access.tenantId,
              id: update.id,
              transfer_id: id,
              received_qty: line.received_qty,
              returned_qty: line.returned_qty,
            },
            data: {
              received_qty: { increment: update.receiveQty },
              ...(line.dest_location_id
                ? {}
                : { dest_location_id: update.destLocationId }),
            },
          });
          if (result.count !== 1) {
            throw new ConflictException(
              `Line ${update.id} changed during receiving. Refresh and retry.`,
            );
          }
        });

        await this.writeSettlementLedgerPairs(tx, access.tenantId, {
          transfer,
          movements: dto.lines.map((update) => {
            const line = linesById.get(update.id)!;
            return {
              line,
              quantity: update.receiveQty,
              inLocationId: update.destLocationId,
            };
          }),
        });

        return await this.settleAndStoreCommand(
          tx,
          access.tenantId,
          id,
          StockTransferCommandAction.RECEIVE,
          dto.idempotencyKey,
          dto,
        );
      });
    } catch (error) {
      return await this.replayOrRethrow(
        error,
        id,
        StockTransferCommandAction.RECEIVE,
        dto.idempotencyKey,
        dto,
        access,
      );
    }
  }

  async returnTransfer(
    id: string,
    dto: ReturnStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    const access = await this.loadCallerAccess();
    assertUniqueLineIds(dto.lines.map((line) => line.id));

    const replayed = await this.findReplayableCommand(
      access.tenantId,
      id,
      StockTransferCommandAction.RETURN,
      dto.idempotencyKey,
      dto,
      access,
    );
    if (replayed) {
      return replayed;
    }

    try {
      return await this.commitTransfer(access, 'UPDATED', async (tx) => {
        const transfer = await this.loadTransfer(tx, access.tenantId, id);
        this.assertTransferAccess(access, transfer, {
          requireTo: true,
          allowFromAdmin: true,
        });
        if (transfer.status !== StockTransferStatus.SHIPPED) {
          throw new ConflictException(
            `Only SHIPPED transfers can return stock (current: ${transfer.status}).`,
          );
        }
        if (transfer.version !== dto.expectedVersion) {
          throw new ConflictException(
            `Version conflict: expected ${dto.expectedVersion}, current ${transfer.version}.`,
          );
        }
        await this.lockSitesForTransfer(tx, access.tenantId, transfer);

        const linesById = new Map(
          transfer.lines.map((line) => [line.id, line]),
        );
        for (const update of dto.lines) {
          const line = linesById.get(update.id);
          if (!line) {
            throw new UnprocessableEntityException(
              `Line ${update.id} does not belong to this transfer.`,
            );
          }
          if (line.shipped_qty.eq(0) || !line.source_location_id) {
            throw new UnprocessableEntityException(
              `Line ${update.id} has no shipped stock to return.`,
            );
          }
          const unreceived = line.shipped_qty
            .minus(line.received_qty)
            .minus(line.returned_qty);
          if (unreceived.lt(update.returnQty)) {
            throw new UnprocessableEntityException(
              `Return quantity exceeds the unreceived quantity for line ${update.id}.`,
            );
          }
        }

        await this.assertSourceBinsValid(
          tx,
          access.tenantId,
          transfer.from_site_id,
          dto.lines
            .map(
              (update) =>
                (linesById.get(update.id) as (typeof transfer.lines)[number])
                  .source_location_id,
            )
            .filter((locationId): locationId is string => Boolean(locationId)),
        );

        const guarded = await tx.stockTransfer.updateMany({
          where: {
            id,
            tenant_id: access.tenantId,
            status: StockTransferStatus.SHIPPED,
            version: dto.expectedVersion,
          },
          data: { version: { increment: 1 } },
        });
        if (guarded.count !== 1) {
          throw new ConflictException(
            'Transfer changed during return. Refresh and retry.',
          );
        }

        await chunkedPromiseAll(dto.lines, async (update) => {
          const line = linesById.get(update.id)!;
          const result = await tx.stockTransferLine.updateMany({
            where: {
              tenant_id: access.tenantId,
              id: update.id,
              transfer_id: id,
              received_qty: line.received_qty,
              returned_qty: line.returned_qty,
            },
            data: { returned_qty: { increment: update.returnQty } },
          });
          if (result.count !== 1) {
            throw new ConflictException(
              `Line ${update.id} changed during return. Refresh and retry.`,
            );
          }
        });

        await this.writeSettlementLedgerPairs(tx, access.tenantId, {
          transfer,
          movements: dto.lines.map((update) => {
            const line = linesById.get(update.id)!;
            return {
              line,
              quantity: update.returnQty,
              inLocationId: line.source_location_id!,
            };
          }),
        });

        return await this.settleAndStoreCommand(
          tx,
          access.tenantId,
          id,
          StockTransferCommandAction.RETURN,
          dto.idempotencyKey,
          dto,
        );
      });
    } catch (error) {
      return await this.replayOrRethrow(
        error,
        id,
        StockTransferCommandAction.RETURN,
        dto.idempotencyKey,
        dto,
        access,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Shared internals
  // ---------------------------------------------------------------------------

  private async loadCallerAccess(): Promise<CallerAccess> {
    const authUser = this.tenantContext.getAuthenticatedUser();
    if (!authUser?.userId) {
      throw new ForbiddenException(
        'Stock transfers require an authenticated user.',
      );
    }
    const tenantId = await this.tenantContext.getTenantId();
    const user = await this.prisma.user.findFirst({
      where: { firebaseUid: authUser.userId },
      select: { id: true },
    });
    if (!user) {
      throw new ForbiddenException('User not found for the current session.');
    }

    const memberships = await this.prisma.siteMembership.findMany({
      where: {
        tenant_id: tenantId,
        user_id: user.id,
        is_active: true,
        site: { is_active: true },
        tenantMember: { is_active: true },
      },
      select: { site_id: true, tenantMember: { select: { role: true } } },
    });

    const accessBySite = new Map<string, string>();
    for (const membership of memberships) {
      accessBySite.set(membership.site_id, membership.tenantMember.role);
    }
    const isAdmin = memberships.some((membership) =>
      (TENANT_ADMIN_ROLES as readonly string[]).includes(
        membership.tenantMember.role,
      ),
    );
    return { userId: user.id, tenantId, accessBySite, isAdmin };
  }

  private assertTransferAccess(
    access: CallerAccess,
    transfer: { from_site_id: string; to_site_id: string } | null,
    options: {
      requireFrom?: boolean;
      requireTo?: boolean;
      requireAdmin?: boolean;
      allowFromAdmin?: boolean;
    },
  ): { fromAccess: boolean; toAccess: boolean } {
    if (!transfer) {
      throw new NotFoundException('Stock transfer not found');
    }
    const fromAccess = access.accessBySite.has(transfer.from_site_id);
    const toAccess = access.accessBySite.has(transfer.to_site_id);
    if (!fromAccess && !toAccess) {
      throw new NotFoundException('Stock transfer not found');
    }
    if (options.requireFrom && !fromAccess) {
      throw new ForbiddenException(
        'This action requires an active membership on the from-site.',
      );
    }
    if (options.requireTo && !toAccess) {
      if (options.allowFromAdmin && fromAccess && access.isAdmin) {
        return { fromAccess, toAccess };
      }
      throw new ForbiddenException(
        'This action requires an active membership on the to-site.',
      );
    }
    if (options.requireAdmin && !(fromAccess && access.isAdmin)) {
      throw new ForbiddenException(
        'This action requires OWNER/ADMIN on the from-site.',
      );
    }
    return { fromAccess, toAccess };
  }

  private loadTransfer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ): Promise<StockTransferWithSitesAndLines> {
    return tx.stockTransfer.findFirst({
      where: { id, tenant_id: tenantId },
      include: TRANSFER_INCLUDE,
    }) as Promise<StockTransferWithSitesAndLines>;
  }

  /**
   * Ruling 41: two-site writes lock both site rows in globally sorted id
   * order, then recheck `is_active` and the shared legal entity before
   * mutating anything.
   */
  private async lockSites(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteIds: string[],
  ) {
    const sorted = [...new Set(siteIds)].sort();
    // eslint-disable-next-line no-restricted-syntax -- ADR-0021/0022 lock hierarchy requires sorted site-row locks.
    await tx.$queryRaw`
      SELECT id
      FROM "sites"
      WHERE tenant_id = ${tenantId}
        AND id IN (${Prisma.join(sorted)})
      ORDER BY id
      FOR UPDATE
    `;
    const sites = await tx.site.findMany({
      where: { tenant_id: tenantId, id: { in: sorted } },
      select: { id: true, is_active: true, legal_entity_id: true },
    });
    if (sites.length !== sorted.length) {
      throw new NotFoundException('Site not found in this tenant');
    }
    if (sites.some((site) => !site.is_active)) {
      throw new UnprocessableEntityException(
        'Both transfer endpoint sites must be active.',
      );
    }
    return sites;
  }

  private async lockSitesForTransfer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    transfer: { from_site_id: string; to_site_id: string },
  ) {
    const sites = await this.lockSites(tx, tenantId, [
      transfer.from_site_id,
      transfer.to_site_id,
    ]);
    const fromSite = sites.find((site) => site.id === transfer.from_site_id)!;
    const toSite = sites.find((site) => site.id === transfer.to_site_id)!;
    if (fromSite.legal_entity_id !== toSite.legal_entity_id) {
      throw new UnprocessableEntityException(
        'Stock transfers cannot cross legal entities (same-GmbH only).',
      );
    }
    return sites;
  }

  private async assertSourceBinsValid(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fromSiteId: string,
    locationIds: string[],
  ): Promise<void> {
    if (locationIds.length === 0) {
      return;
    }
    const unique = [...new Set(locationIds)];
    const locations = await tx.storageLocation.findMany({
      where: { tenant_id: tenantId, id: { in: unique } },
      select: { id: true, site_id: true, type: true, deletedAt: true },
    });
    if (locations.length !== unique.length) {
      throw new UnprocessableEntityException('Source location not found.');
    }
    for (const location of locations) {
      if (
        location.site_id !== fromSiteId ||
        location.type !== LocationType.bin ||
        location.deletedAt
      ) {
        throw new UnprocessableEntityException(
          `Location ${location.id} is not an active bin on the from-site.`,
        );
      }
    }
  }

  private async assertDestBinsValid(
    tx: Prisma.TransactionClient,
    tenantId: string,
    toSiteId: string,
    locationIds: string[],
  ): Promise<void> {
    if (locationIds.length === 0) {
      return;
    }
    const unique = [...new Set(locationIds)];
    const locations = await tx.storageLocation.findMany({
      where: { tenant_id: tenantId, id: { in: unique } },
      select: { id: true, site_id: true, type: true, deletedAt: true },
    });
    if (locations.length !== unique.length) {
      throw new UnprocessableEntityException('Destination location not found');
    }
    for (const location of locations) {
      if (
        location.site_id !== toSiteId ||
        location.type !== LocationType.bin ||
        location.deletedAt
      ) {
        throw new UnprocessableEntityException(
          `Location ${location.id} is not an active bin on the to-site.`,
        );
      }
    }
  }

  /**
   * Ruling 33: ship availability is atomic against on-hand minus reserved at
   * the source bins, under the ADR-0021 stock-row lock order (sorted ids).
   */
  private async assertShipAvailability(
    tx: Prisma.TransactionClient,
    tenantId: string,
    demands: Array<{ itemId: string; locationId: string; quantity: Decimal }>,
  ): Promise<void> {
    const demandsByStock = new Map<string, Decimal>();
    for (const demand of demands) {
      const key = `${demand.itemId}:${demand.locationId}`;
      demandsByStock.set(
        key,
        (demandsByStock.get(key) ?? new Decimal(0)).add(demand.quantity),
      );
    }

    const candidateStocks = await tx.inventoryStock.findMany({
      where: {
        tenant_id: tenantId,
        OR: [...demandsByStock.keys()].map((key) => {
          const [itemId, locationId] = key.split(':');
          return { catalog_item_id: itemId, location_id: locationId };
        }),
      },
      select: { id: true },
    });
    const sortedIds = candidateStocks.map((stock) => stock.id).sort();
    if (sortedIds.length === 0) {
      throw new UnprocessableEntityException(
        'No stock rows found for the requested source bins.',
      );
    }
    // eslint-disable-next-line no-restricted-syntax -- ADR-0021 lock hierarchy: sorted stock-row locks under the site locks.
    const lockedStocks = await tx.$queryRaw<
      Array<{
        id: string;
        catalog_item_id: string;
        location_id: string;
        quantity_on_hand: Decimal;
        quantity_reserved: Decimal;
      }>
    >`
      SELECT id, catalog_item_id, location_id, quantity_on_hand, quantity_reserved
      FROM "inventory_stocks"
      WHERE tenant_id = ${tenantId}
        AND id IN (${Prisma.join(sortedIds)})
      ORDER BY id
      FOR UPDATE
    `;

    for (const [key, quantity] of demandsByStock) {
      const [itemId, locationId] = key.split(':');
      const stock = lockedStocks.find(
        (row) =>
          row.catalog_item_id === itemId && row.location_id === locationId,
      );
      const available = stock
        ? new Decimal(stock.quantity_on_hand).minus(
            new Decimal(stock.quantity_reserved),
          )
        : new Decimal(0);
      if (available.lt(quantity)) {
        throw new UnprocessableEntityException(
          `Insufficient available stock for item ${itemId} at location ${locationId}.`,
        );
      }
    }
  }

  private async writeShipLedgerPairs(
    tx: Prisma.TransactionClient,
    tenantId: string,
    {
      transfer,
      sourceByLine,
    }: {
      transfer: StockTransferWithSitesAndLines;
      sourceByLine: Array<[string, string]>;
    },
  ): Promise<void> {
    if (sourceByLine.length === 0) {
      return;
    }
    const transitLocation = await this.getFromSiteTransitLocation(
      tx,
      tenantId,
      transfer.from_site_id,
    );

    const linesById = new Map(transfer.lines.map((line) => [line.id, line]));
    const itemIds = [
      ...new Set(
        sourceByLine.map(([lineId]) => linesById.get(lineId)!.catalog_item_id),
      ),
    ];
    const catalogItems = await tx.catalogItem.findMany({
      where: { tenant_id: tenantId, id: { in: itemIds } },
      select: { id: true, cost_price: true },
    });
    if (catalogItems.length !== itemIds.length) {
      throw new NotFoundException('Catalog item not found in this tenant.');
    }
    const costsByItem = new Map(
      catalogItems.map((item) => [
        item.id,
        item.cost_price?.toString() ?? null,
      ]),
    );
    const transactions: RecordTransactionParams[] = [];
    for (const [lineId, sourceLocationId] of sourceByLine) {
      const line = linesById.get(lineId)!;
      transactions.push(
        ...buildTransferLedgerPair({
          itemId: line.catalog_item_id,
          outLocationId: sourceLocationId,
          inLocationId: transitLocation.id,
          quantity: line.approved_qty.toString(),
          transferId: transfer.id,
          movementGroupId: randomUUID(),
          costBasis: costsByItem.get(line.catalog_item_id) ?? null,
        }),
      );
    }
    await this.ledgerService.recordTransactions(transactions, tx, {
      allowedLocationTypes: TRANSFER_ENABLED_LOCATION_TYPES,
    });
  }

  /**
   * Receive/return ledger pairs (ruling 34): the OUT row is always the
   * from-site in-transit location, the IN row the dest bin (receive) or the
   * original source bin (return). Cost basis is copied from the ship
   * movement, never re-read from the live catalog (ruling 35).
   */
  private async writeSettlementLedgerPairs(
    tx: Prisma.TransactionClient,
    tenantId: string,
    {
      transfer,
      movements,
    }: {
      transfer: { id: string; from_site_id: string };
      movements: Array<{
        line: {
          id: string;
          catalog_item_id: string;
          source_location_id: string | null;
        };
        quantity: number;
        inLocationId: string;
      }>;
    },
  ): Promise<void> {
    if (movements.length === 0) {
      return;
    }
    const transitLocation = await this.getFromSiteTransitLocation(
      tx,
      tenantId,
      transfer.from_site_id,
    );

    const shipMovements = await tx.inventoryTransaction.findMany({
      where: {
        tenant_id: tenantId,
        site_id: transfer.from_site_id,
        stock_transfer_id: transfer.id,
        type: 'TRANSFER_OUT',
        OR: movements.flatMap(({ line }) =>
          line.source_location_id
            ? [
                {
                  item_id: line.catalog_item_id,
                  location_id: line.source_location_id,
                },
              ]
            : [],
        ),
      },
      orderBy: { seq: 'asc' },
      select: { item_id: true, location_id: true, cost_basis: true },
    });
    const costsBySource = new Map<string, string | null>();
    for (const movement of shipMovements) {
      const key = `${movement.item_id}:${movement.location_id}`;
      if (!costsBySource.has(key)) {
        costsBySource.set(key, movement.cost_basis?.toString() ?? null);
      }
    }
    const transactions: RecordTransactionParams[] = [];
    for (const movement of movements) {
      const costBasis =
        costsBySource.get(
          `${movement.line.catalog_item_id}:${movement.line.source_location_id}`,
        ) ?? null;
      transactions.push(
        ...buildTransferLedgerPair({
          itemId: movement.line.catalog_item_id,
          outLocationId: transitLocation.id,
          inLocationId: movement.inLocationId,
          quantity: String(movement.quantity),
          transferId: transfer.id,
          movementGroupId: randomUUID(),
          costBasis,
        }),
      );
    }
    await this.ledgerService.recordTransactions(transactions, tx, {
      allowedLocationTypes: TRANSFER_ENABLED_LOCATION_TYPES,
    });
  }

  private async getFromSiteTransitLocation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fromSiteId: string,
  ): Promise<{ id: string }> {
    const transit = await tx.storageLocation.findFirst({
      where: {
        tenant_id: tenantId,
        site_id: fromSiteId,
        type: LocationType.in_transit,
        is_system: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!transit) {
      throw new UnprocessableEntityException(
        `The from-site ${fromSiteId} has no system in_transit location.`,
      );
    }
    return transit;
  }

  /**
   * Applies the completion transition when every line is fully settled
   * (received + returned = shipped) and returns the reloaded transfer.
   */
  private async settleTransfer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    transferId: string,
  ): Promise<StockTransferWithSitesAndLines> {
    const lines = await tx.stockTransferLine.findMany({
      where: { tenant_id: tenantId, transfer_id: transferId },
      select: {
        shipped_qty: true,
        received_qty: true,
        returned_qty: true,
      },
    });
    const fullySettled = lines.every((line) =>
      line.received_qty.plus(line.returned_qty).eq(line.shipped_qty),
    );
    if (fullySettled) {
      await tx.stockTransfer.updateMany({
        where: {
          id: transferId,
          tenant_id: tenantId,
          status: StockTransferStatus.SHIPPED,
        },
        data: { status: StockTransferStatus.COMPLETED },
      });
    }
    return this.loadTransfer(tx, tenantId, transferId);
  }

  private async settleAndStoreCommand(
    tx: Prisma.TransactionClient,
    tenantId: string,
    transferId: string,
    action: StockTransferCommandAction,
    idempotencyKey: string,
    requestBody: unknown,
  ): Promise<StockTransferWithSitesAndLines> {
    const transfer = await this.settleTransfer(tx, tenantId, transferId);
    const serialized = serializeStockTransfer(transfer, {
      includeSourceBin: true,
    });
    await tx.stockTransferCommand.create({
      data: {
        tenant_id: tenantId,
        transfer_id: transferId,
        action,
        idempotency_key: idempotencyKey,
        request_hash: hashCommandRequest(requestBody),
        response_status: 200,
        response_body: serializedCommandBody(action, requestBody, {
          transfer: serialized,
        }),
      },
    });
    return transfer;
  }

  private async findReplayableCommand(
    tenantId: string,
    transferId: string,
    action: StockTransferCommandAction,
    idempotencyKey: string,
    requestBody: unknown,
    access: CallerAccess,
  ): Promise<SerializedStockTransfer | null> {
    const { fromAccess } = await this.authorizeReplay(access, transferId);
    const command = await this.prisma.stockTransferCommand.findFirst({
      where: {
        tenant_id: tenantId,
        transfer_id: transferId,
        action,
        idempotency_key: idempotencyKey,
      },
    });
    if (!command) {
      return null;
    }
    return this.replayStoredCommand({
      command,
      requestBody,
      fromAccess,
    });
  }

  private async replayOrRethrow(
    error: unknown,
    transferId: string,
    action: StockTransferCommandAction,
    idempotencyKey: string,
    requestBody: unknown,
    access: CallerAccess,
  ): Promise<SerializedStockTransfer> {
    if (isUniqueConstraintError(error) || error instanceof ConflictException) {
      const { fromAccess } = await this.authorizeReplay(access, transferId);
      const command = await this.prisma.stockTransferCommand
        .findFirst({
          where: {
            tenant_id: access.tenantId,
            transfer_id: transferId,
            action,
            idempotency_key: idempotencyKey,
          },
        })
        .catch(() => null);
      if (command) {
        return this.replayStoredCommand({
          command,
          requestBody,
          fromAccess,
        });
      }
    }
    throw error;
  }

  private replayStoredCommand({
    command,
    requestBody,
    fromAccess,
  }: StoredCommandReplay): SerializedStockTransfer {
    if (command.request_hash !== hashCommandRequest(requestBody)) {
      throw new ConflictException(
        'This idempotency key was already used with a different request body.',
      );
    }
    const stored = (command.response_body as Record<string, unknown>)
      .transfer as SerializedStockTransfer;
    return redactStoredCommandResponse(stored, fromAccess);
  }

  private async authorizeReplay(access: CallerAccess, transferId: string) {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id: transferId, tenant_id: access.tenantId },
      select: { from_site_id: true, to_site_id: true },
    });
    return this.assertTransferAccess(access, transfer, {});
  }

  private async generateTransferNumber(tx: Prisma.TransactionClient) {
    const tenantId = await this.tenantContext.getTenantId();
    const currentYear = new Date().getFullYear();
    const prefix = `TR-${currentYear}-`;

    await tx.financeSettings.upsert({
      where: { tenant_id: tenantId },
      update: {},
      create: {
        tenant_id: tenantId,
        fiscal_year_start_month: 1,
        lock_date: null,
        next_invoice_number: 1001,
        invoice_prefix: 'RE-2026-',
        next_sales_order_number: 1001,
        sales_order_prefix: 'SO-2026-',
        next_workshop_order_number: 1,
        workshop_order_prefix: `WO-${currentYear}-`,
        stock_transfer_prefix: prefix,
      },
    });

    const settings = await tx.financeSettings.update({
      where: { tenant_id: tenantId },
      data: {
        next_stock_transfer_number: { increment: 1 },
      },
      select: { next_stock_transfer_number: true, stock_transfer_prefix: true },
    });

    const paddedSequence = String(
      settings.next_stock_transfer_number - 1,
    ).padStart(4, '0');
    return `${settings.stock_transfer_prefix}${paddedSequence}`;
  }

  /**
   * Ruling 36: resolve the fan-out recipients — every user with an active
   * SiteMembership on either endpoint joined to an active TenantMember — and
   * their source-bin visibility flag (ruling 43).
   */
  private async resolveRecipients(
    tenantId: string,
    fromSiteId: string,
    toSiteId: string,
  ) {
    const memberships = await this.prisma.siteMembership.findMany({
      where: {
        tenant_id: tenantId,
        is_active: true,
        site_id: { in: [fromSiteId, toSiteId] },
        site: { is_active: true },
        tenantMember: { is_active: true },
      },
      select: { site_id: true, user: { select: { firebaseUid: true } } },
    });

    const byFirebaseUid = new Map<
      string,
      { firebaseUid: string; includeSourceBin: boolean }
    >();
    for (const membership of memberships) {
      const firebaseUid = membership.user.firebaseUid;
      const existing = byFirebaseUid.get(firebaseUid);
      const includeSourceBin = membership.site_id === fromSiteId;
      if (existing) {
        existing.includeSourceBin =
          existing.includeSourceBin || includeSourceBin;
      } else {
        byFirebaseUid.set(firebaseUid, { firebaseUid, includeSourceBin });
      }
    }
    return [...byFirebaseUid.values()];
  }

  private async commitTransfer(
    access: CallerAccess,
    action: 'CREATED' | 'UPDATED',
    mutation: (
      tx: Prisma.TransactionClient,
    ) => Promise<StockTransferWithSitesAndLines>,
  ): Promise<SerializedStockTransfer> {
    const transfer = await this.prisma.$transaction(mutation);
    await this.emitTransferUpdated(access.tenantId, action, transfer);
    return serializeStockTransfer(transfer, {
      includeSourceBin: access.accessBySite.has(transfer.from_site_id),
    });
  }

  private async emitTransferUpdated(
    tenantId: string,
    action: 'CREATED' | 'UPDATED',
    transfer: StockTransferWithSitesAndLines,
  ): Promise<void> {
    const recipients = await this.resolveRecipients(
      tenantId,
      transfer.from_site_id,
      transfer.to_site_id,
    );
    this.realtimeService.emitStockTransferUpdated(tenantId, {
      action,
      fromSiteId: transfer.from_site_id,
      toSiteId: transfer.to_site_id,
      transfer: serializeStockTransfer(transfer, {
        includeSourceBin: true,
      }) as unknown as Record<string, unknown>,
      recipients,
    });
  }
}

function assertUniqueLineIds(ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new UnprocessableEntityException(
        `Duplicate line id ${id} in request.`,
      );
    }
    seen.add(id);
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function serializedCommandBody(
  action: StockTransferCommandAction,
  requestBody: unknown,
  payload: { transfer: SerializedStockTransfer },
): Prisma.InputJsonValue {
  return {
    action,
    request: requestBody,
    ...payload,
  } as unknown as Prisma.InputJsonValue;
}
