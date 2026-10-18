import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  StockTransferCommandAction,
  StockTransferStatus,
} from '@prisma/client';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import type {
  ApproveStockTransferDto,
  ApproveStockTransferLineDto,
  CancelStockTransferDto,
  CreateStockTransferDto,
  ReceiveStockTransferDto,
  RejectStockTransferDto,
  ReturnStockTransferDto,
  ShipStockTransferDto,
} from './dto/stock-transfer.dto.js';
import { StockTransferAccessService } from './stock-transfer-access.service.js';
import { StockTransferCommitService } from './stock-transfer-commit.service.js';
import { StockTransferCommandService } from './stock-transfer-command.service.js';
import { StockTransferLedgerPostingService } from './stock-transfer-ledger-posting.service.js';
import {
  assertDestBinsValid,
  assertShipAvailability,
  assertSourceBinsValid,
  assertUniqueLineIds,
} from './stock-transfer-line-validation.helpers.js';
import { StockTransferQueryService } from './stock-transfer-query.service.js';
import { StockTransferSiteLockService } from './stock-transfer-site-lock.service.js';
import { TRANSFER_INCLUDE } from './stock-transfer-include.js';
import { SerializedStockTransfer } from './stock-transfer-serializer.js';

import Decimal = Prisma.Decimal;

@Injectable()
export class StockTransferMutationService {
  constructor(
    private readonly accessService: StockTransferAccessService,
    private readonly queryService: StockTransferQueryService,
    private readonly siteLockService: StockTransferSiteLockService,
    private readonly ledgerPostingService: StockTransferLedgerPostingService,
    private readonly commandService: StockTransferCommandService,
    private readonly commitService: StockTransferCommitService,
  ) {}

  async create(dto: CreateStockTransferDto): Promise<SerializedStockTransfer> {
    const access = await this.accessService.loadCallerAccess();
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

    return this.commitService.commitTransfer(access, 'CREATED', async (tx) => {
      const [fromSite, toSite] = await this.siteLockService.lockSites(
        tx,
        access.tenantId,
        [dto.fromSiteId, dto.toSiteId],
      );
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
      await assertSourceBinsValid(
        tx,
        access.tenantId,
        dto.fromSiteId,
        sourceLocationIds,
      );

      const transferNumber =
        await this.commitService.generateTransferNumber(tx);
      const transfer = await tx.stockTransfer.create({
        data: {
          tenant_id: access.tenantId,
          transfer_number: transferNumber,
          from_site_id: dto.fromSiteId,
          to_site_id: dto.toSiteId,
          status: StockTransferStatus.REQUESTED,
          version: 1,
          requested_by_user_id: access.userId,
          // tenant_id / from_site_id / to_site_id are columns of the composite
          // transfer relation: Prisma fills them from the parent on a nested
          // create and rejects them as unknown arguments (AUT-466).
          lines: {
            create: dto.lines.map((line) => ({
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

  async approve(
    id: string,
    dto: ApproveStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    const access = await this.accessService.loadCallerAccess();
    assertUniqueLineIds(dto.lines?.map((line) => line.id) ?? []);

    return this.commitService.commitTransfer(access, 'UPDATED', async (tx) => {
      const transfer = await this.queryService.loadTransfer(
        tx,
        access.tenantId,
        id,
        [...access.accessBySite.keys()],
      );
      this.accessService.assertTransferAccess(access, transfer, {
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
      await this.siteLockService.lockSitesForTransfer(
        tx,
        access.tenantId,
        transfer,
      );

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
      await assertSourceBinsValid(
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

      return this.queryService.loadTransfer(tx, access.tenantId, id, [
        ...access.accessBySite.keys(),
      ]);
    });
  }

  async reject(
    id: string,
    dto: RejectStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    const access = await this.accessService.loadCallerAccess();

    return this.commitService.commitTransfer(access, 'UPDATED', async (tx) => {
      const transfer = await this.queryService.loadTransfer(
        tx,
        access.tenantId,
        id,
        [...access.accessBySite.keys()],
      );
      this.accessService.assertTransferAccess(access, transfer, {
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

      return this.queryService.loadTransfer(tx, access.tenantId, id, [
        ...access.accessBySite.keys(),
      ]);
    });
  }

  async cancel(
    id: string,
    dto: CancelStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    const access = await this.accessService.loadCallerAccess();

    return this.commitService.commitTransfer(access, 'UPDATED', async (tx) => {
      const transfer = await this.queryService.loadTransfer(
        tx,
        access.tenantId,
        id,
        [...access.accessBySite.keys()],
      );
      const { fromAccess } = this.accessService.assertTransferAccess(
        access,
        transfer,
        {},
      );
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

      return this.queryService.loadTransfer(tx, access.tenantId, id, [
        ...access.accessBySite.keys(),
      ]);
    });
  }

  async ship(
    id: string,
    dto: ShipStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    const access = await this.accessService.loadCallerAccess();
    assertUniqueLineIds(dto.lines.map((line) => line.id));

    return this.commitService.commitTransfer(access, 'UPDATED', async (tx) => {
      const transfer = await this.queryService.loadTransfer(
        tx,
        access.tenantId,
        id,
        [...access.accessBySite.keys()],
      );
      this.accessService.assertTransferAccess(access, transfer, {
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
      await this.siteLockService.lockSitesForTransfer(
        tx,
        access.tenantId,
        transfer,
      );

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
      await assertSourceBinsValid(
        tx,
        access.tenantId,
        transfer.from_site_id,
        sourceLocationIds,
      );

      await assertShipAvailability(
        tx,
        access.tenantId,
        transfer.from_site_id,
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

      await this.ledgerPostingService.writeShipLedgerPairs(
        tx,
        access.tenantId,
        {
          transfer,
          sourceByLine: [...frozenSourceByLine.entries()],
        },
      );

      return this.queryService.loadTransfer(tx, access.tenantId, id, [
        ...access.accessBySite.keys(),
      ]);
    });
  }

  async receive(
    id: string,
    dto: ReceiveStockTransferDto,
  ): Promise<SerializedStockTransfer> {
    const access = await this.accessService.loadCallerAccess();
    assertUniqueLineIds(dto.lines.map((line) => line.id));

    const replayed = await this.commandService.findReplayableCommand(
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
      return await this.commitService.commitTransfer(
        access,
        'UPDATED',
        async (tx) => {
          const transfer = await this.queryService.loadTransfer(
            tx,
            access.tenantId,
            id,
            [...access.accessBySite.keys()],
          );
          this.accessService.assertTransferAccess(access, transfer, {
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
          await this.siteLockService.lockSitesForTransfer(
            tx,
            access.tenantId,
            transfer,
          );

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
          await assertDestBinsValid(
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

          await this.ledgerPostingService.writeSettlementLedgerPairs(
            tx,
            access.tenantId,
            {
              transfer,
              movements: dto.lines.map((update) => {
                const line = linesById.get(update.id)!;
                return {
                  line,
                  quantity: update.receiveQty,
                  inLocationId: update.destLocationId,
                };
              }),
            },
          );

          return await this.commandService.settleAndStoreCommand(
            tx,
            access.tenantId,
            id,
            [...access.accessBySite.keys()],
            StockTransferCommandAction.RECEIVE,
            dto.idempotencyKey,
            dto,
          );
        },
      );
    } catch (error) {
      return await this.commandService.replayOrRethrow(
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
    const access = await this.accessService.loadCallerAccess();
    assertUniqueLineIds(dto.lines.map((line) => line.id));

    const replayed = await this.commandService.findReplayableCommand(
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
      return await this.commitService.commitTransfer(
        access,
        'UPDATED',
        async (tx) => {
          const transfer = await this.queryService.loadTransfer(
            tx,
            access.tenantId,
            id,
            [...access.accessBySite.keys()],
          );
          this.accessService.assertTransferAccess(access, transfer, {
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
          await this.siteLockService.lockSitesForTransfer(
            tx,
            access.tenantId,
            transfer,
          );

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

          await assertSourceBinsValid(
            tx,
            access.tenantId,
            transfer.from_site_id,
            dto.lines
              .map(
                (update) =>
                  (linesById.get(update.id) as (typeof transfer.lines)[number])
                    .source_location_id,
              )
              .filter((locationId): locationId is string =>
                Boolean(locationId),
              ),
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

          await this.ledgerPostingService.writeSettlementLedgerPairs(
            tx,
            access.tenantId,
            {
              transfer,
              movements: dto.lines.map((update) => {
                const line = linesById.get(update.id)!;
                return {
                  line,
                  quantity: update.returnQty,
                  inLocationId: line.source_location_id!,
                };
              }),
            },
          );

          return await this.commandService.settleAndStoreCommand(
            tx,
            access.tenantId,
            id,
            [...access.accessBySite.keys()],
            StockTransferCommandAction.RETURN,
            dto.idempotencyKey,
            dto,
          );
        },
      );
    } catch (error) {
      return await this.commandService.replayOrRethrow(
        error,
        id,
        StockTransferCommandAction.RETURN,
        dto.idempotencyKey,
        dto,
        access,
      );
    }
  }
}
