import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { legacyAccessOfRole } from '../../permissions/permission-resolver.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SiteContextService } from '../../site/site-context.service.js';
import type { CustomerActivityQueryDto } from '../dto/customer-activity-query.dto.js';
import type { CustomerActivityResponseDto } from '../dto/customer-activity-response.dto.js';
import { createCustomerActivityAdapters } from './customer-activity.adapters.js';
import {
  compareActivityItemsDesc,
  decodeActivityCursor,
  encodeActivityCursor,
  parseActivityTypesFilter,
  resolveActivityLimit,
} from './customer-activity.cursor.js';
import type {
  CustomerActivityFetchContext,
  CustomerActivitySourceAdapter,
} from './customer-activity.types.js';

@Injectable()
export class CustomerActivityService {
  private readonly adapters: readonly CustomerActivitySourceAdapter[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {
    this.adapters = createCustomerActivityAdapters(this.prisma);
  }

  async getActivity(
    customerId: string,
    query: CustomerActivityQueryDto,
  ): Promise<CustomerActivityResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenant_id: tenantId },
      select: { id: true, email: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }

    const limit = resolveActivityLimit(query.limit);
    const cursor = decodeActivityCursor(query.cursor);
    const typeFilter = parseActivityTypesFilter(query.types);
    const access = legacyAccessOfRole(
      this.tenantContext.getAuthenticatedUser()?.role,
    );

    const activeAdapters = this.adapters.filter(
      (adapter) =>
        adapter.isPermitted(access) &&
        (!typeFilter || typeFilter.has(adapter.type)),
    );

    if (activeAdapters.length === 0) {
      return {
        data: [],
        meta: { nextCursor: null, hasNextPage: false, limit },
      };
    }

    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const context = this.buildFetchContext(
      tenantId,
      customer.id,
      customer.email,
      authorizedSiteIds,
    );

    const batches = await Promise.all(
      activeAdapters.map((adapter) =>
        adapter.fetchItems(context, cursor, limit + 1),
      ),
    );
    const merged = batches.flat().sort(compareActivityItemsDesc);
    const hasNextPage = merged.length > limit;
    const data = merged.slice(0, limit);
    const last = data.at(-1);

    return {
      data,
      meta: {
        nextCursor:
          hasNextPage && last
            ? encodeActivityCursor({
                occurredAt: new Date(last.occurred_at),
                type: last.type,
                id: last.id,
              })
            : null,
        hasNextPage,
        limit,
      },
    };
  }

  private buildFetchContext(
    tenantId: string,
    customerId: string,
    customerEmail: string | null,
    authorizedSiteIds: readonly string[],
  ): CustomerActivityFetchContext {
    let cachedVehicleIds: Promise<readonly string[]> | undefined;
    return {
      tenantId,
      customerId,
      customerEmail,
      authorizedSiteIds,
      getVehicleIds: () => {
        if (!cachedVehicleIds) {
          cachedVehicleIds = this.resolveCustomerVehicleIds(
            tenantId,
            customerId,
          );
        }
        return cachedVehicleIds;
      },
    };
  }

  private async resolveCustomerVehicleIds(
    tenantId: string,
    customerId: string,
  ): Promise<readonly string[]> {
    const [directVehicles, partyLinks] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: { tenant_id: tenantId, customer_id: customerId },
        select: { id: true },
      }),
      this.prisma.vehicleParty.findMany({
        where: { tenant_id: tenantId, customer_id: customerId },
        select: { vehicle_id: true },
      }),
    ]);
    return [
      ...new Set([
        ...directVehicles.map((v) => v.id),
        ...partyLinks.map((p) => p.vehicle_id),
      ]),
    ];
  }
}
