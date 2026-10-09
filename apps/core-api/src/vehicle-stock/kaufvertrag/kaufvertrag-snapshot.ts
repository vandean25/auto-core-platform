import type {
  InvoiceSnapshotV2Branding,
  InvoiceSnapshotV2Seller,
} from '../../invoices/invoice-snapshot-v2.js';
import { hashCanonicalJson } from '../../invoices/invoice-snapshot-hash.js';
import type {
  KaufvertragGewaehrleistung,
  KaufvertragRegime,
} from './kaufvertrag-facts.js';

export const KAUFVERTRAG_TEMPLATE_VERSION = 'kaufvertrag-brand-v1' as const;
export const KAUFVERTRAG_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type KaufvertragSnapshotBranding = Omit<
  InvoiceSnapshotV2Branding,
  'renderer_version'
>;

export type KaufvertragSnapshotBuyer = {
  type: 'PRIVATE' | 'COMPANY';
  company_name: string | null;
  first_name: string;
  last_name: string;
  vat_id: string | null;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  address_country: string | null;
};

export type KaufvertragSnapshotInput = {
  sale: {
    id: string;
    sale_number: string;
    sale_price_eur: string;
    contract_concluded_at: Date;
    handed_over_at: Date;
  };
  seller: InvoiceSnapshotV2Seller;
  buyer: KaufvertragSnapshotBuyer;
  vehicle: {
    make: string;
    model: string;
    vin: string;
    hsn: string | null;
    tsn: string | null;
    color: string | null;
    mileage: number | null;
    first_registration_date: Date | null;
  };
  warranty: KaufvertragGewaehrleistung;
  garantie: { months: number; terms: string | null } | null;
  branding: KaufvertragSnapshotBranding;
};

export type KaufvertragSnapshot = {
  schema_version: typeof KAUFVERTRAG_SNAPSHOT_SCHEMA_VERSION;
  template_version: typeof KAUFVERTRAG_TEMPLATE_VERSION;
  sale: {
    id: string;
    sale_number: string;
    sale_price_eur: string;
    contract_concluded_at: string;
    handed_over_at: string;
  };
  seller: InvoiceSnapshotV2Seller;
  buyer: KaufvertragSnapshotBuyer;
  vehicle: {
    make: string;
    model: string;
    vin: string;
    hsn: string | null;
    tsn: string | null;
    color: string | null;
    mileage: number | null;
    first_registration_date: string | null;
  };
  warranty: {
    regime: KaufvertragRegime;
    buyer_is_consumer: boolean;
    base_period_years: number | null;
    presumption_period_years: number | null;
    base_ends_on: string | null;
    presumption_ends_on: string | null;
    rule_version: string;
  };
  garantie: { duration_months: number; terms: string | null } | null;
  branding: KaufvertragSnapshotBranding;
};

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDayOrNull(date: Date | null): string | null {
  return date ? isoDay(date) : null;
}

/** Keeps only the fields the Kaufvertrag needs from the shared branding resolver. */
export function toKaufvertragSnapshotBranding(
  branding: InvoiceSnapshotV2Branding,
): KaufvertragSnapshotBranding {
  return {
    schema_version: branding.schema_version,
    profile_id: branding.profile_id,
    profile_revision: branding.profile_revision,
    preset_id: branding.preset_id,
    font_id: branding.font_id,
    tokens: { ...branding.tokens },
    logo: branding.logo,
    resolved_at: branding.resolved_at,
  };
}

export function buildKaufvertragSnapshot(
  input: KaufvertragSnapshotInput,
): KaufvertragSnapshot {
  const { sale, vehicle, warranty } = input;
  return {
    schema_version: KAUFVERTRAG_SNAPSHOT_SCHEMA_VERSION,
    template_version: KAUFVERTRAG_TEMPLATE_VERSION,
    sale: {
      id: sale.id,
      sale_number: sale.sale_number,
      sale_price_eur: sale.sale_price_eur,
      contract_concluded_at: isoDay(sale.contract_concluded_at),
      handed_over_at: isoDay(sale.handed_over_at),
    },
    seller: input.seller,
    buyer: input.buyer,
    vehicle: {
      make: vehicle.make,
      model: vehicle.model,
      vin: vehicle.vin,
      hsn: vehicle.hsn,
      tsn: vehicle.tsn,
      color: vehicle.color,
      mileage: vehicle.mileage,
      first_registration_date: isoDayOrNull(vehicle.first_registration_date),
    },
    warranty: {
      regime: warranty.regime,
      buyer_is_consumer: warranty.buyerIsConsumer,
      base_period_years: warranty.basePeriodYears,
      presumption_period_years: warranty.presumptionPeriodYears,
      base_ends_on: isoDayOrNull(warranty.baseEndsOn),
      presumption_ends_on: isoDayOrNull(warranty.presumptionEndsOn),
      rule_version: warranty.ruleVersion,
    },
    garantie: input.garantie
      ? {
          duration_months: input.garantie.months,
          terms: input.garantie.terms,
        }
      : null,
    branding: input.branding,
  };
}

/**
 * Canonical SHA-256 of the snapshot. `branding.resolved_at` is excluded because
 * it records when the branding was read, not what the document says. Without
 * this exclusion, every regeneration would produce a new archive key.
 */
export function hashKaufvertragSnapshot(snapshot: KaufvertragSnapshot): string {
  const branding: Record<string, unknown> = { ...snapshot.branding };
  delete branding.resolved_at;
  return hashCanonicalJson({ ...snapshot, branding });
}

export function buildKaufvertragArchiveKey(params: {
  tenantId: string;
  saleId: string;
  snapshotSha256: string;
}): string {
  return `vehicle-sale-kaufvertrag-archives/${params.tenantId}/${params.saleId}/${params.snapshotSha256}/${KAUFVERTRAG_TEMPLATE_VERSION}.pdf`;
}

export function buildKaufvertragArchiveIdentity(params: {
  tenantId: string;
  saleId: string;
  snapshotSha256: string;
}): Record<string, string> {
  return {
    tenant_id: params.tenantId,
    vehicle_sale_id: params.saleId,
    snapshot_sha256: params.snapshotSha256,
    template_version: KAUFVERTRAG_TEMPLATE_VERSION,
  };
}
