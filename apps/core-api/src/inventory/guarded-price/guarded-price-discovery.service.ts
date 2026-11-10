import { Injectable, NotFoundException } from '@nestjs/common';
import { InventoryPriceOperationState, Prisma } from '@prisma/client';
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
} from './guarded-price-discovery-cursor.js';
import { mapInventoryPriceOperation } from './guarded-price-operation.mapper.js';
import { rowWithinRetention } from './guarded-price-retention.js';
import { isUuidV7 } from './guarded-price.uuid.js';
import { guardedRequestInvalid } from './guarded-price.errors.js';

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
    const take = GUARDED_PRICE_DISCOVERY_PAGE_SIZE + 1;

    const baseWhere: Prisma.InventoryPriceOperationWhereInput = {
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

    const keysetWhere: Prisma.InventoryPriceOperationWhereInput = decodedCursor
      ? {
          OR: [
            { accepted_at: { lt: new Date(decodedCursor.acceptedAt) } },
            {
              AND: [
                { accepted_at: new Date(decodedCursor.acceptedAt) },
                { key: { lt: decodedCursor.key } },
              ],
            },
          ],
        }
      : {};

    const rows = await this.prisma.inventoryPriceOperation.findMany({
      where: { AND: [baseWhere, keysetWhere] },
      orderBy: [{ accepted_at: 'desc' }, { key: 'desc' }],
      take,
    });

    const accessible = await this.filterAccessibleRows(tenantId, rows);
    const retained = accessible.filter((row) => rowWithinRetention(row));
    const hasNextPage = rows.length > GUARDED_PRICE_DISCOVERY_PAGE_SIZE;
    const pageRows = retained.slice(0, GUARDED_PRICE_DISCOVERY_PAGE_SIZE);

    const meta: ListCursorPageMetaDto = {
      limit: GUARDED_PRICE_DISCOVERY_PAGE_SIZE,
      hasNextPage,
      nextCursor: null,
    };
    if (hasNextPage && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      meta.nextCursor = encodePriceOperationDiscoveryCursor({
        acceptedAt: last.accepted_at.toISOString(),
        key: last.key,
      });
    }

    return {
      data: pageRows.map(mapInventoryPriceOperation),
      meta,
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

    const accessible = await this.filterAccessibleRows(tenantId, [row]);
    if (accessible.length === 0) {
      throw new NotFoundException(`Price operation ${key} not found`);
    }

    return mapInventoryPriceOperation(accessible[0]);
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
