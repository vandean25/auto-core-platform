import { Injectable, NotFoundException } from '@nestjs/common';
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
import { discoveryRetentionWhere } from './guarded-price-discovery-query.js';
import { discoveryCatalogItemExists } from './guarded-price-discovery-catalog-exists.js';
import { fetchGuardedPriceDiscoveryPage } from './guarded-price-discovery-list.js';
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

    const { page, hasNextPage } = await this.loadDiscoveryPage(
      tenantId,
      principalId,
      decodedCursor,
    );

    return {
      data: page.map(mapInventoryPriceOperation),
      meta: this.buildDiscoveryListMeta(page, hasNextPage),
    };
  }

  private async loadDiscoveryPage(
    tenantId: string,
    principalId: string,
    decodedCursor: PriceOperationDiscoveryCursor | null,
  ): Promise<{
    page: Awaited<
      ReturnType<PrismaService['inventoryPriceOperation']['findMany']>
    >;
    hasNextPage: boolean;
  }> {
    const rows = await fetchGuardedPriceDiscoveryPage(
      this.prisma,
      tenantId,
      principalId,
      decodedCursor,
    );
    const hasNextPage = rows.length > GUARDED_PRICE_DISCOVERY_PAGE_SIZE;
    const page = rows.slice(0, GUARDED_PRICE_DISCOVERY_PAGE_SIZE);
    return { page, hasNextPage };
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

    const row = await this.prisma.inventoryPriceOperation.findFirst({
      where: {
        AND: [
          { tenant_id: tenantId, principal_id: principalId, key },
          discoveryRetentionWhere(),
        ],
      },
    });
    if (
      !row ||
      !rowWithinRetention(row) ||
      !(await discoveryCatalogItemExists(this.prisma, tenantId, row.item_id))
    ) {
      throw new NotFoundException(`Price operation ${key} not found`);
    }

    return mapInventoryPriceOperation(row);
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
