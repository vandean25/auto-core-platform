import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TRANSFER_INCLUDE } from './stock-transfer-include.js';
import type { CallerAccess } from './stock-transfer-access.types.js';
import {
  serializeStockTransfer,
  SerializedStockTransfer,
  StockTransferWithSitesAndLines,
} from './stock-transfer-serializer.js';
import { StockTransferAccessService } from './stock-transfer-access.service.js';

@Injectable()
export class StockTransferQueryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly accessService: StockTransferAccessService,
  ) {}

  async list(): Promise<SerializedStockTransfer[]> {
    const access = await this.accessService.loadCallerAccess();
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
    const access = await this.accessService.loadCallerAccess();
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: {
        id,
        tenant_id: access.tenantId,
        OR: [
          { from_site_id: { in: [...access.accessBySite.keys()] } },
          { to_site_id: { in: [...access.accessBySite.keys()] } },
        ],
      },
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

  loadTransfer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    siteIds: string[],
  ): Promise<StockTransferWithSitesAndLines> {
    return tx.stockTransfer.findFirst({
      where: {
        id,
        tenant_id: tenantId,
        OR: [
          { from_site_id: { in: siteIds } },
          { to_site_id: { in: siteIds } },
        ],
      },
      include: TRANSFER_INCLUDE,
    }) as unknown as Promise<StockTransferWithSitesAndLines>;
  }
}
