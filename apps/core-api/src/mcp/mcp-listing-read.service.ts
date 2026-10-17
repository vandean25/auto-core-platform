import { Injectable, NotFoundException } from '@nestjs/common';
import { VehicleListingExportState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { findReceivedStockPurchaseIdForActiveSite } from '../vehicle/equipment/vehicle-equipment-stock-cycle.js';
import {
  toMcpVehicleListingStatus,
  type VehicleListingWithChannels,
} from './mcp-listing-read.mapper.js';
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

    const stockPurchaseId = await findReceivedStockPurchaseIdForActiveSite(
      this.prisma,
      tenantId,
      input.vehicle_id,
      siteId,
    );

    const listingsById = new Map<string, VehicleListingWithChannels>();

    if (stockPurchaseId) {
      const current = await this.prisma.vehicleListing.findFirst({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          vehicle_id: input.vehicle_id,
          stock_purchase_id: stockPurchaseId,
        },
        include: { channels: true },
      });
      if (current) {
        listingsById.set(current.id, current);
      }
    }

    if (listingsById.size === 0) {
      const atActiveSite = await this.prisma.vehicleListing.findFirst({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          vehicle_id: input.vehicle_id,
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        include: { channels: true },
      });
      if (atActiveSite) {
        listingsById.set(atActiveSite.id, atActiveSite);
      }
    }

    const pendingRemoval = await this.prisma.vehicleListing.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        vehicle_id: input.vehicle_id,
        channels: {
          some: { export_state: VehicleListingExportState.REMOVAL_REQUIRED },
        },
        ...(listingsById.size > 0
          ? { id: { notIn: [...listingsById.keys()] } }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      include: { channels: true },
    });

    for (const listing of pendingRemoval) {
      listingsById.set(listing.id, listing);
    }

    const listings = [...listingsById.values()];
    if (listings.length === 0) {
      throw new NotFoundException({
        code: 'VEHICLE_LISTING_NOT_FOUND',
        message:
          'No marketplace listing exists for this vehicle at the active site.',
      });
    }

    listings.sort((a, b) => {
      const aCurrent =
        stockPurchaseId !== null && a.stock_purchase_id === stockPurchaseId
          ? 0
          : 1;
      const bCurrent =
        stockPurchaseId !== null && b.stock_purchase_id === stockPurchaseId
          ? 0
          : 1;
      if (aCurrent !== bCurrent) {
        return aCurrent - bCurrent;
      }
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    return toMcpVehicleListingStatus(input.vehicle_id, listings);
  }
}
