import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import { assertBackOfficeAccess } from '../parts-requisition/parts-requisition-lifecycle.helpers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import {
  assertCostBasisMatches,
  indexVendorArticlesByCatalogItem,
  resolvePurchaseLineCost,
} from './purchase-propose-draft.cost.js';
import {
  proposePurchaseOrderInputSchema,
  type ProposePurchaseOrderInput,
} from './purchase-propose-draft.schema.js';

export const PURCHASE_PROPOSE_DISCLAIMER =
  'Preview amounts and unit costs are built from tenant catalog and supplier article data only; supplier CSV price lists do not guarantee part fitment.';

export type PurchaseProposeDraftResult = {
  id: string;
  entityId: string;
  purchase_order_id: string;
  status: 'DRAFT';
  vendor: { id: string; name: string };
  site_id: string;
  totals: { net: string };
  lines: Array<{
    reservation_id: string;
    catalog_item_id: string;
    part: { id: string; sku: string; name: string };
    quantity: string;
    unit: string;
    unit_cost_net: string;
    line_net: string;
    cost_source: {
      kind: 'vendor_article' | 'catalog_cost';
      vendor_article_no: string | null;
      verified: true;
    };
  }>;
  disclaimer: string;
};

@Injectable()
export class PurchaseProposeDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly partsRequisition: PartsRequisitionService,
  ) {}

  async buildExecutionContext(): Promise<Record<string, unknown>> {
    const siteId = await this.siteContext.getSiteId();
    const tenantId = await this.tenantContext.getTenantId();
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenant_id: tenantId, is_active: true },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException('Active site not found');
    }
    return { site_id: siteId };
  }

  async applyDraft(
    input: unknown,
    executionContext?: Record<string, unknown>,
  ): Promise<PurchaseProposeDraftResult> {
    assertBackOfficeAccess(this.tenantContext);
    const parsed = proposePurchaseOrderInputSchema.parse(input);
    const tenantId = await this.tenantContext.getTenantId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);

    const expectedSiteId =
      typeof executionContext?.site_id === 'string'
        ? executionContext.site_id
        : await this.siteContext.getSiteId();

    const planned = await this.planDraft(parsed, tenantId, expectedSiteId);

    const dtoItems = planned.lines.map((line) => ({
      reservationId: line.reservation_id,
      unitCost: Number(line.unit_cost_net),
    }));

    const created =
      await this.partsRequisition.createPurchaseOrderForRequisition(
        parsed.requisition_id,
        {
          vendorId: parsed.vendor_id,
          items: dtoItems,
        },
      );

    return this.toResult(created.id, planned);
  }

  private async planDraft(
    parsed: ProposePurchaseOrderInput,
    tenantId: string,
    siteId: string,
  ) {
    const reservationIds = parsed.lines.map((line) => line.reservation_id);
    const uniqueReservationIds = new Set(reservationIds);
    if (uniqueReservationIds.size !== reservationIds.length) {
      throw new UnprocessableEntityException(
        'Duplicate reservation_id in lines',
      );
    }

    const catalogItemIds = [
      ...new Set(parsed.lines.map((line) => line.catalog_item_id)),
    ];

    const [vendor, requisition, reservations, catalogItems, vendorArticles] =
      await Promise.all([
        this.prisma.vendor.findFirst({
          where: { id: parsed.vendor_id, tenant_id: tenantId },
          include: { supportedBrands: true },
        }),
        this.prisma.partsRequisition.findFirst({
          where: { id: parsed.requisition_id, tenant_id: tenantId },
          select: { id: true, status: true },
        }),
        this.prisma.partsReservation.findMany({
          where: { tenant_id: tenantId, id: { in: reservationIds } },
          select: {
            id: true,
            quantity: true,
            status: true,
            kind: true,
            purchase_order_item_id: true,
            requisition_line: { select: { requisition_id: true } },
            workshop_task_line_item: {
              select: {
                catalog_item_id: true,
                catalog_item: {
                  select: { id: true, sku: true, name: true, unit: true },
                },
                workshop_task: {
                  select: {
                    workshop_order: { select: { site_id: true } },
                  },
                },
              },
            },
          },
          orderBy: { id: 'asc' },
        }),
        this.prisma.catalogItem.findMany({
          where: { tenant_id: tenantId, id: { in: catalogItemIds } },
          select: {
            id: true,
            sku: true,
            name: true,
            unit: true,
            cost_price: true,
            brand_id: true,
            brand: { select: { id: true, name: true } },
          },
        }),
        this.prisma.vendorArticle.findMany({
          where: {
            tenant_id: tenantId,
            vendor_id: parsed.vendor_id,
            catalog_item_id: { in: catalogItemIds },
          },
          select: {
            id: true,
            catalog_item_id: true,
            vendor_article_no: true,
            last_cost: true,
            updatedAt: true,
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        }),
      ]);

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }
    if (!requisition) {
      throw new NotFoundException('Parts requisition not found');
    }

    const callerSite = await this.prisma.site.findFirst({
      where: { id: siteId, tenant_id: tenantId, is_active: true },
      select: { id: true },
    });
    if (!callerSite) {
      throw new UnprocessableEntityException(
        'The active site is no longer available',
      );
    }

    if (reservations.length !== reservationIds.length) {
      throw new UnprocessableEntityException(
        'One or more reservation slices were not found.',
      );
    }

    const reservationById = new Map(
      reservations.map((reservation) => [reservation.id, reservation]),
    );
    const catalogById = new Map(
      catalogItems.map((catalogItem) => [catalogItem.id, catalogItem]),
    );
    const vendorArticleByCatalogId =
      indexVendorArticlesByCatalogItem(vendorArticles);

    const previewLines: PurchaseProposeDraftResult['lines'] = [];

    for (const line of parsed.lines) {
      const reservation = reservationById.get(line.reservation_id);
      if (!reservation) {
        throw new UnprocessableEntityException(
          'Reservation slice was not found.',
        );
      }
      const catalogItemId = reservation.workshop_task_line_item.catalog_item_id;
      if (!catalogItemId || catalogItemId !== line.catalog_item_id) {
        throw new UnprocessableEntityException(
          'catalog_item_id does not match the reservation slice demand.',
        );
      }
      if (
        reservation.requisition_line?.requisition_id !== parsed.requisition_id
      ) {
        throw new UnprocessableEntityException(
          'Reservation slice does not belong to this requisition.',
        );
      }
      if (
        reservation.workshop_task_line_item.workshop_task.workshop_order
          .site_id !== siteId
      ) {
        throw new UnprocessableEntityException(
          'Reservation slice is not available in the active site.',
        );
      }
      if (reservation.status !== 'OPEN' && reservation.status !== 'ORDERED') {
        throw new UnprocessableEntityException(
          'Only open or ordered slices can be added to a purchase order.',
        );
      }
      if (reservation.purchase_order_item_id) {
        throw new ConflictException(
          'Reservation slice is already linked to a purchase order item.',
        );
      }
      if (reservation.quantity.lte(0)) {
        throw new UnprocessableEntityException(
          'Reservation quantity must be positive.',
        );
      }

      const catalogItem = catalogById.get(line.catalog_item_id);
      if (!catalogItem) {
        throw new UnprocessableEntityException(
          'Catalog item for the reservation slice is not available.',
        );
      }
      if (
        catalogItem.brand &&
        !vendor.supportedBrands.some(
          (brand) => brand.id === catalogItem.brand_id,
        )
      ) {
        throw new UnprocessableEntityException(
          `Vendor ${vendor.name} does not support brand ${catalogItem.brand.name}.`,
        );
      }

      const resolved = resolvePurchaseLineCost(
        catalogItem,
        vendorArticleByCatalogId.get(catalogItem.id),
      );
      assertCostBasisMatches(line.cost_basis, resolved);

      const quantity = reservation.quantity;
      const lineNet = quantity
        .mul(resolved.unitCostNet)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

      previewLines.push({
        reservation_id: line.reservation_id,
        catalog_item_id: catalogItem.id,
        part: {
          id: catalogItem.id,
          sku: catalogItem.sku,
          name: catalogItem.name,
        },
        quantity: quantity.toFixed(3),
        unit: catalogItem.unit,
        unit_cost_net: resolved.unitCostNet,
        line_net: lineNet.toFixed(2),
        cost_source: resolved.source,
      });
    }

    const totalsNet = previewLines
      .reduce(
        (sum, line) => sum.add(new Prisma.Decimal(line.line_net)),
        new Prisma.Decimal(0),
      )
      .toFixed(2);

    return {
      vendor: { id: vendor.id, name: vendor.name },
      site_id: siteId,
      totals: { net: totalsNet },
      lines: previewLines,
    };
  }

  private toResult(
    purchaseOrderId: string,
    planned: {
      vendor: { id: string; name: string };
      site_id: string;
      totals: { net: string };
      lines: PurchaseProposeDraftResult['lines'];
    },
  ): PurchaseProposeDraftResult {
    return {
      id: purchaseOrderId,
      entityId: purchaseOrderId,
      purchase_order_id: purchaseOrderId,
      status: 'DRAFT',
      vendor: planned.vendor,
      site_id: planned.site_id,
      totals: planned.totals,
      lines: planned.lines,
      disclaimer: PURCHASE_PROPOSE_DISCLAIMER,
    };
  }
}
