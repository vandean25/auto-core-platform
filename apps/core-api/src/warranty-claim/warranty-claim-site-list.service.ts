import { Injectable, NotFoundException } from '@nestjs/common';
import type { WarrantyClaimStatus, WarrantyClaimType } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import type { WarrantyClaimResponse } from './warranty-claim.mapper.js';
import { listWarrantyClaimsAtActiveSite } from './warranty-claim-site-list.js';

@Injectable()
export class WarrantyClaimSiteListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async listAtActiveSite(params: {
    workshopOrderId?: string;
    statuses?: WarrantyClaimStatus[];
    type?: WarrantyClaimType;
    pageSize: number;
    cursorCreatedAt?: Date;
    cursorId?: string;
  }): Promise<{ rows: WarrantyClaimResponse[]; total: number }> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    if (params.workshopOrderId) {
      const order = await this.prisma.workshopOrder.findFirst({
        where: {
          id: params.workshopOrderId,
          tenant_id: tenantId,
          site_id: siteId,
        },
        select: { id: true },
      });
      if (!order) {
        throw new NotFoundException(
          `Workshop order ${params.workshopOrderId} not found`,
        );
      }
    }
    return listWarrantyClaimsAtActiveSite(
      this.prisma,
      tenantId,
      siteId,
      params,
    );
  }
}
