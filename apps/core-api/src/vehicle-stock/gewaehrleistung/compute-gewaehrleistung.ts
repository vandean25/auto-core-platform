import {
  resolveGewaehrleistungRuleSet,
  type GewaehrleistungRuleSet,
  type GewaehrleistungRuleSetId,
} from './gewaehrleistung-rule-sets.js';

export type GewaehrleistungInput = {
  contractConcludedAt: Date | null;
  handedOverAt: Date | null;
  buyerIsConsumer: boolean;
  shortenedNegotiated: boolean;
  firstRegistrationDate: Date | null;
};

export type GewaehrleistungValidationError = {
  code:
    | 'GEWAEHRLEISTUNG_RULE_NOT_AVAILABLE'
    | 'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED'
    | 'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW'
    | 'GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER';
  message: string;
};

export type GewaehrleistungResult = {
  baseEndsOn: Date | null;
  presumptionEndsOn: Date | null;
  ruleVersion: GewaehrleistungRuleSetId | null;
  error?: GewaehrleistungValidationError;
};

function addCalendarYears(date: Date, years: number): Date {
  const targetYear = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  const lastDayOfMonth = new Date(
    Date.UTC(targetYear, month + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(targetYear, month, Math.min(date.getUTCDate(), lastDayOfMonth)),
  );
}

function validateShortening(
  input: GewaehrleistungInput & { handedOverAt: Date },
  ruleSet: GewaehrleistungRuleSet,
): GewaehrleistungValidationError | undefined {
  if (!input.shortenedNegotiated) return;
  if (!input.buyerIsConsumer) {
    return {
      code: 'GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER',
      message:
        'Eine Verkürzung der Basisfrist setzt einen Verbraucherkauf voraus.',
    };
  }
  if (!input.firstRegistrationDate) {
    return {
      code: 'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED',
      message:
        'Für die Verkürzung ist das Datum der Erstzulassung erforderlich.',
    };
  }
  const firstAnniversary = addCalendarYears(
    input.firstRegistrationDate,
    ruleSet.minimumVehicleAgeYears,
  );
  const handoverDay = addCalendarYears(input.handedOverAt, 0);
  if (firstAnniversary >= handoverDay) {
    return {
      code: 'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW',
      message:
        'Die Erstzulassung muss mehr als ein Jahr vor der Übergabe liegen.',
    };
  }
}

export function computeGewaehrleistung(
  input: GewaehrleistungInput,
): GewaehrleistungResult {
  const emptySnapshot: GewaehrleistungResult = {
    baseEndsOn: null,
    presumptionEndsOn: null,
    ruleVersion: null,
  };
  if (!input.contractConcludedAt || !input.handedOverAt) return emptySnapshot;

  const ruleSet = resolveGewaehrleistungRuleSet(input.contractConcludedAt);
  if (!ruleSet) {
    return {
      ...emptySnapshot,
      error: {
        code: 'GEWAEHRLEISTUNG_RULE_NOT_AVAILABLE',
        message: 'Für Verträge vor dem 01.01.2022 ist keine Regel hinterlegt.',
      },
    };
  }
  const snapshot = { ...emptySnapshot, ruleVersion: ruleSet.id };
  const error = validateShortening(
    { ...input, handedOverAt: input.handedOverAt },
    ruleSet,
  );
  if (error) return { ...snapshot, error };
  if (!input.buyerIsConsumer) return snapshot;

  const baseYears = input.shortenedNegotiated
    ? ruleSet.shortenedPeriodYears
    : ruleSet.basePeriodYears;
  return {
    baseEndsOn: addCalendarYears(input.handedOverAt, baseYears),
    presumptionEndsOn: addCalendarYears(
      input.handedOverAt,
      ruleSet.presumptionPeriodYears,
    ),
    ruleVersion: ruleSet.id,
  };
}
