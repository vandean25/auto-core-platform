import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { toMcpVehicleListingStatus } from './mcp-listing-read.mapper.js';
import type { getVehicleListingStatusInputSchema } from './mcp-tool-schemas.js';
import type { z } from 'zod';

type ListingStatusInput = z.infer<typeof getVehicleListingStatusInputSchema>;

@Injectable()
export class McpListingReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async getVehicleListingStatus(input: ListingStatusInput) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();

    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: input.vehicle_id, tenant_id: tenantId },
      select: { id: true },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${input.vehicle_id} not found`);
    }

    const listing = await this.prisma.vehicleListing.findFirst({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        vehicle_id: input.vehicle_id,
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      include: { channels: true },
    });
    if (!listing) {
      throw new NotFoundException({
        code: 'VEHICLE_LISTING_NOT_FOUND',
        message:
          'No marketplace listing exists for this vehicle at the active site.',
      });
    }

    return toMcpVehicleListingStatus(input.vehicle_id, listing);
  }
}
