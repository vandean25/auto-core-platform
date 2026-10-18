import {
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  Prisma,
  StockTransferCommandAction,
  StockTransferStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CallerAccess } from './stock-transfer-access.types.js';
import { StockTransferAccessService } from './stock-transfer-access.service.js';
import { StockTransferQueryService } from './stock-transfer-query.service.js';
import {
  hashCommandRequest,
  serializeStockTransfer,
  SerializedStockTransfer,
  StockTransferWithSitesAndLines,
} from './stock-transfer-serializer.js';
import {
  isUniqueConstraintError,
  replayStoredCommand,
  serializedCommandBody,
} from './stock-transfer-command.util.js';

@Injectable()
export class StockTransferCommandService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly accessService: StockTransferAccessService,
    private readonly queryService: StockTransferQueryService,
  ) {}

  async settleTransfer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    transferId: string,
    siteIds: string[],
  ): Promise<StockTransferWithSitesAndLines> {
    const lines = await tx.stockTransferLine.findMany({
      where: {
        tenant_id: tenantId,
        transfer_id: transferId,
        transfer: {
          OR: [
            { from_site_id: { in: siteIds } },
            { to_site_id: { in: siteIds } },
          ],
        },
      },
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
    return this.queryService.loadTransfer(tx, tenantId, transferId, [...siteIds]);
  }

  async settleAndStoreCommand(
    tx: Prisma.TransactionClient,
    tenantId: string,
    transferId: string,
    siteIds: string[],
    action: StockTransferCommandAction,
    idempotencyKey: string,
    requestBody: unknown,
  ): Promise<StockTransferWithSitesAndLines> {
    const transfer = await this.settleTransfer(
      tx,
      tenantId,
      transferId,
      siteIds,
    );
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

  async findReplayableCommand(
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
    return replayStoredCommand({
      command,
      requestBody,
      fromAccess,
    });
  }

  async replayOrRethrow(
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
        return replayStoredCommand({
          command,
          requestBody,
          fromAccess,
        });
      }
    }
    throw error;
  }

  private async authorizeReplay(access: CallerAccess, transferId: string) {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: {
        id: transferId,
        tenant_id: access.tenantId,
        OR: [
          { from_site_id: { in: [...access.accessBySite.keys()] } },
          { to_site_id: { in: [...access.accessBySite.keys()] } },
        ],
      },
      select: { from_site_id: true, to_site_id: true },
    });
    return this.accessService.assertTransferAccess(access, transfer, {});
  }
}
