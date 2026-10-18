import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Injectable()
export class StockTransferSiteLockService {
  /**
   * Ruling 41: two-site writes lock both site rows in globally sorted id
   * order, then recheck `is_active` and the shared legal entity before
   * mutating anything.
   */
  async lockSites(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteIds: string[],
  ) {
    const sorted = [...new Set(siteIds)].sort();
    // eslint-disable-next-line no-restricted-syntax -- ADR-0021/0022 lock hierarchy requires sorted site-row locks.
    await tx.$queryRaw`
      SELECT id
      FROM "sites"
      WHERE tenant_id = ${tenantId}
        AND id IN (${Prisma.join(sorted)})
      ORDER BY id
      FOR UPDATE
    `;
    const sites = await tx.site.findMany({
      where: { tenant_id: tenantId, id: { in: sorted } },
      select: { id: true, is_active: true, legal_entity_id: true },
    });
    if (sites.length !== sorted.length) {
      throw new NotFoundException('Site not found in this tenant');
    }
    if (sites.some((site) => !site.is_active)) {
      throw new UnprocessableEntityException(
        'Both transfer endpoint sites must be active.',
      );
    }
    return sites;
  }

  async lockSitesForTransfer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    transfer: { from_site_id: string; to_site_id: string },
  ) {
    const sites = await this.lockSites(tx, tenantId, [
      transfer.from_site_id,
      transfer.to_site_id,
    ]);
    const fromSite = sites.find((site) => site.id === transfer.from_site_id)!;
    const toSite = sites.find((site) => site.id === transfer.to_site_id)!;
    if (fromSite.legal_entity_id !== toSite.legal_entity_id) {
      throw new UnprocessableEntityException(
        'Stock transfers cannot cross legal entities (same-GmbH only).',
      );
    }
    return sites;
  }
}
