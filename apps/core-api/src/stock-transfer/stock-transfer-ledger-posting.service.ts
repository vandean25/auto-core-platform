import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { LocationType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  LedgerService,
  RecordTransactionParams,
} from '../inventory/ledger.service.js';
import { buildTransferLedgerPair } from './stock-transfer-ledger.helpers.js';
import { TRANSFER_ENABLED_LOCATION_TYPES } from './stock-transfer.constants.js';
import { StockTransferWithSitesAndLines } from './stock-transfer-serializer.js';

@Injectable()
export class StockTransferLedgerPostingService {
  constructor(
    @Inject(LedgerService) private readonly ledgerService: LedgerService,
  ) {}

  async writeShipLedgerPairs(
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

  async writeSettlementLedgerPairs(
    tx: Prisma.TransactionClient,
    tenantId: string,
    {
      transfer,
      movements,
    }: {
      transfer: { id: string; from_site_id: string; to_site_id: string };
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
      authorizedSiteIds: [transfer.from_site_id, transfer.to_site_id],
    });
  }

  async getFromSiteTransitLocation(
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
}
