import { Injectable, NotFoundException } from '@nestjs/common';
import {
  InventoryPriceOperation,
  InventoryPriceOperationState,
  Prisma,
} from '@prisma/client';
import { ListCursorPageMetaDto } from '../../common/dto/list-cursor-response.dto.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  InventoryPriceOperationDto,
  InventoryPriceOperationListResponseDto,
} from '../dto/inventory-price-operation.dto.js';
import { assertCanMutateInventoryStock } from '../inventory-access.guards.js';
import { GUARDED_PRICE_DISCOVERY_PAGE_SIZE } from './guarded-price.constants.js';
import {
  encodePriceOperationDiscoveryCursor,
  parsePriceOperationDiscoveryCursor,
  type PriceOperationDiscoveryCursor,
} from './guarded-price-discovery-cursor.js';
import { mapInventoryPriceOperation } from './guarded-price-operation.mapper.js';
import { rowWithinRetention } from './guarded-price-retention.js';
import { isUuidV7 } from './guarded-price.uuid.js';
import { guardedRequestInvalid } from './guarded-price.errors.js';

const DISCOVERY_RAW_BATCH_SIZE = GUARDED_PRICE_DISCOVERY_PAGE_SIZE + 1;

@Injectable()
export class GuardedPriceDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listOperations(
    cursor?: string,
  ): Promise<InventoryPriceOperationListResponseDto> {
    this.assertInventoryPriceRole();
    const tenantId = await this.tenantContext.getTenantId();
    const principalId = this.requirePrincipalId();
    const decodedCursor = parsePriceOperationDiscoveryCursor(cursor);

    const scan = await this.scanVisibleOperationsPage(
      tenantId,
      this.discoveryListBaseWhere(tenantId, principalId),
      decodedCursor,
    );

    return {
      data: scan.survivors.map(mapInventoryPriceOperation),
      meta: this.buildDiscoveryListMeta(scan),
    };
  }

  private discoveryListBaseWhere(
    tenantId: string,
    principalId: string,
  ): Prisma.InventoryPriceOperationWhereInput {
    return {
      tenant_id: tenantId,
      principal_id: principalId,
      state: {
        in: [
          InventoryPriceOperationState.ACCEPTED,
          InventoryPriceOperationState.APPLIED,
          InventoryPriceOperationState.CONFLICT,
          InventoryPriceOperationState.FENCED,
        ],
      },
    };
  }

  private buildDiscoveryListMeta(scan: {
    survivors: InventoryPriceOperation[];
    lastRawExamined: InventoryPriceOperation | null;
    exhausted: boolean;
  }): ListCursorPageMetaDto {
    const hasNextPage = !scan.exhausted && scan.lastRawExamined !== null;
    const meta: ListCursorPageMetaDto = {
      limit: GUARDED_PRICE_DISCOVERY_PAGE_SIZE,
      hasNextPage,
      nextCursor: null,
    };
    if (hasNextPage && scan.lastRawExamined) {
      meta.nextCursor = encodePriceOperationDiscoveryCursor({
        acceptedAt: scan.lastRawExamined.accepted_at.toISOString(),
        key: scan.lastRawExamined.key,
      });
    }
    return meta;
  }

  private async scanVisibleOperationsPage(
    tenantId: string,
    baseWhere: Prisma.InventoryPriceOperationWhereInput,
    decodedCursor: PriceOperationDiscoveryCursor | null,
  ): Promise<{
    survivors: InventoryPriceOperation[];
    lastRawExamined: InventoryPriceOperation | null;
    exhausted: boolean;
  }> {
    const survivors: InventoryPriceOperation[] = [];
    let scanAfter: PriceOperationDiscoveryCursor | null = decodedCursor;
    let lastRawExamined: InventoryPriceOperation | null = null;
    let exhausted = false;

    while (survivors.length < GUARDED_PRICE_DISCOVERY_PAGE_SIZE && !exhausted) {
      const remainingSlots =
        GUARDED_PRICE_DISCOVERY_PAGE_SIZE - survivors.length;
      const page = await this.scanDiscoveryBatch(
        tenantId,
        baseWhere,
        scanAfter,
        remainingSlots,
      );
      if (page.exhausted) {
        exhausted = true;
        break;
      }

      lastRawExamined = page.lastRawExamined;
      survivors.push(...page.newSurvivors);
      if (survivors.length >= GUARDED_PRICE_DISCOVERY_PAGE_SIZE) {
        exhausted = page.batchFullyConsumed && page.endOfJournal;
        break;
      }
      if (page.endOfJournal) {
        exhausted = true;
        break;
      }

      if (page.lastRawExamined) {
        scanAfter = {
          acceptedAt: page.lastRawExamined.accepted_at.toISOString(),
          key: page.lastRawExamined.key,
        };
      }
    }

    return {
      survivors,
      lastRawExamined,
      exhausted,
    };
  }

  private async scanDiscoveryBatch(
    tenantId: string,
    baseWhere: Prisma.InventoryPriceOperationWhereInput,
    scanAfter: PriceOperationDiscoveryCursor | null,
    remainingSlots: number,
  ): Promise<{
    newSurvivors: InventoryPriceOperation[];
    lastRawExamined: InventoryPriceOperation | null;
    batchFullyConsumed: boolean;
    endOfJournal: boolean;
    exhausted: boolean;
  }> {
    const keysetWhere = this.buildKeysetWhere(scanAfter);
    const batch = await this.prisma.inventoryPriceOperation.findMany({
      where: { AND: [baseWhere, keysetWhere] },
      orderBy: [{ accepted_at: 'desc' }, { key: 'desc' }],
      take: DISCOVERY_RAW_BATCH_SIZE,
    });

    if (batch.length === 0) {
      return {
        newSurvivors: [],
        lastRawExamined: null,
        batchFullyConsumed: true,
        endOfJournal: true,
        exhausted: true,
      };
    }

    const visible = await this.filterVisibleRetainedRows(tenantId, batch);
    const visibleById = new Set(visible.map((row) => row.id));
    const newSurvivors: InventoryPriceOperation[] = [];
    let lastRawExamined: InventoryPriceOperation | null = null;
    let stoppedEarly = false;

    for (const row of batch) {
      lastRawExamined = row;
      if (!visibleById.has(row.id)) {
        continue;
      }
      newSurvivors.push(row);
      if (newSurvivors.length >= remainingSlots) {
        stoppedEarly = true;
        break;
      }
    }

    const batchFullyConsumed = !stoppedEarly;
    const endOfJournal =
      batchFullyConsumed && batch.length < DISCOVERY_RAW_BATCH_SIZE;
    return {
      newSurvivors,
      lastRawExamined,
      batchFullyConsumed,
      endOfJournal,
      exhausted: false,
    };
  }

  async getOperation(key: string): Promise<InventoryPriceOperationDto> {
    this.assertInventoryPriceRole();
    if (!isUuidV7(key)) {
      guardedRequestInvalid('Operation key must be a UUIDv7.');
    }
    const tenantId = await this.tenantContext.getTenantId();
    const principalId = this.requirePrincipalId();

    const row = await this.prisma.inventoryPriceOperation.findFirst({
      where: { tenant_id: tenantId, principal_id: principalId, key },
    });
    if (!row || !rowWithinRetention(row)) {
      throw new NotFoundException(`Price operation ${key} not found`);
    }

    const visible = await this.filterVisibleRetainedRows(tenantId, [row]);
    if (visible.length === 0) {
      throw new NotFoundException(`Price operation ${key} not found`);
    }

    return mapInventoryPriceOperation(visible[0]);
  }

  private buildKeysetWhere(
    cursor: PriceOperationDiscoveryCursor | null,
  ): Prisma.InventoryPriceOperationWhereInput {
    if (!cursor) {
      return {};
    }
    return {
      OR: [
        { accepted_at: { lt: new Date(cursor.acceptedAt) } },
        {
          AND: [
            { accepted_at: new Date(cursor.acceptedAt) },
            { key: { lt: cursor.key } },
          ],
        },
      ],
    };
  }

  private async filterVisibleRetainedRows(
    tenantId: string,
    rows: InventoryPriceOperation[],
  ): Promise<InventoryPriceOperation[]> {
    const retained = rows.filter((row) => rowWithinRetention(row));
    return this.filterAccessibleRows(tenantId, retained);
  }

  private async filterAccessibleRows<T extends { item_id: string }>(
    tenantId: string,
    rows: T[],
  ): Promise<T[]> {
    if (rows.length === 0) {
      return [];
    }
    const itemIds = [...new Set(rows.map((row) => row.item_id))];
    const items = await this.prisma.catalogItem.findMany({
      where: { tenant_id: tenantId, id: { in: itemIds } },
      select: { id: true },
    });
    const visible = new Set(items.map((item) => item.id));
    return rows.filter((row) => visible.has(row.item_id));
  }

  private assertInventoryPriceRole(): void {
    const role = this.tenantContext.getAuthenticatedUser()?.role;
    assertCanMutateInventoryStock(role);
  }

  private requirePrincipalId(): string {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.userId) {
      throw new NotFoundException('Authenticated principal is required.');
    }
    return user.userId;
  }
}
