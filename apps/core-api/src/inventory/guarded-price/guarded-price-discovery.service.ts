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
import { discoveryRetentionWhere } from './guarded-price-discovery-query.js';
import {
  discoveryCatalogItemExists,
  filterDiscoveryRowsWithExistingCatalog,
} from './guarded-price-discovery-catalog-exists.js';
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
    const collected: Awaited<
      ReturnType<PrismaService['inventoryPriceOperation']['findMany']>
    > = [];
    let scanCursor = decodedCursor;
    let journalBatchWasFull = false;
    const maxScans = 32;

    for (let scan = 0; scan < maxScans; scan++) {
      const batch = await this.prisma.inventoryPriceOperation.findMany({
        where: this.discoveryListWhere(tenantId, principalId, scanCursor),
        orderBy: [{ accepted_at: 'desc' }, { key: 'desc' }],
        take: GUARDED_PRICE_DISCOVERY_PAGE_SIZE + 1,
      });

      if (batch.length === 0) {
        journalBatchWasFull = false;
        break;
      }

      journalBatchWasFull = batch.length > GUARDED_PRICE_DISCOVERY_PAGE_SIZE;

      const retentionVisible = batch.filter((row) => rowWithinRetention(row));
      const withCatalog = await filterDiscoveryRowsWithExistingCatalog(
        this.prisma,
        tenantId,
        retentionVisible,
      );

      for (const row of withCatalog) {
        collected.push(row);
        if (collected.length > GUARDED_PRICE_DISCOVERY_PAGE_SIZE) {
          break;
        }
      }

      if (collected.length > GUARDED_PRICE_DISCOVERY_PAGE_SIZE) {
        break;
      }
      if (!journalBatchWasFull) {
        break;
      }

      const tail = batch[batch.length - 1];
      scanCursor = {
        acceptedAt: tail.accepted_at.toISOString(),
        key: tail.key,
      };
    }

    const hasNextPage =
      collected.length > GUARDED_PRICE_DISCOVERY_PAGE_SIZE ||
      (collected.length === GUARDED_PRICE_DISCOVERY_PAGE_SIZE &&
        journalBatchWasFull);
    const page = collected.slice(0, GUARDED_PRICE_DISCOVERY_PAGE_SIZE);

    return { page, hasNextPage };
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

  private discoveryListWhere(
    tenantId: string,
    principalId: string,
    decodedCursor: PriceOperationDiscoveryCursor | null,
  ): Prisma.InventoryPriceOperationWhereInput {
    return {
      AND: [
        this.discoveryListBaseWhere(tenantId, principalId),
        discoveryRetentionWhere(),
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
