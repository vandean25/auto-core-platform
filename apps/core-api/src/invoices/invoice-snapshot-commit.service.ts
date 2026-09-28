import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
  type Customer,
  type Invoice,
  type InvoiceItem,
  type LegalEntity,
  type LegalEntityAccountingProfile,
  type Vehicle,
} from '@prisma/client';
import { resolveAccountingAllocation } from '../finance/accounting-profile/accounting-profile.resolver.js';
import {
  FIXED_SOURCE_CATEGORY_KEYS,
  type AccountingTaxMode,
  type ResolvedAccountingAllocation,
} from '../finance/accounting-profile/accounting-profile.types.js';
import { lockFinanceSettingsAndAssertOpen } from '../finance/fiscal-lock.helpers.js';
import { computeSellerReadiness } from '../site/legal-entity-readiness.js';
import {
  lockLegalEntityAndAssertActive,
  lockSitesAndAssertActive,
} from '../site/document-retarget.helpers.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  buildInvoiceSnapshotV2,
  INVOICE_BRANDED_TEMPLATE_VERSION,
  type InvoiceSnapshotV2Branding,
  type InvoiceSnapshotV2,
  type InvoiceSnapshotV2Margin,
} from './invoice-snapshot-v2.js';
import {
  lockInvoiceSource,
  resolveInvoiceOwnershipFromSource,
  type ResolvedInvoiceOwnership,
} from './invoice-ownership.resolver.js';
import {
  DEFAULT_DOCUMENT_BRAND_THEME,
  validateDocumentBrandTheme,
} from '../document-branding/theme-v1.js';

type InvoiceWithRelations = Invoice & {
  items: InvoiceItem[];
  customer: Customer;
  vehicle: Vehicle | null;
};

type InvoiceSourceIdentity = Pick<
  Invoice,
  'sales_order_id' | 'workshop_order_id' | 'vehicle_sale_id'
> &
  Partial<Pick<Invoice, 'site_id' | 'legal_entity_id'>>;

type InvoiceCommitmentContext = {
  tenantId: string;
  sourceIdentity: InvoiceSourceIdentity;
  authorizedSiteIds: string[];
  ownership: ResolvedInvoiceOwnership;
};

type CommitInvoiceSnapshotInput = {
  tx: Prisma.TransactionClient;
  tenantId: string;
  invoice: InvoiceWithRelations;
  invoiceNumber: string;
  margin?: InvoiceSnapshotV2Margin;
  lockInvoiceRow?: boolean;
  commitmentContext?: InvoiceCommitmentContext;
};

type PreparedInvoiceSnapshot = {
  snapshot: InvoiceSnapshotV2;
  ownership: ResolvedInvoiceOwnership;
  dueDate: Date;
  supplyFrom: Date;
  supplyTo: Date;
  logoAssetId: string | null;
};

@Injectable()
export class InvoiceSnapshotCommitService {
  constructor(private readonly siteContext: SiteContextService) {}

  async lockCommitmentContext(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sourceIdentity: InvoiceSourceIdentity,
    date: Date,
  ): Promise<InvoiceCommitmentContext> {
    if (process.env.INVOICE_BRANDING_WRITER_ENABLED !== 'true') {
      throw new ServiceUnavailableException({
        code: 'INVOICE_BRANDING_WRITER_DISABLED',
        message:
          'Invoice commitment is temporarily unavailable while branded invoice issuance is disabled.',
      });
    }

    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    const sourceOwnership = await resolveInvoiceOwnershipFromSource(
      tx,
      tenantId,
      authorizedSiteIds,
      sourceIdentity,
    );
    if (
      sourceIdentity.site_id &&
      sourceIdentity.site_id !== sourceOwnership.siteId
    ) {
      throw new BadRequestException(
        'Invoice site ownership does not match its source document.',
      );
    }
    if (
      sourceIdentity.legal_entity_id &&
      sourceIdentity.legal_entity_id !== sourceOwnership.legalEntityId
    ) {
      throw new BadRequestException(
        'Invoice legal entity does not match its source document site.',
      );
    }

    await lockLegalEntityAndAssertActive(
      tx,
      tenantId,
      sourceOwnership.legalEntityId,
    );
    await lockSitesAndAssertActive(tx, tenantId, [sourceOwnership.siteId]);
    await lockFinanceSettingsAndAssertOpen(tx, tenantId, date);
    await lockInvoiceSource(tx, tenantId, authorizedSiteIds, sourceIdentity);

    const ownership = await resolveInvoiceOwnershipFromSource(
      tx,
      tenantId,
      authorizedSiteIds,
      sourceIdentity,
    );
    if (
      ownership.siteId !== sourceOwnership.siteId ||
      ownership.legalEntityId !== sourceOwnership.legalEntityId
    ) {
      throw new ConflictException({
        code: 'INVOICE_SOURCE_OWNERSHIP_CHANGED',
        message: 'Invoice source ownership changed during commitment.',
      });
    }

    return {
      tenantId,
      sourceIdentity,
      authorizedSiteIds: [...authorizedSiteIds],
      ownership,
    };
  }

  async lockInvoiceRow(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
  ): Promise<void> {
    // eslint-disable-next-line no-restricted-syntax -- tenant-scoped invoice lock follows the ordered source lock.
    const invoiceRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM invoices
      WHERE id = ${invoiceId}
        AND tenant_id = ${tenantId}
      FOR UPDATE
    `;
    if (invoiceRows.length !== 1) {
      throw new NotFoundException('Invoice not found');
    }
  }

  async prepareV2Snapshot(
    input: Omit<CommitInvoiceSnapshotInput, 'invoiceNumber'> & {
      invoiceNumber?: string;
    },
  ): Promise<PreparedInvoiceSnapshot> {
    const { tx, tenantId, invoice, margin } = input;
    const invoiceNumber = input.invoiceNumber ?? invoice.invoice_number ?? '';
    this.assertSupportedTaxProfile(invoice.tax_mode);
    const commitmentContext =
      input.commitmentContext ??
      (await this.lockCommitmentContext(tx, tenantId, invoice, invoice.date));
    this.assertCommitmentContextMatches(tenantId, invoice, commitmentContext);
    const { ownership } = commitmentContext;

    if (input.lockInvoiceRow !== false) {
      await this.lockInvoiceRow(tx, tenantId, invoice.id);
    }

    const seller = await tx.legalEntity.findFirst({
      where: {
        id: ownership.legalEntityId,
        tenant_id: tenantId,
        is_active: true,
      },
    });
    if (!seller) {
      throw new UnprocessableEntityException({
        code: 'SELLER_IDENTITY_INCOMPLETE',
        message: 'Seller legal entity is missing or inactive.',
        missingFields: ['legal_entity'],
      });
    }

    const sellerReadiness = computeSellerReadiness(seller);
    if (!sellerReadiness.isReady) {
      throw new UnprocessableEntityException({
        code: 'SELLER_IDENTITY_INCOMPLETE',
        message: 'Seller identity is incomplete for invoice issuance.',
        missingFields: sellerReadiness.missingFields,
      });
    }

    const customerMissing = this.collectCustomerMissingFields(invoice.customer);
    if (customerMissing.length > 0) {
      throw new UnprocessableEntityException({
        code: 'CUSTOMER_IDENTITY_INCOMPLETE',
        message: 'Customer identity is incomplete for invoice issuance.',
        missingFields: customerMissing,
      });
    }

    const profile = await tx.legalEntityAccountingProfile.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: ownership.legalEntityId,
      },
    });
    if (!profile) {
      throw new UnprocessableEntityException({
        code: 'ACCOUNTING_MAPPING_INCOMPLETE',
        message: 'Accounting profile is not configured for this legal entity.',
        missingFields: ['accounting_profile'],
      });
    }

    const catalogItemIds = invoice.items
      .map((item) => item.catalog_item_id)
      .filter((id): id is string => Boolean(id));
    const catalogItems =
      catalogItemIds.length > 0
        ? await tx.catalogItem.findMany({
            where: { tenant_id: tenantId, id: { in: catalogItemIds } },
            include: { revenue_group: true },
          })
        : [];
    const catalogItemMap = new Map(catalogItems.map((item) => [item.id, item]));

    const lineAllocations = invoice.items.map((item) => {
      const allocation = this.resolveLineAllocation({
        invoice,
        item,
        profile,
        seller,
        catalogItem: item.catalog_item_id
          ? (catalogItemMap.get(item.catalog_item_id) ?? null)
          : null,
      });
      if (!allocation) {
        throw new UnprocessableEntityException({
          code: 'ACCOUNTING_MAPPING_INCOMPLETE',
          message:
            'Accounting mapping is incomplete for one or more invoice lines.',
          missingFields: ['mapping_rules'],
        });
      }
      return {
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        taxRate: item.tax_rate,
        lineDiscountType: item.line_discount_type,
        lineDiscountValue: item.line_discount_value,
        revenueGroupName: item.revenue_group_name,
        accountingAllocation: allocation,
      };
    });

    const supplyFrom = invoice.supply_date_from ?? invoice.date;
    const supplyTo = invoice.supply_date_to ?? supplyFrom;
    const paymentDays = seller.payment_terms_days ?? 0;
    const dueDate = new Date(invoice.date);
    dueDate.setDate(dueDate.getDate() + paymentDays);

    const committedAt = new Date();
    const branding = await this.resolveBrandingSnapshot(
      tx,
      tenantId,
      ownership.legalEntityId,
      committedAt,
    );
    const snapshot = buildInvoiceSnapshotV2({
      invoice: {
        ...invoice,
        invoice_number: invoiceNumber,
        due_date: dueDate,
        supply_date_from: supplyFrom,
        supply_date_to: supplyTo,
      },
      seller,
      siteId: ownership.siteId,
      legalEntityId: ownership.legalEntityId,
      lineAllocations,
      margin,
      branding,
      committedAt,
    });

    return {
      snapshot,
      ownership,
      dueDate,
      supplyFrom,
      supplyTo,
      logoAssetId: branding.logo?.asset_id ?? null,
    };
  }

  async persistV2Snapshot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
    prepared: PreparedInvoiceSnapshot,
  ): Promise<void> {
    await tx.invoice.updateMany({
      where: { id: invoiceId, tenant_id: tenantId },
      data: {
        site_id: prepared.ownership.siteId,
        legal_entity_id: prepared.ownership.legalEntityId,
        currency: 'EUR',
        supply_date_from: prepared.supplyFrom,
        supply_date_to: prepared.supplyTo,
        due_date: prepared.dueDate,
        snapshot: prepared.snapshot,
      },
    });

    for (const item of prepared.snapshot.items) {
      await tx.invoiceItem.updateMany({
        where: { id: item.id, tenant_id: tenantId, invoice_id: invoiceId },
        data: {
          accounting_snapshot: item.accounting_allocation,
        },
      });
    }

    if (prepared.logoAssetId) {
      await tx.invoiceBrandAssetReference.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: prepared.ownership.legalEntityId,
          invoice_id: invoiceId,
          asset_id: prepared.logoAssetId,
        },
      });
    }
  }

  async commitV2Snapshot(
    input: CommitInvoiceSnapshotInput,
  ): Promise<InvoiceSnapshotV2> {
    const prepared = await this.prepareV2Snapshot(input);
    await this.persistV2Snapshot(
      input.tx,
      input.tenantId,
      input.invoice.id,
      prepared,
    );
    return prepared.snapshot;
  }

  private assertSupportedTaxProfile(taxMode: InvoiceTaxMode): void {
    if (
      taxMode !== InvoiceTaxMode.STANDARD &&
      taxMode !== InvoiceTaxMode.MARGIN_SCHEME
    ) {
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_TAX_PROFILE',
        message: 'Only STANDARD and MARGIN_SCHEME invoices are supported.',
        taxMode,
      });
    }
  }

  private assertCommitmentContextMatches(
    tenantId: string,
    invoice: InvoiceSourceIdentity,
    context: InvoiceCommitmentContext,
  ): void {
    if (
      context.tenantId !== tenantId ||
      context.sourceIdentity.sales_order_id !== invoice.sales_order_id ||
      context.sourceIdentity.workshop_order_id !== invoice.workshop_order_id ||
      context.sourceIdentity.vehicle_sale_id !== invoice.vehicle_sale_id
    ) {
      throw new ConflictException({
        code: 'INVOICE_SOURCE_OWNERSHIP_CHANGED',
        message: 'Invoice source changed during commitment.',
      });
    }
  }

  private async resolveBrandingSnapshot(
    tx: Prisma.TransactionClient,
    tenantId: string,
    legalEntityId: string,
    resolvedAt: Date,
  ): Promise<InvoiceSnapshotV2Branding> {
    const profile = await tx.documentBrandProfile.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
      select: {
        id: true,
        active_revision: true,
        active_theme: true,
        active_logo_asset_id: true,
      },
    });
    const theme = profile?.active_theme
      ? validateDocumentBrandTheme(profile.active_theme)
      : DEFAULT_DOCUMENT_BRAND_THEME;
    const logoAssetId = theme.logoAssetId;
    if (profile && profile.active_logo_asset_id !== logoAssetId) {
      throw new UnprocessableEntityException({
        code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
        message: 'Confirmed branding data is inconsistent.',
      });
    }

    let logo: InvoiceSnapshotV2Branding['logo'] = null;
    if (logoAssetId) {
      // eslint-disable-next-line no-restricted-syntax -- tenant/entity-scoped asset row lock serializes issuance with profile cleanup.
      const lockedAssets = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM document_brand_assets
        WHERE id = ${logoAssetId}
          AND tenant_id = ${tenantId}
          AND legal_entity_id = ${legalEntityId}
        ORDER BY id
        FOR UPDATE
      `;
      if (lockedAssets.length !== 1) {
        throw this.brandAssetUnavailable();
      }
      const asset = await tx.documentBrandAsset.findFirst({
        where: {
          id: logoAssetId,
          tenant_id: tenantId,
          legal_entity_id: legalEntityId,
          purpose: 'LOGO',
          state: 'READY',
        },
        select: {
          id: true,
          bucket: true,
          object_key: true,
          object_generation: true,
          sha256: true,
          detected_mime_type: true,
          pixel_width: true,
          pixel_height: true,
        },
      });
      if (
        !asset?.bucket ||
        !asset.object_key ||
        !asset.object_generation ||
        !asset.sha256 ||
        asset.detected_mime_type !== 'image/png' ||
        !asset.pixel_width ||
        !asset.pixel_height
      ) {
        throw this.brandAssetUnavailable();
      }
      logo = {
        asset_id: asset.id,
        bucket: asset.bucket,
        key: asset.object_key,
        generation: asset.object_generation,
        sha256: asset.sha256,
        mime_type: 'image/png',
        width: asset.pixel_width,
        height: asset.pixel_height,
      };
    }

    return {
      schema_version: 1,
      profile_id: profile?.id ?? null,
      profile_revision: profile?.active_revision ?? 0,
      preset_id: theme.presetId,
      renderer_version: INVOICE_BRANDED_TEMPLATE_VERSION,
      font_id: theme.fontId,
      tokens: {
        primary_color: theme.primaryColor,
        secondary_color: theme.secondaryColor,
        header_band: theme.headerBand,
        footer_band: theme.footerBand,
        header_text: theme.headerText,
        footer_text: theme.footerText,
      },
      logo,
      resolved_at: resolvedAt.toISOString(),
    };
  }

  private brandAssetUnavailable(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
      message: 'Confirmed logo asset is unavailable.',
    });
  }

  private collectCustomerMissingFields(customer: Customer): string[] {
    const missing: string[] = [];
    if (customer.type === 'COMPANY' && !customer.company_name?.trim()) {
      missing.push('company_name');
    }
    if (!customer.first_name?.trim()) {
      missing.push('first_name');
    }
    if (!customer.last_name?.trim()) {
      missing.push('last_name');
    }
    if (!customer.address_street?.trim()) {
      missing.push('address_street');
    }
    if (!customer.address_zip?.trim()) {
      missing.push('address_zip');
    }
    if (!customer.address_city?.trim()) {
      missing.push('address_city');
    }
    if (!customer.address_country?.trim()) {
      missing.push('address_country');
    }
    return missing;
  }

  private resolveLineAllocation(params: {
    invoice: Invoice;
    item: InvoiceItem;
    profile: LegalEntityAccountingProfile;
    seller: LegalEntity;
    catalogItem: {
      revenue_group_id: number | null;
      revenue_group: { id: number; name: string } | null;
    } | null;
  }): ResolvedAccountingAllocation | null {
    const taxMode: AccountingTaxMode =
      params.invoice.tax_mode === InvoiceTaxMode.MARGIN_SCHEME
        ? 'MARGIN_SCHEME'
        : 'STANDARD';
    const taxRate = params.item.tax_rate.toFixed(2);

    if (taxMode === 'MARGIN_SCHEME') {
      return resolveAccountingAllocation(
        params.profile,
        params.seller.country_iso,
        {
          sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.VEHICLE_MARGIN,
          sourceCategoryLabel: 'Vehicle margin scheme',
          taxMode,
          taxRate: '0.00',
        },
      );
    }

    if (params.catalogItem?.revenue_group) {
      return resolveAccountingAllocation(
        params.profile,
        params.seller.country_iso,
        {
          sourceCategoryKey: `revenue_group:${params.catalogItem.revenue_group.id}`,
          sourceCategoryLabel: params.catalogItem.revenue_group.name,
          taxMode,
          taxRate,
          revenueGroupId: params.catalogItem.revenue_group.id,
        },
      );
    }

    if (
      params.invoice.workshop_order_id &&
      !params.catalogItem?.revenue_group &&
      !params.item.catalog_item_id
    ) {
      return resolveAccountingAllocation(
        params.profile,
        params.seller.country_iso,
        {
          sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.LABOR,
          sourceCategoryLabel: 'Labor / workshop services',
          taxMode,
          taxRate,
        },
      );
    }

    return resolveAccountingAllocation(
      params.profile,
      params.seller.country_iso,
      {
        sourceCategoryKey: FIXED_SOURCE_CATEGORY_KEYS.MANUAL_LINE,
        sourceCategoryLabel:
          params.item.revenue_group_name ?? 'Manual invoice lines',
        taxMode,
        taxRate,
      },
    );
  }
}

export function assertInvoiceHasSourceDocument(invoice: {
  sales_order_id: string | null;
  workshop_order_id: string | null;
  vehicle_sale_id: string | null;
  status: InvoiceStatus;
}): void {
  if (
    invoice.status !== InvoiceStatus.DRAFT &&
    invoice.status !== InvoiceStatus.ISSUED &&
    invoice.status !== InvoiceStatus.FINALIZED
  ) {
    return;
  }

  if (
    !invoice.sales_order_id &&
    !invoice.workshop_order_id &&
    !invoice.vehicle_sale_id
  ) {
    throw new BadRequestException({
      code: 'SOURCE_DOCUMENT_REQUIRED',
      message:
        'Invoice issuance requires a source document with persisted site ownership.',
    });
  }
}
