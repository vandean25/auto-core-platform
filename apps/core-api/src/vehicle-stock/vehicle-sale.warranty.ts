import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma, VehicleSaleStatus, type VehicleSale } from '@prisma/client';
import type { CorrectGewaehrleistungSnapshotDto } from './dto/correct-gewaehrleistung-snapshot.dto.js';
import type { CreateVehicleSaleDto } from './dto/create-vehicle-sale.dto.js';
import type { PatchVehicleSaleDto } from './dto/patch-vehicle-sale.dto.js';
import { computeGewaehrleistung } from './gewaehrleistung/compute-gewaehrleistung.js';
import { resolveGewaehrleistungRuleSet } from './gewaehrleistung/gewaehrleistung-rule-sets.js';
import { resolveGarantieFacts } from './kaufvertrag/kaufvertrag-garantie.js';

type WarrantyInput = {
  contract_concluded_at: Date | null;
  handed_over_at: Date | null;
  buyer_is_consumer: boolean;
  gewaehrleistung_shortened_negotiated: boolean;
};

type WarrantySale = Pick<
  VehicleSale,
  | 'contract_concluded_at'
  | 'handed_over_at'
  | 'buyer_is_consumer'
  | 'gewaehrleistung_shortened_negotiated'
  | 'gewaehrleistung_note'
>;

/** Computes the persisted Gewährleistung dates and rule version from the sale's warranty facts. */
export function computeSaleWarrantySnapshot(
  input: WarrantyInput,
  firstRegistrationDate: Date | null,
) {
  const ruleSet =
    input.contract_concluded_at && input.handed_over_at
      ? resolveGewaehrleistungRuleSet(input.contract_concluded_at)
      : null;
  const result = computeGewaehrleistung({
    contractConcludedAt: input.contract_concluded_at,
    handedOverAt: input.handed_over_at,
    buyerIsConsumer: input.buyer_is_consumer,
    shortenedNegotiated: input.gewaehrleistung_shortened_negotiated,
    firstRegistrationDate,
  });
  if (result.error) {
    throw new UnprocessableEntityException(result.error);
  }
  return {
    gewaehrleistung_ends_on: result.baseEndsOn,
    presumption_ends_on: result.presumptionEndsOn,
    gewaehrleistung_rule_version: ruleSet?.id ?? result.ruleVersion,
  };
}

/** Warranty input for the finalize snapshot: unknown consumer and shortening flags count as false. */
export function finalizeWarrantyInput(
  sale: Pick<
    VehicleSale,
    | 'contract_concluded_at'
    | 'handed_over_at'
    | 'buyer_is_consumer'
    | 'gewaehrleistung_shortened_negotiated'
  >,
): WarrantyInput {
  return {
    contract_concluded_at: sale.contract_concluded_at,
    handed_over_at: sale.handed_over_at,
    buyer_is_consumer: sale.buyer_is_consumer ?? false,
    gewaehrleistung_shortened_negotiated:
      sale.gewaehrleistung_shortened_negotiated ?? false,
  };
}

export function toGewaehrleistungInput(sale: WarrantySale) {
  return {
    contract_concluded_at: sale.contract_concluded_at,
    handed_over_at: sale.handed_over_at,
    buyer_is_consumer: sale.buyer_is_consumer,
    gewaehrleistung_shortened_negotiated:
      sale.gewaehrleistung_shortened_negotiated,
    gewaehrleistung_note: sale.gewaehrleistung_note,
  };
}

export function toGewaehrleistungSnapshot(
  sale: Pick<
    VehicleSale,
    | 'gewaehrleistung_ends_on'
    | 'presumption_ends_on'
    | 'gewaehrleistung_rule_version'
  >,
) {
  return {
    gewaehrleistung_ends_on: sale.gewaehrleistung_ends_on,
    presumption_ends_on: sale.presumption_ends_on,
    gewaehrleistung_rule_version: sale.gewaehrleistung_rule_version,
  };
}

/** Sale-create facts: a consumer defaults to the buyer being a private customer. */
export function buildCreateWarrantyFacts(
  dto: CreateVehicleSaleDto,
  buyerType: string,
) {
  return {
    contract_concluded_at: dto.contract_concluded_at ?? null,
    handed_over_at: dto.handed_over_at ?? null,
    buyer_is_consumer: dto.buyer_is_consumer ?? buyerType === 'PRIVATE',
    gewaehrleistung_shortened_negotiated:
      dto.gewaehrleistung_shortened_negotiated ?? false,
    gewaehrleistung_note: dto.gewaehrleistung_note ?? null,
  };
}

/** Draft-update facts: each field keeps the stored value unless the patch sends one. */
export function buildDraftWarrantyFacts(
  sale: WarrantySale,
  dto: PatchVehicleSaleDto,
) {
  return {
    contract_concluded_at:
      dto.contract_concluded_at !== undefined
        ? dto.contract_concluded_at
        : sale.contract_concluded_at,
    handed_over_at:
      dto.handed_over_at !== undefined
        ? dto.handed_over_at
        : sale.handed_over_at,
    buyer_is_consumer: dto.buyer_is_consumer ?? sale.buyer_is_consumer ?? false,
    gewaehrleistung_shortened_negotiated:
      dto.gewaehrleistung_shortened_negotiated ??
      sale.gewaehrleistung_shortened_negotiated ??
      false,
    gewaehrleistung_note:
      dto.gewaehrleistung_note !== undefined
        ? dto.gewaehrleistung_note
        : sale.gewaehrleistung_note,
  };
}

export function resolveDraftGarantie(
  sale: { garantie_months: number | null; garantie_terms: string | null },
  dto: PatchVehicleSaleDto,
) {
  return resolveGarantieFacts({
    months:
      dto.garantie_months !== undefined
        ? dto.garantie_months
        : sale.garantie_months,
    terms:
      dto.garantie_terms !== undefined
        ? dto.garantie_terms
        : sale.garantie_terms,
    termsProvided: dto.garantie_terms !== undefined,
  });
}

/** Correction facts: the consumer and shortening flags always come from the correction itself. */
export function buildCorrectedWarrantyFacts(
  sale: WarrantySale,
  dto: CorrectGewaehrleistungSnapshotDto,
) {
  return {
    contract_concluded_at:
      dto.contract_concluded_at !== undefined
        ? dto.contract_concluded_at
        : sale.contract_concluded_at,
    handed_over_at:
      dto.handed_over_at !== undefined
        ? dto.handed_over_at
        : sale.handed_over_at,
    buyer_is_consumer: dto.buyer_is_consumer,
    gewaehrleistung_shortened_negotiated:
      dto.gewaehrleistung_shortened_negotiated,
    gewaehrleistung_note:
      dto.gewaehrleistung_note !== undefined
        ? dto.gewaehrleistung_note
        : sale.gewaehrleistung_note,
  };
}

type CorrectableSale = WarrantySale &
  Pick<
    VehicleSale,
    | 'gewaehrleistung_ends_on'
    | 'presumption_ends_on'
    | 'gewaehrleistung_rule_version'
  >;

/** The before and after snapshots a correction audits; the reason is trimmed on the way in. */
export function buildCorrectionAudit(
  sale: CorrectableSale,
  warrantyFacts: ReturnType<typeof buildCorrectedWarrantyFacts>,
  warrantySnapshot: ReturnType<typeof computeSaleWarrantySnapshot>,
  reason: string,
) {
  return {
    before: {
      input: toGewaehrleistungInput(sale),
      snapshot: toGewaehrleistungSnapshot(sale),
      reason: null,
    },
    after: {
      input: warrantyFacts,
      snapshot: warrantySnapshot,
      reason: reason.trim(),
    },
  };
}

/**
 * Guards the correction write: it applies only while the invoiced sale still carries the
 * warranty facts and snapshot that the correction was computed against.
 */
export function buildCorrectionGuardWhere(
  id: string,
  tenantId: string,
  authorizedSiteIds: string[],
  sale: CorrectableSale,
): Prisma.VehicleSaleWhereInput {
  return {
    id,
    tenant_id: tenantId,
    site_id: { in: authorizedSiteIds },
    status: VehicleSaleStatus.INVOICED,
    contract_concluded_at: sale.contract_concluded_at,
    handed_over_at: sale.handed_over_at,
    buyer_is_consumer: sale.buyer_is_consumer,
    gewaehrleistung_shortened_negotiated:
      sale.gewaehrleistung_shortened_negotiated,
    gewaehrleistung_note: sale.gewaehrleistung_note,
    gewaehrleistung_ends_on: sale.gewaehrleistung_ends_on,
    presumption_ends_on: sale.presumption_ends_on,
    gewaehrleistung_rule_version: sale.gewaehrleistung_rule_version,
  };
}
