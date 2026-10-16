import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WorkshopEstimateStatus,
  type WorkshopOrderStatus,
} from '@prisma/client';
import type { z } from 'zod';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  buildWorkshopOrderFindAllWhere,
  buildWorkshopOrderOrderBy,
  LIVE_ORDER_STATUSES,
  ORDER_WITH_RELATIONS,
} from '../workshop/workshop-intake-query.helpers.js';
import type { WorkshopOrderWithRelations } from '../workshop/workshop-order.helpers.js';
import {
  clampMcpPage,
  clampMcpPageSize,
  toMcpJsonObject,
} from './mcp-output.util.js';
import {
  isInstantInSiteLocalDateRange,
  matchesEstimateStatusFilter,
  siteLocalInclusiveDateRange,
  toMcpWorkshopOrderListRow,
  type CurrentEstimateVersionRow,
  type McpEstimateStatusFilter,
} from './mcp-workshop-order-read.mapper.js';
import type { listWorkshopOrdersInputSchema } from './mcp-tool-schemas.js';

type ListWorkshopOrdersInput = z.infer<typeof listWorkshopOrdersInputSchema>;

const CURRENT_VERSION_SELECT = {
  id: true,
  version: true,
  status: true,
  sent_at: true,
  valid_until: true,
  total_gross: true,
  estimate: {
    select: {
      estimate_number: true,
      workshop_order_id: true,
    },
  },
} satisfies Prisma.WorkshopEstimateVersionSelect;

const EMPTY_PAGE = {
  data: [] as ReturnType<typeof toMcpWorkshopOrderListRow>[],
  meta: { total: 0, page: 1, page_size: 10 },
};

/**
 * Workshop order list for MCP. Tenant and active site come from the session only.
 * Estimate filters use each estimate's newest non-superseded version; date bounds
 * are inclusive site-local days.
 */
@Injectable()
export class McpWorkshopOrderReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async listWorkshopOrders(input: ListWorkshopOrdersInput) {
    const page = clampMcpPage(input.page);
    const pageSize = clampMcpPageSize(input.pageSize);
    const skip = (page - 1) * pageSize;
    const { tenantId, siteId, timeZone } = await this.scope();

    const scheduledRange = siteLocalInclusiveDateRange(
      input.scheduled_from,
      input.scheduled_to,
      timeZone,
    );
    const sentRange = siteLocalInclusiveDateRange(
      input.sent_from,
      input.sent_to,
      timeZone,
    );

    const estimateOrderIds = await this.resolveEstimateFilteredOrderIds({
      tenantId,
      siteId,
      estimateStatus: input.estimate_status,
      sentRange,
    });
    if (estimateOrderIds !== null && estimateOrderIds.length === 0) {
      return { ...EMPTY_PAGE, meta: { total: 0, page, page_size: pageSize } };
    }

    const where = this.buildOrderWhere({
      tenantId,
      siteId,
      search: input.search,
      customerId: input.customer_id,
      statuses: input.status,
      scheduledRange,
      estimateOrderIds,
    });

    const orderBy = buildWorkshopOrderOrderBy(undefined, 'desc');
    const [records, total] = await Promise.all([
      this.prisma.workshopOrder.findMany({
        where,
        include: ORDER_WITH_RELATIONS,
        skip,
        take: pageSize,
        orderBy,
      }),
      this.prisma.workshopOrder.count({ where }),
    ]);

    const estimatesByOrderId = await this.loadCurrentEstimatesByOrderId(
      tenantId,
      siteId,
      records.map((row) => row.id),
    );

    const now = new Date();
    const data = records.map((row) =>
      toMcpWorkshopOrderListRow(
        row as WorkshopOrderWithRelations,
        estimatesByOrderId.get(row.id) ?? null,
        now,
      ),
    );

    return {
      data: data.map((row) => toMcpJsonObject(row)),
      meta: { total, page, page_size: pageSize },
    };
  }

  private buildOrderWhere(input: {
    tenantId: string;
    siteId: string;
    search?: string;
    customerId?: string;
    statuses?: WorkshopOrderStatus[];
    scheduledRange: { gte: Date; lt: Date } | null;
    estimateOrderIds: string[] | null;
  }): Prisma.WorkshopOrderWhereInput {
    const where = buildWorkshopOrderFindAllWhere(
      input.tenantId,
      input.siteId,
      input.search,
    );
    if (input.customerId) {
      where.customer_id = input.customerId;
      where.status = { in: LIVE_ORDER_STATUSES };
    } else if (input.statuses?.length) {
      where.status = { in: input.statuses };
    }
    if (input.scheduledRange) {
      where.scheduled_start_at = {
        gte: input.scheduledRange.gte,
        lt: input.scheduledRange.lt,
      };
    }
    if (input.estimateOrderIds) {
      where.id = { in: input.estimateOrderIds };
    }
    return where;
  }

  private async resolveEstimateFilteredOrderIds(input: {
    tenantId: string;
    siteId: string;
    estimateStatus?: McpEstimateStatusFilter;
    sentRange: { gte: Date; lt: Date } | null;
  }): Promise<string[] | null> {
    if (!input.estimateStatus && !input.sentRange) {
      return null;
    }

    const currentVersions = await this.loadCurrentEstimateVersions(
      input.tenantId,
      input.siteId,
    );
    const now = new Date();
    const orderIds: string[] = [];
    for (const version of currentVersions) {
      if (
        input.estimateStatus &&
        !matchesEstimateStatusFilter(version, input.estimateStatus, now)
      ) {
        continue;
      }
      if (
        input.sentRange &&
        !isInstantInSiteLocalDateRange(version.sent_at, input.sentRange)
      ) {
        continue;
      }
      orderIds.push(version.estimate.workshop_order_id);
    }
    return orderIds;
  }

  private async loadCurrentEstimatesByOrderId(
    tenantId: string,
    siteId: string,
    orderIds: string[],
  ): Promise<Map<string, CurrentEstimateVersionRow>> {
    if (orderIds.length === 0) {
      return new Map();
    }
    const versions = await this.loadCurrentEstimateVersions(tenantId, siteId, {
      workshopOrderIds: orderIds,
    });
    const map = new Map<string, CurrentEstimateVersionRow>();
    for (const version of versions) {
      map.set(version.estimate.workshop_order_id, version);
    }
    return map;
  }

  private async loadCurrentEstimateVersions(
    tenantId: string,
    siteId: string,
    scope?: { workshopOrderIds: string[] },
  ): Promise<CurrentEstimateVersionRow[]> {
    const grouped = await this.prisma.workshopEstimateVersion.groupBy({
      by: ['estimate_id'],
      where: {
        tenant_id: tenantId,
        status: { not: WorkshopEstimateStatus.SUPERSEDED },
        estimate: {
          site_id: siteId,
          ...(scope
            ? { workshop_order_id: { in: scope.workshopOrderIds } }
            : {}),
        },
      },
      _max: { version: true },
    });
    if (grouped.length === 0) {
      return [];
    }

    const versions = await this.prisma.workshopEstimateVersion.findMany({
      where: {
        tenant_id: tenantId,
        OR: grouped.map((row) => ({
          estimate_id: row.estimate_id,
          version: row._max.version ?? 0,
        })),
      },
      select: CURRENT_VERSION_SELECT,
    });
    return versions as CurrentEstimateVersionRow[];
  }

  private async scope() {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const site = await this.prisma.site.findFirst({
      where: { tenant_id: tenantId, id: siteId },
      select: { timezone: true },
    });
    if (!site) {
      throw new NotFoundException('Active site not found');
    }
    if (!site.timezone) {
      throw new BadRequestException('active site timezone is not configured');
    }
    return { tenantId, siteId, timeZone: site.timezone };
  }
}
