import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { assertPersistedSiteId } from '../site/document-retarget.helpers.js';

export type ResolvedInvoiceOwnership = {
  siteId: string;
  legalEntityId: string;
};

export async function resolveInvoiceOwnershipFromSource(
  tx: Prisma.TransactionClient,
  tenantId: string,
  invoice: {
    sales_order_id: string | null;
    workshop_order_id: string | null;
    vehicle_sale_id: string | null;
  },
): Promise<ResolvedInvoiceOwnership> {
  if (invoice.sales_order_id) {
    const order = await tx.salesOrder.findFirst({
      where: { id: invoice.sales_order_id, tenant_id: tenantId },
      select: { site_id: true },
    });
    if (!order) {
      throw new NotFoundException('Sales order not found');
    }
    const orderSiteId = assertPersistedSiteId(
      order.site_id,
      'Sales order site ownership is required',
    );
    const site = await tx.site.findFirst({
      where: { id: orderSiteId, tenant_id: tenantId },
      select: { id: true, legal_entity_id: true },
    });
    if (!site) {
      throw new NotFoundException('Sales order site not found');
    }
    return { siteId: site.id, legalEntityId: site.legal_entity_id };
  }

  if (invoice.workshop_order_id) {
    const order = await tx.workshopOrder.findFirst({
      where: { id: invoice.workshop_order_id, tenant_id: tenantId },
      select: { site_id: true },
    });
    if (!order) {
      throw new NotFoundException('Workshop order not found');
    }
    const orderSiteId = assertPersistedSiteId(
      order.site_id,
      'Workshop order site ownership is required',
    );
    const site = await tx.site.findFirst({
      where: { id: orderSiteId, tenant_id: tenantId },
      select: { id: true, legal_entity_id: true },
    });
    if (!site) {
      throw new NotFoundException('Workshop order site not found');
    }
    return { siteId: site.id, legalEntityId: site.legal_entity_id };
  }

  if (invoice.vehicle_sale_id) {
    const sale = await tx.vehicleSale.findFirst({
      where: { id: invoice.vehicle_sale_id, tenant_id: tenantId },
      select: { site_id: true },
    });
    if (!sale) {
      throw new NotFoundException('Vehicle sale not found');
    }
    const saleSiteId = assertPersistedSiteId(
      sale.site_id,
      'Vehicle sale site ownership is required',
    );
    const site = await tx.site.findFirst({
      where: { id: saleSiteId, tenant_id: tenantId },
      select: { id: true, legal_entity_id: true },
    });
    if (!site) {
      throw new NotFoundException('Vehicle sale site not found');
    }
    return { siteId: site.id, legalEntityId: site.legal_entity_id };
  }

  throw new BadRequestException({
    code: 'SOURCE_DOCUMENT_REQUIRED',
    message:
      'Invoice issuance requires a source document with persisted site ownership.',
  });
}
