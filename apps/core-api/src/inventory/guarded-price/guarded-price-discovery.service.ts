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
  type PriceOperationDiscoveryCursor,
} from './guarded-price-discovery-cursor.js';
import {
  discoveryCatalogExistsWhere,
  discoveryRetentionWhere,
} from './guarded-price-discovery-query.js';
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

    const catalogItemIds = await this.loadCatalogItemIds(tenantId);
    const where = this.discoveryListWhere(
      tenantId,
      principalId,
      decodedCursor,
      catalogItemIds,
    );
    const batch = await this.prisma.inventoryPriceOperation.findMany({
      where,
      orderBy: [{ accepted_at: 'desc' }, { key: 'desc' }],
      take: GUARDED_PRICE_DISCOVERY_PAGE_SIZE + 1,
    });

    const hasNextPage = batch.length > GUARDED_PRICE_DISCOVERY_PAGE_SIZE;
    const page = batch.slice(0, GUARDED_PRICE_DISCOVERY_PAGE_SIZE);

    return {
      data: page.map(mapInventoryPriceOperation),
      meta: this.buildDiscoveryListMeta(page, hasNextPage),
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

  private async loadCatalogItemIds(tenantId: string): Promise<string[]> {
    const items = await this.prisma.catalogItem.findMany({
      where: { tenant_id: tenantId },
      select: { id: true },
    });
    return items.map((item) => item.id);
  }

  private discoveryListWhere(
    tenantId: string,
    principalId: string,
    decodedCursor: PriceOperationDiscoveryCursor | null,
    catalogItemIds: string[],
  ): Prisma.InventoryPriceOperationWhereInput {
    return {
      AND: [
        this.discoveryListBaseWhere(tenantId, principalId),
        discoveryRetentionWhere(),
        discoveryCatalogExistsWhere(catalogItemIds),
        this.buildKeysetWhere(decodedCursor),
      ],
    };
  }

  private buildDiscoveryListMeta(
    page: { accepted_at: Date; key: string }[],
    hasNextPage: boolean,
  ): ListCursorPageMetaDto {
    const meta: ListCursorPageMetaDto = {
      limit: GUARDED_PRICE_DISCOVERY_PAGE_SIZE,
      hasNextPage,
      nextCursor: null,
    };
    if (hasNextPage && page.length > 0) {
      const tail = page[page.length - 1];
      meta.nextCursor = encodePriceOperationDiscoveryCursor({
        acceptedAt: tail.accepted_at.toISOString(),
        key: tail.key,
      });
    }
    return meta;
  }

  async getOperation(key: string): Promise<InventoryPriceOperationDto> {
    this.assertInventoryPriceRole();
    if (!isUuidV7(key)) {
      guardedRequestInvalid('Operation key must be a UUIDv7.');
    }
    const tenantId = await this.tenantContext.getTenantId();
    const principalId = this.requirePrincipalId();

    const catalogItemIds = await this.loadCatalogItemIds(tenantId);
    const row = await this.prisma.inventoryPriceOperation.findFirst({
      where: {
        AND: [
          { tenant_id: tenantId, principal_id: principalId, key },
          discoveryRetentionWhere(),
          discoveryCatalogExistsWhere(catalogItemIds),
        ],
      },
    });
    if (!row || !rowWithinRetention(row)) {
      throw new NotFoundException(`Price operation ${key} not found`);
    }

    return mapInventoryPriceOperation(row);
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
