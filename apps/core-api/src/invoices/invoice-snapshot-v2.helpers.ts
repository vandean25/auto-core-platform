import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CustomerType,
  DiscountType,
  InvoiceTaxMode,
  Prisma,
  type Customer,
  type Invoice,
  type InvoiceItem,
  type LegalEntity,
  type LegalEntityAccountingProfile,
} from '@prisma/client';
import {
  DEFAULT_DOCUMENT_BRAND_THEME,
  validateDocumentBrandTheme,
} from '../document-branding/theme-v1.js';
import { computeSellerReadiness } from '../site/legal-entity-readiness.js';
import { resolveAccountingAllocation } from '../finance/accounting-profile/accounting-profile.resolver.js';
import {
  FIXED_SOURCE_CATEGORY_KEYS,
  type AccountingTaxMode,
  type ResolvedAccountingAllocation,
} from '../finance/accounting-profile/accounting-profile.types.js';
import {
  INVOICE_BRANDED_TEMPLATE_VERSION,
  type InvoiceSnapshotV2,
  type InvoiceSnapshotV2Branding,
  type InvoiceSnapshotV2Item,
  type InvoiceSnapshotV2Seller,
  type InvoiceSnapshotV2TaxBucket,
} from './invoice-snapshot-v2.js';
import type { ResolvedInvoiceOwnership } from './invoice-ownership.resolver.js';

export type DecimalLike = Prisma.Decimal | number | string;

export const toMoney = (value: DecimalLike): Prisma.Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

export const moneyString = (value: Prisma.Decimal): string => value.toFixed(2);

export const quantityString = (value: Prisma.Decimal): string =>
  value.toFixed(3);

export const halfUpTax = (
  net: Prisma.Decimal,
  rate: Prisma.Decimal,
): Prisma.Decimal =>
  net.mul(rate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export type InvoiceCustomerSnapshot = InvoiceSnapshotV2['customer'];
export type InvoiceSellerSnapshot = InvoiceSnapshotV2Seller;
export type InvoiceLineItemSnapshot = InvoiceSnapshotV2Item;

export type InvoiceTotalsSnapshot = {
  total_net: string;
  total_tax: string;
  total_gross: string;
  tax_breakdown: InvoiceSnapshotV2TaxBucket[];
};

export type LineAllocationItemInput = {
  id: string;
  description: string;
  quantity: DecimalLike;
  unitPrice: DecimalLike;
  taxRate: DecimalLike;
  lineDiscountType?: DiscountType | null;
  lineDiscountValue?: DecimalLike | null;
  revenueGroupName?: string | null;
  accountingAllocation: ResolvedAccountingAllocation;
};

export type InvoiceSourceIdentity = Pick<
  Invoice,
  'sales_order_id' | 'workshop_order_id' | 'vehicle_sale_id'
> &
  Partial<Pick<Invoice, 'site_id' | 'legal_entity_id'>>;

export type InvoiceCommitmentContext = {
  tenantId: string;
  sourceIdentity: InvoiceSourceIdentity;
  authorizedSiteIds: string[];
  ownership: ResolvedInvoiceOwnership;
};

type CustomerRequiredFieldDescriptor = {
  field: string;
  isMissing: (customer: Partial<Customer>) => boolean;
};

const REQUIRED_CUSTOMER_FIELDS: CustomerRequiredFieldDescriptor[] = [
  {
    field: 'company_name',
    isMissing: (c) =>
      c.type === CustomerType.COMPANY && !c.company_name?.trim(),
  },
  {
    field: 'first_name',
    isMissing: (c) => !c.first_name?.trim(),
  },
  {
    field: 'last_name',
    isMissing: (c) => !c.last_name?.trim(),
  },
  {
    field: 'address_street',
    isMissing: (c) => !c.address_street?.trim(),
  },
  {
    field: 'address_zip',
    isMissing: (c) => !c.address_zip?.trim(),
  },
  {
    field: 'address_city',
    isMissing: (c) => !c.address_city?.trim(),
  },
  {
    field: 'address_country',
    isMissing: (c) => !c.address_country?.trim(),
  },
];

export function collectCustomerMissingFields(
  customer: Partial<Customer> | null | undefined,
): string[] {
  if (!customer) {
    return ['customer'];
  }
  return REQUIRED_CUSTOMER_FIELDS.filter((descriptor) =>
    descriptor.isMissing(customer),
  ).map((descriptor) => descriptor.field);
}

export function isMissingBrandingConfig(
  legalEntity?: { id?: string | null } | null,
  customBranding?: { profile_id?: string | null; id?: string | null } | null,
): boolean {
  if (!legalEntity?.id) {
    return true;
  }
  return !customBranding?.profile_id && !customBranding?.id && false;
}

export function matchesBrandingVersion(
  templateVersion: string | null | undefined,
  currentVersion: string = INVOICE_BRANDED_TEMPLATE_VERSION,
): boolean {
  return Boolean(templateVersion && templateVersion === currentVersion);
}

export type BrandAssetCandidate = {
  id: string;
  bucket?: string | null;
  object_key?: string | null;
  object_generation?: string | null;
  sha256?: string | null;
  detected_mime_type?: string | null;
  pixel_width?: number | null;
  pixel_height?: number | null;
};

export function isValidBrandLogoAsset(
  asset: BrandAssetCandidate | null | undefined,
): asset is BrandAssetCandidate & {
  bucket: string;
  object_key: string;
  object_generation: string;
  sha256: string;
  detected_mime_type: 'image/png';
  pixel_width: number;
  pixel_height: number;
} {
  if (!asset) {
    return false;
  }
  if (!asset.bucket || !asset.object_key) {
    return false;
  }
  if (!asset.object_generation || !asset.sha256) {
    return false;
  }
  if (asset.detected_mime_type !== 'image/png') {
    return false;
  }
  return Boolean(asset.pixel_width && asset.pixel_height);
}

export function brandAssetUnavailable(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
    message: 'Confirmed logo asset is unavailable.',
  });
}

export function brandDataInconsistent(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'BRAND_RENDER_INPUT_UNAVAILABLE',
    message: 'Confirmed branding data is inconsistent.',
  });
}

async function resolveBrandLogo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  legalEntityId: string,
  logoAssetId: string,
): Promise<NonNullable<InvoiceSnapshotV2Branding['logo']>> {
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
    throw brandAssetUnavailable();
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

  if (!isValidBrandLogoAsset(asset)) {
    throw brandAssetUnavailable();
  }

  return {
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

export async function resolveBrandingSnapshot(
  tx: Prisma.TransactionClient,
  tenantId: string,
  legalEntityId: string,
  resolvedAt: Date,
): Promise<InvoiceSnapshotV2Branding> {
  if (!legalEntityId) {
    throw new UnprocessableEntityException({
      code: 'SELLER_IDENTITY_INCOMPLETE',
      message: 'Legal entity is required for branding resolution.',
      missingFields: ['legal_entity'],
    });
  }

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
    throw brandDataInconsistent();
  }

  const logo = logoAssetId
    ? await resolveBrandLogo(tx, tenantId, legalEntityId, logoAssetId)
    : null;

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

export function buildCustomerSnapshot(customer: {
  type: CustomerType;
  company_name?: string | null;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  vat_id?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  address_country?: string | null;
}): InvoiceCustomerSnapshot {
  return {
    type: customer.type,
    company_name: customer.company_name ?? null,
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email ?? null,
    phone: customer.phone ?? null,
    vat_id: customer.vat_id ?? null,
    address_street: customer.address_street ?? null,
    address_city: customer.address_city ?? null,
    address_zip: customer.address_zip ?? null,
    address_country: customer.address_country ?? null,
  };
}

export function buildSellerSnapshot(seller: {
  name: string;
  country_iso: 'AT' | 'DE';
  address_street?: string | null;
  address_line2?: string | null;
  address_zip?: string | null;
  address_city?: string | null;
  tax_number?: string | null;
  vat_id?: string | null;
  iban?: string | null;
  bic?: string | null;
  bank_name?: string | null;
  email?: string | null;
  phone?: string | null;
  registration_number?: string | null;
  registration_court?: string | null;
  representatives?: string | null;
}): InvoiceSellerSnapshot {
  return {
    name: seller.name,
    country_iso: seller.country_iso,
    address_street: seller.address_street ?? '',
    address_line2: seller.address_line2 ?? null,
    address_zip: seller.address_zip ?? '',
    address_city: seller.address_city ?? '',
    tax_number: seller.tax_number ?? null,
    vat_id: seller.vat_id ?? null,
    iban: seller.iban ?? null,
    bic: seller.bic ?? null,
    bank_name: seller.bank_name ?? null,
    email: seller.email ?? null,
    phone: seller.phone ?? null,
    registration_number: seller.registration_number ?? null,
    registration_court: seller.registration_court ?? null,
    representatives: seller.representatives ?? null,
  };
}

function lineNetBeforeDiscount(line: LineAllocationItemInput): Prisma.Decimal {
  const qty = toMoney(line.quantity);
  const price = toMoney(line.unitPrice);
  const grossLine = qty.mul(price);
  if (
    !line.lineDiscountType ||
    line.lineDiscountValue === null ||
    line.lineDiscountValue === undefined
  ) {
    return grossLine;
  }
  const discountVal = toMoney(line.lineDiscountValue);
  if (line.lineDiscountType === DiscountType.PERCENTAGE) {
    return grossLine.sub(
      grossLine.mul(discountVal).div(100).toDecimalPlaces(2),
    );
  }
  return Prisma.Decimal.max(grossLine.sub(discountVal), new Prisma.Decimal(0));
}

export function buildInvoiceLineItemSnapshots(
  lines: LineAllocationItemInput[],
  netByLine?: Map<string, Prisma.Decimal>,
  taxMode: InvoiceTaxMode = InvoiceTaxMode.STANDARD,
): InvoiceLineItemSnapshot[] {
  return lines.map((line) => {
    const net = netByLine?.get(line.id) ?? lineNetBeforeDiscount(line);
    const qty = toMoney(line.quantity);
    const unitPrice = toMoney(line.unitPrice);
    const taxRate = toMoney(line.taxRate);

    const discountVal =
      line.lineDiscountValue === null || line.lineDiscountValue === undefined
        ? null
        : moneyString(toMoney(line.lineDiscountValue));

    if (taxMode === InvoiceTaxMode.MARGIN_SCHEME) {
      return {
        id: line.id,
        description: line.description,
        quantity: quantityString(qty),
        unit_price: moneyString(unitPrice),
        tax_rate: moneyString(taxRate),
        line_discount_type: line.lineDiscountType ?? null,
        line_discount_value: discountVal,
        net: moneyString(net),
        tax: '0.00',
        gross: moneyString(net),
        revenue_group_name: line.revenueGroupName ?? null,
        accounting_allocation: line.accountingAllocation,
      };
    }

    const tax = halfUpTax(net, taxRate);
    const gross = net.add(tax);
    return {
      id: line.id,
      description: line.description,
      quantity: quantityString(qty),
      unit_price: moneyString(unitPrice),
      tax_rate: moneyString(taxRate),
      line_discount_type: line.lineDiscountType ?? null,
      line_discount_value: discountVal,
      net: moneyString(net),
      tax: moneyString(tax),
      gross: moneyString(gross),
      revenue_group_name: line.revenueGroupName ?? null,
      accounting_allocation: line.accountingAllocation,
    };
  });
}

export function buildTaxBreakdown(
  items: Array<{
    taxRate?: DecimalLike;
    rate?: DecimalLike;
    tax_rate?: DecimalLike;
    net: DecimalLike;
    tax: DecimalLike;
    gross: DecimalLike;
  }>,
): InvoiceSnapshotV2TaxBucket[] {
  const buckets = new Map<string, InvoiceSnapshotV2TaxBucket>();

  for (const item of items) {
    const rawRate = item.taxRate ?? item.rate ?? item.tax_rate ?? '0.00';
    const rate = moneyString(toMoney(rawRate));
    const existing = buckets.get(rate) ?? {
      rate,
      net: '0.00',
      tax: '0.00',
      gross: '0.00',
    };
    buckets.set(rate, {
      rate,
      net: moneyString(toMoney(existing.net).add(toMoney(item.net))),
      tax: moneyString(toMoney(existing.tax).add(toMoney(item.tax))),
      gross: moneyString(toMoney(existing.gross).add(toMoney(item.gross))),
    });
  }

  return [...buckets.values()].sort((left, right) =>
    toMoney(left.rate).comparedTo(toMoney(right.rate)),
  );
}

export function buildTotalsSnapshot(
  items: Array<{
    net: DecimalLike;
    tax: DecimalLike;
    gross: DecimalLike;
    tax_rate?: DecimalLike;
    rate?: DecimalLike;
    taxRate?: DecimalLike;
  }>,
  options?: {
    taxMode?: InvoiceTaxMode;
    marginTotalGross?: DecimalLike;
  },
): InvoiceTotalsSnapshot {
  const isMarginScheme = options?.taxMode === InvoiceTaxMode.MARGIN_SCHEME;
  if (isMarginScheme) {
    const grossTotal = options?.marginTotalGross
      ? toMoney(options.marginTotalGross)
      : items.reduce(
          (sum, item) => sum.add(toMoney(item.gross)),
          new Prisma.Decimal(0),
        );
    return {
      total_net: moneyString(grossTotal),
      total_tax: '0.00',
      total_gross: moneyString(grossTotal),
      tax_breakdown: [],
    };
  }

  const totalNet = items.reduce(
    (sum, item) => sum.add(toMoney(item.net)),
    new Prisma.Decimal(0),
  );
  const totalTax = items.reduce(
    (sum, item) => sum.add(toMoney(item.tax)),
    new Prisma.Decimal(0),
  );
  const totalGross = items.reduce(
    (sum, item) => sum.add(toMoney(item.gross)),
    new Prisma.Decimal(0),
  );

  return {
    total_net: moneyString(totalNet),
    total_tax: moneyString(totalTax),
    total_gross: moneyString(totalGross),
    tax_breakdown: buildTaxBreakdown(items),
  };
}

export function assertBrandingWriterEnabled(): void {
  if (process.env.INVOICE_BRANDING_WRITER_ENABLED !== 'true') {
    throw new ServiceUnavailableException({
      code: 'INVOICE_BRANDING_WRITER_DISABLED',
      message:
        'Invoice commitment is temporarily unavailable while branded invoice issuance is disabled.',
    });
  }
}

export function assertSourceOwnershipMatchesIdentity(
  sourceIdentity: InvoiceSourceIdentity,
  sourceOwnership: ResolvedInvoiceOwnership,
): void {
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
}

export function assertOwnershipUnchanged(
  initial: ResolvedInvoiceOwnership,
  current: ResolvedInvoiceOwnership,
): void {
  if (
    current.siteId !== initial.siteId ||
    current.legalEntityId !== initial.legalEntityId
  ) {
    throw new ConflictException({
      code: 'INVOICE_SOURCE_OWNERSHIP_CHANGED',
      message: 'Invoice source ownership changed during commitment.',
    });
  }
}

function matchesCommitmentIdentity(
  context: InvoiceCommitmentContext,
  tenantId: string,
  invoice: InvoiceSourceIdentity,
): boolean {
  if (context.tenantId !== tenantId) {
    return false;
  }
  if (context.sourceIdentity.sales_order_id !== invoice.sales_order_id) {
    return false;
  }
  if (context.sourceIdentity.workshop_order_id !== invoice.workshop_order_id) {
    return false;
  }
  return context.sourceIdentity.vehicle_sale_id === invoice.vehicle_sale_id;
}

export function assertCommitmentContextMatches(
  tenantId: string,
  invoice: InvoiceSourceIdentity,
  context: InvoiceCommitmentContext,
): void {
  if (!matchesCommitmentIdentity(context, tenantId, invoice)) {
    throw new ConflictException({
      code: 'INVOICE_SOURCE_OWNERSHIP_CHANGED',
      message: 'Invoice source changed during commitment.',
    });
  }
}

export function assertSupportedTaxProfile(taxMode: InvoiceTaxMode): void {
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

export async function loadAndValidateSeller(
  tx: Prisma.TransactionClient,
  tenantId: string,
  legalEntityId: string,
): Promise<LegalEntity> {
  const seller = await tx.legalEntity.findFirst({
    where: {
      id: legalEntityId,
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

  return seller;
}

export function assertCustomerComplete(customer: Customer): void {
  const customerMissing = collectCustomerMissingFields(customer);
  if (customerMissing.length > 0) {
    throw new UnprocessableEntityException({
      code: 'CUSTOMER_IDENTITY_INCOMPLETE',
      message: 'Customer identity is incomplete for invoice issuance.',
      missingFields: customerMissing,
    });
  }
}

/** Gross invoice total above which AT B2B issuance requires customer UID (accountant to confirm). */
export const AT_HIGH_VALUE_INVOICE_GROSS_THRESHOLD_EUR = new Prisma.Decimal(
  '10000.00',
);

export const AT_RECIPIENT_UID_REQUIRED_CODE = 'AT_RECIPIENT_UID_REQUIRED';

export function assertAtHighValueBusinessRecipientUid(params: {
  seller: Pick<LegalEntity, 'country_iso'>;
  customer: Customer;
  totalGross: DecimalLike;
}): void {
  if (params.seller.country_iso !== 'AT') {
    return;
  }
  if (params.customer.type !== CustomerType.COMPANY) {
    return;
  }
  const recipientCountry = params.customer.address_country?.trim().toUpperCase();
  if (recipientCountry !== 'AT') {
    return;
  }

  const grossTotal = toMoney(params.totalGross);
  if (!grossTotal.greaterThan(AT_HIGH_VALUE_INVOICE_GROSS_THRESHOLD_EUR)) {
    return;
  }

  if (params.customer.vat_id?.trim()) {
    return;
  }

  throw new UnprocessableEntityException({
    code: AT_RECIPIENT_UID_REQUIRED_CODE,
    message:
      'Customer UID is required for Austrian business recipients when invoice gross exceeds EUR 10,000.',
    missingFields: ['vat_id'],
  });
}

export async function loadAccountingProfile(
  tx: Prisma.TransactionClient,
  tenantId: string,
  legalEntityId: string,
): Promise<LegalEntityAccountingProfile> {
  const profile = await tx.legalEntityAccountingProfile.findFirst({
    where: {
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
    },
  });
  if (!profile) {
    throw new UnprocessableEntityException({
      code: 'ACCOUNTING_MAPPING_INCOMPLETE',
      message: 'Accounting profile is not configured for this legal entity.',
      missingFields: ['accounting_profile'],
    });
  }
  return profile;
}

export function resolveLineAllocation(params: {
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

export async function resolveInvoiceLineAllocations(
  tx: Prisma.TransactionClient,
  tenantId: string,
  invoice: Invoice & { items: InvoiceItem[] },
  seller: LegalEntity,
  profile: LegalEntityAccountingProfile,
): Promise<
  Array<{
    id: string;
    description: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    lineDiscountType: DiscountType | null;
    lineDiscountValue: Prisma.Decimal | null;
    revenueGroupName: string | null;
    accountingAllocation: ResolvedAccountingAllocation;
  }>
> {
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

  return invoice.items.map((item) => {
    const allocation = resolveLineAllocation({
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
}

export function computeInvoiceDates(
  invoice: Pick<Invoice, 'date' | 'supply_date_from' | 'supply_date_to'>,
  paymentDays: number,
): {
  supplyFrom: Date;
  supplyTo: Date;
  dueDate: Date;
} {
  const supplyFrom = invoice.supply_date_from ?? invoice.date;
  const supplyTo = invoice.supply_date_to ?? supplyFrom;
  const dueDate = new Date(invoice.date);
  dueDate.setDate(dueDate.getDate() + paymentDays);
  return { supplyFrom, supplyTo, dueDate };
}
