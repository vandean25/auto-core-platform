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
} from './guarded-price-discovery-cursor.js';
import { discoveryRetentionWhere } from './guarded-price-discovery-query.js';
import { discoveryCatalogItemExists } from './guarded-price-discovery-catalog-exists.js';
import { fetchGuardedPriceDiscoveryPage } from './guarded-price-discovery-list.js';
import { mapInventoryPriceOperation } from './guarded-price-operation.mapper.js';
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

    const { page, hasNextPage, scanTail } =
      await fetchGuardedPriceDiscoveryPage(
        this.prisma,
        tenantId,
        principalId,
        decodedCursor,
      );

    const meta: ListCursorPageMetaDto = {
      limit: GUARDED_PRICE_DISCOVERY_PAGE_SIZE,
      hasNextPage,
      nextCursor:
        hasNextPage && scanTail
          ? encodePriceOperationDiscoveryCursor({
              acceptedAt: scanTail.accepted_at.toISOString(),
              key: scanTail.key,
            })
          : null,
    };
    return { data: page.map(mapInventoryPriceOperation), meta };
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
