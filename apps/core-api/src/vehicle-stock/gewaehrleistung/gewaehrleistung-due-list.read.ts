import { Injectable } from '@nestjs/common';
import { SiteContextService } from '../../common/services/site-context.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { GewaehrleistungDueListQueryDto } from '../dto/gewaehrleistung-due-list.dto.js';
import { gewaehrleistungDueSaleSelect } from './gewaehrleistung-due.select.js';
import {
  gewaehrleistungDueWindow,
  viennaIsoDay,
} from './gewaehrleistung-status.js';

/** Gewährleistung-due query with MCP customer.type select (keeps vehicle-stock-query.service unchanged). */
@Injectable()
export class GewaehrleistungDueListReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async list(query: GewaehrleistungDueListQueryDto) {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const { windowStart, windowEnd } = gewaehrleistungDueWindow(
      viennaIsoDay(new Date()),
      query.endsWithinDays,
    );

    const data = await this.prisma.vehicleSale.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        vehicle: { is: { tenant_id: tenantId, site_id: siteId } },
        customer: { is: { tenant_id: tenantId } },
        status: 'INVOICED',
        buyer_is_consumer: true,
        gewaehrleistung_ends_on: { gte: windowStart, lte: windowEnd },
      },
      select: gewaehrleistungDueSaleSelect,
      orderBy: [{ gewaehrleistung_ends_on: 'asc' }, { id: 'asc' }],
    });

    return {
      data,
      meta: {
        total: data.length,
        page: 1,
        pageSize: data.length,
        pageCount: data.length === 0 ? 0 : 1,
      },
    };
  }
}
