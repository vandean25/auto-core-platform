import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { countParkedVehicles } from './site.helpers.js';

export class SiteDeactivationGuardService {
  constructor(private readonly prisma: PrismaService) {}

  async guardSiteDeactivation(tenantId: string, siteId: string) {
    const [stockQty, parkedVehicles, openTransfers] = await Promise.all([
      this.prisma.inventoryStock.count({
        where: {
          tenant_id: tenantId,
          location: { site_id: siteId },
          OR: [
            { quantity_on_hand: { gt: 0 } },
            { quantity_reserved: { gt: 0 } },
          ],
        },
      }),
      countParkedVehicles(this.prisma, tenantId, siteId),
      this.prisma.stockTransfer.count({
        where: {
          tenant_id: tenantId,
          OR: [{ from_site_id: siteId }, { to_site_id: siteId }],
          status: { notIn: ['COMPLETED', 'REJECTED', 'CANCELLED'] },
        },
      }),
    ]);

    if (openTransfers > 0) {
      throw new ConflictException(
        'Cannot deactivate a site with open stock transfers. Complete, reject, or cancel them first.',
      );
    }
    if (stockQty > 0) {
      throw new ConflictException(
        'Cannot deactivate a site with on-hand or reserved stock at its locations.',
      );
    }
    if (parkedVehicles > 0) {
      throw new ConflictException(
        'Cannot deactivate a site with parked dealer vehicles on a lot at this site.',
      );
    }
  }
}
