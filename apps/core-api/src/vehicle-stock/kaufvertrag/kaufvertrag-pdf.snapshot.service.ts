import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { resolveBrandingSnapshot } from '../../invoices/invoice-snapshot-v2.helpers.js';
import { buildSellerSnapshot } from '../../invoices/invoice-snapshot-v2.js';
import {
  loadTenantDefaultLocale,
  resolveCustomerDocumentLanguage,
} from '../../common/i18n/customer-document-language.js';
import {
  assertKaufvertragSaleEligible,
  resolveKaufvertragGewaehrleistung,
} from './kaufvertrag-facts.js';
import {
  buildKaufvertragSnapshot,
  hashKaufvertragSnapshot,
  toKaufvertragSnapshotBranding,
  type KaufvertragSnapshot,
  type KaufvertragSnapshotBranding,
  type KaufvertragSnapshotBuyer,
} from './kaufvertrag-snapshot.js';

const SALE_INCLUDE = {
  vehicle: true,
  customer: true,
  site: { include: { legal_entity: true } },
} satisfies Prisma.VehicleSaleInclude;

export type LoadedSale = Prisma.VehicleSaleGetPayload<{
  include: typeof SALE_INCLUDE;
}>;

export type PreparedKaufvertrag = {
  snapshot: KaufvertragSnapshot;
  snapshotSha256: string;
};

function buyerSnapshot(
  customer: LoadedSale['customer'],
): KaufvertragSnapshotBuyer {
  return {
    type: customer.type,
    company_name: customer.company_name ?? null,
    first_name: customer.first_name,
    last_name: customer.last_name,
    vat_id: customer.vat_id ?? null,
    address_street: customer.address_street ?? null,
    address_zip: customer.address_zip ?? null,
    address_city: customer.address_city ?? null,
    address_country: customer.address_country ?? null,
  };
}

type SnapshotParts = {
  vin: string;
  seller: Parameters<typeof buildSellerSnapshot>[0];
  warranty: ReturnType<typeof resolveKaufvertragGewaehrleistung>;
  branding: KaufvertragSnapshotBranding;
  documentLocale: KaufvertragSnapshot['document_locale'];
};

/** Puts the guarded facts of a sale into the frozen snapshot shape the PDF is rendered from. */
function assembleSnapshot(
  sale: LoadedSale,
  parts: SnapshotParts,
): KaufvertragSnapshot {
  const { vin, seller, warranty, branding, documentLocale } = parts;
  return buildKaufvertragSnapshot({
    sale: {
      id: sale.id,
      sale_number: sale.sale_number,
      sale_price_eur: sale.sale_price.toFixed(2),
      contract_concluded_at: warranty.contractConcludedAt,
      handed_over_at: warranty.handedOverAt,
    },
    seller: buildSellerSnapshot(seller),
    buyer: buyerSnapshot(sale.customer),
    vehicle: {
      make: sale.vehicle.make,
      model: sale.vehicle.model,
      vin,
      hsn: sale.vehicle.hsn,
      tsn: sale.vehicle.tsn,
      color: sale.vehicle.color,
      mileage: sale.vehicle.mileage,
      first_registration_date: sale.vehicle.first_registration_date,
    },
    warranty,
    garantie:
      sale.garantie_months !== null
        ? {
            months: sale.garantie_months,
            terms: sale.garantie_terms?.trim() || null,
          }
        : null,
    branding,
    documentLocale,
  });
}

/** The archive a sale already points to for these exact facts, or null when a new one is needed. */
export function resolveCachedArchive(
  sale: LoadedSale,
  snapshotSha256: string,
): { bucket: string; key: string; generatedAt: Date } | null {
  if (
    sale.kaufvertrag_snapshot_sha256 !== snapshotSha256 ||
    !sale.kaufvertrag_archive_bucket ||
    !sale.kaufvertrag_archive_key ||
    !sale.kaufvertrag_archive_generation ||
    !sale.kaufvertrag_archive_sha256 ||
    !sale.kaufvertrag_generated_at
  ) {
    return null;
  }
  return {
    bucket: sale.kaufvertrag_archive_bucket,
    key: sale.kaufvertrag_archive_key,
    generatedAt: sale.kaufvertrag_generated_at,
  };
}

/** Loads a sale and freezes its Kaufvertrag facts into the snapshot the PDF is rendered from. */
@Injectable()
export class KaufvertragPdfSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async findSaleInScope(
    saleId: string,
    tenantId: string,
    authorizedSiteIds: string[],
  ): Promise<LoadedSale> {
    const sale = await this.prisma.client.vehicleSale.findFirst({
      where: {
        id: saleId,
        tenant_id: tenantId,
        site_id: { in: authorizedSiteIds },
        vehicle: {
          is: { tenant_id: tenantId, site_id: { in: authorizedSiteIds } },
        },
        customer: { is: { tenant_id: tenantId } },
      },
      include: SALE_INCLUDE,
    });
    if (!sale) {
      throw new NotFoundException(`Vehicle sale ${saleId} not found`);
    }
    return sale;
  }

  async findSaleForTenant(
    saleId: string,
    tenantId: string,
  ): Promise<LoadedSale> {
    const sale = await this.prisma.client.vehicleSale.findFirst({
      where: { id: saleId, tenant_id: tenantId },
      include: SALE_INCLUDE,
    });
    if (!sale) {
      throw new NotFoundException(`Vehicle sale ${saleId} not found`);
    }
    return sale;
  }

  /** Country of the sale site's legal entity; used when PDF workers have no session capabilities. */
  async findSaleLegalEntityCountryIso(
    saleId: string,
    tenantId: string,
  ): Promise<string> {
    const sale = await this.prisma.client.vehicleSale.findFirst({
      where: { id: saleId, tenant_id: tenantId },
      select: {
        site: { select: { legal_entity: { select: { country_iso: true } } } },
      },
    });
    if (!sale?.site?.legal_entity?.country_iso) {
      throw new NotFoundException(`Vehicle sale ${saleId} not found`);
    }
    return sale.site.legal_entity.country_iso;
  }

  /**
   * Runs every guard and builds the frozen snapshot. Nothing is written here.
   * Read-only callers pass `lockLogo: false`; generation keeps the logo lock.
   */
  async prepareSnapshot(
    sale: LoadedSale,
    tenantId: string,
    options: { lockLogo: boolean },
  ): Promise<PreparedKaufvertrag> {
    const { vin, seller } = assertKaufvertragSaleEligible({
      status: sale.status,
      vin: sale.vehicle.vin,
      seller: sale.site?.legal_entity ?? null,
    });
    const warranty = resolveKaufvertragGewaehrleistung({
      contractConcludedAt: sale.contract_concluded_at,
      handedOverAt: sale.handed_over_at,
      buyerIsConsumer: sale.buyer_is_consumer ?? false,
      shortenedNegotiated: sale.gewaehrleistung_shortened_negotiated ?? false,
      firstRegistrationDate: sale.vehicle.first_registration_date,
      stored: {
        baseEndsOn: sale.gewaehrleistung_ends_on,
        presumptionEndsOn: sale.presumption_ends_on,
        ruleVersion: sale.gewaehrleistung_rule_version,
      },
    });
    const branding: KaufvertragSnapshotBranding = toKaufvertragSnapshotBranding(
      await this.prisma.$transaction((tx) =>
        resolveBrandingSnapshot(tx, tenantId, seller.id, new Date(), {
          lockLogo: options.lockLogo,
        }),
      ),
    );

    const tenantDefaultLocale = await loadTenantDefaultLocale(
      this.prisma.client,
      tenantId,
    );
    const documentLocale = resolveCustomerDocumentLanguage(
      sale.customer,
      tenantDefaultLocale,
    );
    const snapshot = assembleSnapshot(sale, {
      vin,
      seller,
      warranty,
      branding,
      documentLocale,
    });

    return {
      snapshot,
      snapshotSha256: hashKaufvertragSnapshot(snapshot),
    };
  }
}
