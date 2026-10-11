import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { WarrantyClaimType } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DocumentBrandingAssetStorage } from '../document-branding/document-branding-asset-storage.js';
import { brandRenderInputUnavailable } from '../invoices/invoice-pdf-branding.helpers.js';
import { resolveBrandingSnapshot } from '../invoices/invoice-snapshot-v2.helpers.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { toWarrantyClaimResponse } from './warranty-claim.mapper.js';
import type { WarrantyClaimPdfContent } from './warranty-claim-pdf.layout.js';
import { WarrantyClaimPdfRenderer } from './warranty-claim-pdf.renderer.js';
import { assertWarrantyClaimAccess } from './warranty-claim.rules.js';

type ResolvedBranding = Awaited<ReturnType<typeof resolveBrandingSnapshot>>;

const LOGO_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
]);

const TYPE_FILE_SLUGS: Record<WarrantyClaimType, string> = {
  GARANTIE: 'garantie',
  KULANZ: 'kulanz',
  GEWAEHRLEISTUNG: 'gewaehrleistung',
};

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'order'
  );
}

/**
 * Printable claim summary (AUT-464). Rendered on request, not archived: the PDF always reflects the
 * stored claim. Branding comes from the document-branding pipeline for the order's legal entity.
 */
@Injectable()
export class WarrantyClaimPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly renderer: WarrantyClaimPdfRenderer,
    private readonly brandingStorage: DocumentBrandingAssetStorage,
  ) {}

  async render(
    orderId: string,
    claimId: string,
  ): Promise<{ bytes: Buffer; filename: string }> {
    assertWarrantyClaimAccess(this.tenantContext);
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);

    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      select: {
        order_number: true,
        odometer: true,
        vehicle: {
          select: { make: true, model: true, vin: true, plate: true },
        },
        site: {
          select: {
            legal_entity: {
              select: {
                id: true,
                name: true,
                address_street: true,
                address_zip: true,
                address_city: true,
                vat_id: true,
              },
            },
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`Workshop order ${orderId} not found`);
    }
    const legalEntity = order.site?.legal_entity;
    if (!legalEntity) {
      throw new UnprocessableEntityException({
        code: 'SELLER_IDENTITY_INCOMPLETE',
        message:
          'The workshop order has no legal entity for the document header.',
      });
    }

    const claimRow = await this.prisma.warrantyClaim.findFirst({
      where: { id: claimId, tenant_id: tenantId, workshop_order_id: orderId },
      include: {
        lines: {
          where: { tenant_id: tenantId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!claimRow) {
      throw new NotFoundException(`Warranty claim ${claimId} not found`);
    }

    const branding = await this.prisma.$transaction((tx) =>
      resolveBrandingSnapshot(tx, tenantId, legalEntity.id, new Date(), {
        lockLogo: false,
      }),
    );
    const claim = toWarrantyClaimResponse(claimRow);
    const content: WarrantyClaimPdfContent = {
      claim,
      order: {
        orderNumber: order.order_number,
        odometer: order.odometer,
        vehicle: {
          make: order.vehicle.make,
          model: order.vehicle.model,
          vin: order.vehicle.vin,
          plate: order.vehicle.plate ?? null,
        },
      },
      seller: {
        name: legalEntity.name,
        addressLines: [
          legalEntity.address_street,
          [legalEntity.address_zip, legalEntity.address_city]
            .filter(Boolean)
            .join(' '),
        ].filter((line): line is string => Boolean(line)),
        vatId: legalEntity.vat_id ?? null,
      },
      tokens: {
        primaryColor: branding.tokens.primary_color,
        secondaryColor: branding.tokens.secondary_color,
      },
      logoDataUrl: await this.loadLogoDataUrl(branding),
      generatedAt: new Date(),
    };

    const bytes = await this.renderer.render(content);
    const filename = `${TYPE_FILE_SLUGS[claim.type]}-${slugify(order.order_number)}-${claim.id.slice(0, 8)}.pdf`;
    return { bytes, filename };
  }

  private async loadLogoDataUrl(
    branding: ResolvedBranding,
  ): Promise<string | null> {
    const logo = branding.logo;
    if (!logo) return null;
    if (!LOGO_MIME_TYPES.has(logo.mime_type)) {
      throw brandRenderInputUnavailable();
    }
    const bytes = await this.brandingStorage.readGeneration(
      logo.bucket,
      logo.key,
      logo.generation,
    );
    if (createHash('sha256').update(bytes).digest('hex') !== logo.sha256) {
      throw brandRenderInputUnavailable();
    }
    return `data:${logo.mime_type};base64,${bytes.toString('base64')}`;
  }
}
