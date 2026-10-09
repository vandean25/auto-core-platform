import { UnprocessableEntityException } from '@nestjs/common';
import type { VehicleSaleStatus } from '@prisma/client';
import { computeGewaehrleistung } from '../gewaehrleistung/compute-gewaehrleistung.js';
import {
  resolveGewaehrleistungRuleSet,
  type GewaehrleistungRuleSetId,
} from '../gewaehrleistung/gewaehrleistung-rule-sets.js';

export type KaufvertragRefusalCode =
  | 'KAUFVERTRAG_SALE_CANCELLED'
  | 'KAUFVERTRAG_SITE_REQUIRED'
  | 'KAUFVERTRAG_SELLER_COUNTRY_UNSUPPORTED'
  | 'KAUFVERTRAG_VIN_REQUIRED'
  | 'KAUFVERTRAG_CONTRACT_DATE_REQUIRED'
  | 'KAUFVERTRAG_HANDOVER_DATE_REQUIRED'
  | 'KAUFVERTRAG_GEWAEHRLEISTUNG_SNAPSHOT_STALE';

export type KaufvertragSaleEligibilityInput<
  TSeller extends { country_iso: string },
> = {
  status: VehicleSaleStatus;
  vin: string | null;
  seller: TSeller | null;
};

export type KaufvertragGewaehrleistungInput = {
  contractConcludedAt: Date | null;
  handedOverAt: Date | null;
  buyerIsConsumer: boolean;
  shortenedNegotiated: boolean;
  firstRegistrationDate: Date | null;
  stored: {
    baseEndsOn: Date | null;
    presumptionEndsOn: Date | null;
    ruleVersion: string | null;
  };
};

export type KaufvertragRegime =
  'CONSUMER_BASE' | 'CONSUMER_SHORTENED' | 'B2B_PER_CONTRACT';

export type KaufvertragGewaehrleistung = {
  regime: KaufvertragRegime;
  contractConcludedAt: Date;
  handedOverAt: Date;
  buyerIsConsumer: boolean;
  basePeriodYears: number | null;
  presumptionPeriodYears: number | null;
  baseEndsOn: Date | null;
  presumptionEndsOn: Date | null;
  ruleVersion: GewaehrleistungRuleSetId;
};

function refusal(
  code: KaufvertragRefusalCode,
  message: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({ code, message });
}

/**
 * Sale-level eligibility for the Kaufvertrag PDF. The text follows Austrian
 * law (ABGB / VGG), so only Austrian sellers may use it.
 */
export function assertKaufvertragSaleEligible<
  TSeller extends { country_iso: string },
>(
  input: KaufvertragSaleEligibilityInput<TSeller>,
): { vin: string; seller: TSeller } {
  if (input.status === 'CANCELLED') {
    throw refusal(
      'KAUFVERTRAG_SALE_CANCELLED',
      'Ein stornierter Fahrzeugverkauf kann kein Kaufvertrag-PDF erhalten.',
    );
  }
  if (!input.seller) {
    throw refusal(
      'KAUFVERTRAG_SITE_REQUIRED',
      'Der Verkauf ist keinem Standort mit Verkäufer zugeordnet.',
    );
  }
  if (input.seller.country_iso !== 'AT') {
    throw refusal(
      'KAUFVERTRAG_SELLER_COUNTRY_UNSUPPORTED',
      'Das Kaufvertrag-PDF folgt dem österreichischen Recht und kann nur für Verkäufer mit Sitz in Österreich erstellt werden.',
    );
  }
  const vin = input.vin?.trim();
  if (!vin) {
    throw refusal(
      'KAUFVERTRAG_VIN_REQUIRED',
      'Für den Kaufvertrag ist die Fahrgestellnummer (FIN) erforderlich.',
    );
  }
  return { vin, seller: input.seller };
}

/**
 * Recomputes the AUT-408 Gewährleistung facts with the same pure function the
 * sale create and patch paths use, so the PDF can never state a shortening the
 * rules refuse. The stored snapshot must match, otherwise the PDF and the
 * tracker could disagree.
 */
export function resolveKaufvertragGewaehrleistung(
  input: KaufvertragGewaehrleistungInput,
): KaufvertragGewaehrleistung {
  if (!input.contractConcludedAt) {
    throw refusal(
      'KAUFVERTRAG_CONTRACT_DATE_REQUIRED',
      'Für den Kaufvertrag ist das Vertragsdatum erforderlich.',
    );
  }
  if (!input.handedOverAt) {
    throw refusal(
      'KAUFVERTRAG_HANDOVER_DATE_REQUIRED',
      'Für den Kaufvertrag ist das Übergabedatum erforderlich.',
    );
  }

  const result = computeGewaehrleistung({
    contractConcludedAt: input.contractConcludedAt,
    handedOverAt: input.handedOverAt,
    buyerIsConsumer: input.buyerIsConsumer,
    shortenedNegotiated: input.shortenedNegotiated,
    firstRegistrationDate: input.firstRegistrationDate,
  });
  if (result.error) {
    throw new UnprocessableEntityException({
      code: result.error.code,
      message: result.error.message,
    });
  }

  const ruleSet = resolveGewaehrleistungRuleSet(input.contractConcludedAt);
  if (!ruleSet || !result.ruleVersion) {
    throw new UnprocessableEntityException({
      code: 'GEWAEHRLEISTUNG_RULE_NOT_AVAILABLE',
      message: 'Für Verträge vor dem 01.01.2022 ist keine Regel hinterlegt.',
    });
  }

  const facts: KaufvertragGewaehrleistung = {
    contractConcludedAt: input.contractConcludedAt,
    handedOverAt: input.handedOverAt,
    regime: input.buyerIsConsumer
      ? input.shortenedNegotiated
        ? 'CONSUMER_SHORTENED'
        : 'CONSUMER_BASE'
      : 'B2B_PER_CONTRACT',
    buyerIsConsumer: input.buyerIsConsumer,
    basePeriodYears: input.buyerIsConsumer
      ? input.shortenedNegotiated
        ? ruleSet.shortenedPeriodYears
        : ruleSet.basePeriodYears
      : null,
    presumptionPeriodYears: input.buyerIsConsumer
      ? ruleSet.presumptionPeriodYears
      : null,
    baseEndsOn: result.baseEndsOn,
    presumptionEndsOn: result.presumptionEndsOn,
    ruleVersion: result.ruleVersion,
  };

  const matchesStored =
    sameDay(facts.baseEndsOn, input.stored.baseEndsOn) &&
    sameDay(facts.presumptionEndsOn, input.stored.presumptionEndsOn) &&
    facts.ruleVersion === input.stored.ruleVersion;
  if (!matchesStored) {
    throw refusal(
      'KAUFVERTRAG_GEWAEHRLEISTUNG_SNAPSHOT_STALE',
      'Die gespeicherten Gewährleistungsdaten sind veraltet. Bitte den Verkauf erneut speichern.',
    );
  }

  return facts;
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}
