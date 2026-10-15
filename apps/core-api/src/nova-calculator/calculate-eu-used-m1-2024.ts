import { roundMoneyEuro, roundToWholePercent } from './rounding.js';
import { getTariffVersionById } from './tariff-table.js';
import { validateNovaIsoDate } from './calculate-nova.js';
import {
  NovaCalculationError,
  type NovaCalculationErrorCode,
  type NovaVehicleClass,
} from './types.js';

const SLICE_TARIFF_ID = 'at-m1-2024';
const SLICE_REG_FROM = '2024-01-01';
const SLICE_REG_TO = '2024-12-31';
const SLICE_EVENT_TO = '2026-12-31';
const TABLE_EARLIEST = '2021-07-01';

export type EuUsedM1ValueBasis = 'known_new_net' | 'achtelung';

export interface EuUsedM1SliceInput {
  vehicleClass?: NovaVehicleClass;
  driveType?: string;
  emissionCycle?: string;
  co2GramsPerKm?: number;
  firstRegistrationDate?: string;
  taxableEventDate?: string;
  netPriceEuro: number;
  valueBasis?: string;
  originalNewNetEuro?: number;
  isCamperSA?: boolean;
}

export interface NovaValueDevelopmentFactor {
  numerator: number;
  denominator: number;
}

export interface NovaCalculationIntermediates {
  rateRaw: string;
  baseAmountEuro: number;
  malusGrossEuro: number;
  deductionGrossEuro: number;
  fixedBeforeDevelopmentEuro: number;
  fullYearsElapsed: number;
  valueDevelopmentFactor: NovaValueDevelopmentFactor;
  fixedAfterDevelopmentEuro: number;
  valueBasis: EuUsedM1ValueBasis;
}

export interface EuUsedM1SliceResult {
  novaAmountEuro: number;
  tariffVersionId: string;
  tariffSelectionBasis: 'first_eu_registration';
  tariffSelectionDate: string;
  appliedRuleIds: string[];
  warnings: string[];
  ratePercentApplied: number;
  effectiveCo2GramsPerKm: number;
  intermediates: NovaCalculationIntermediates;
}

function reject(code: NovaCalculationErrorCode, message: string): never {
  throw new NovaCalculationError(code, message);
}

function formatRateRaw(
  effectiveCo2: number,
  co2Deduction: number,
  divisor: number,
): string {
  const numerator = effectiveCo2 - co2Deduction;
  return `${numerator}/${divisor}`;
}

function isoCompare(a: string, b: string): number {
  return a.localeCompare(b);
}

function isIn2024Slice(registration: string): boolean {
  return (
    isoCompare(registration, SLICE_REG_FROM) >= 0 &&
    isoCompare(registration, SLICE_REG_TO) <= 0
  );
}

/** Add calendar years; clamp missing anniversary days to the last day of the month. */
export function addRegistrationAnniversary(
  registrationIso: string,
  years: number,
): string {
  const [year, month, day] = registrationIso.split('-').map(Number);
  const targetYear = year + years;
  const parsed = new Date(Date.UTC(targetYear, month - 1, day));
  if (
    parsed.getUTCFullYear() !== targetYear ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, '0');
    const dd = String(lastDay).padStart(2, '0');
    return `${targetYear}-${mm}-${dd}`;
  }
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

export function completedFullYearsElapsed(
  firstRegistrationDate: string,
  taxableEventDate: string,
): number {
  let years = 0;
  while (true) {
    const next = addRegistrationAnniversary(firstRegistrationDate, years + 1);
    if (isoCompare(next, taxableEventDate) <= 0) {
      years += 1;
    } else {
      return years;
    }
  }
}

function assertNetPrice(netPriceEuro: number): void {
  if (!Number.isFinite(netPriceEuro) || netPriceEuro < 0) {
    reject(
      'INVALID_NET_PRICE',
      'netPriceEuro must be a non-negative finite number',
    );
  }
}

function validateEuUsedM1Gates(input: EuUsedM1SliceInput): {
  firstRegistrationDate: string;
  taxableEventDate: string;
  valueBasis: EuUsedM1ValueBasis;
  originalNewNetEuro?: number;
} {
  const firstRegistrationDate = input.firstRegistrationDate;
  if (firstRegistrationDate === undefined || firstRegistrationDate === '') {
    reject(
      'MISSING_FIRST_REGISTRATION',
      'eu_used_m1 requires firstRegistrationDate',
    );
  }
  const taxableEventDate = input.taxableEventDate;
  if (taxableEventDate === undefined || taxableEventDate === '') {
    reject(
      'MISSING_TAXABLE_EVENT_DATE',
      'eu_used_m1 requires taxableEventDate',
    );
  }

  const reg = validateNovaIsoDate(firstRegistrationDate, 'firstRegistrationDate');
  const event = validateNovaIsoDate(taxableEventDate, 'taxableEventDate');

  if (isoCompare(event, reg) < 0) {
    reject(
      'INVALID_IMPORT_DATES',
      'taxableEventDate must be on or after firstRegistrationDate',
    );
  }

  if (input.vehicleClass === undefined) {
    reject('MISSING_VEHICLE_CLASS', 'eu_used_m1 requires vehicleClass');
  }
  if (input.vehicleClass !== 'passenger_z3') {
    reject(
      'UNSUPPORTED_IMPORT_CLASS',
      'eu_used_m1 slice EU-M1-2024 accepts only vehicleClass passenger_z3',
    );
  }

  if (isoCompare(reg, TABLE_EARLIEST) < 0) {
    reject(
      'UNSUPPORTED_HISTORICAL_TARIFF',
      'No passenger_z3 tariff row exists for firstRegistrationDate before 2021-07-01',
    );
  }

  if (!isIn2024Slice(reg) || isoCompare(event, SLICE_EVENT_TO) > 0) {
    reject(
      'OUTSIDE_SUPPORTED_SLICE',
      'eu_used_m1 slice EU-M1-2024 accepts firstRegistrationDate in 2024 and taxableEventDate from that date through 2026-12-31',
    );
  }

  if (input.driveType !== 'ICE') {
    reject(
      'UNSUPPORTED_DRIVE_TYPE',
      'eu_used_m1 slice EU-M1-2024 accepts only driveType ICE',
    );
  }

  if (input.emissionCycle !== 'WLTP') {
    reject(
      'UNSUPPORTED_EMISSION_CYCLE',
      'eu_used_m1 slice EU-M1-2024 accepts only emissionCycle WLTP',
    );
  }

  if (input.isCamperSA === true) {
    reject(
      'UNSUPPORTED_CAMPER_SA',
      'eu_used_m1 slice EU-M1-2024 does not accept isCamperSA',
    );
  }

  const co2 = input.co2GramsPerKm;
  if (co2 === undefined) {
    reject(
      'MISSING_CO2',
      'eu_used_m1 slice EU-M1-2024 requires co2GramsPerKm',
    );
  }
  if (!Number.isFinite(co2) || co2 < 0) {
    reject(
      'INVALID_CO2',
      'co2GramsPerKm must be a non-negative finite number',
    );
  }
  if (!Number.isInteger(co2)) {
    reject(
      'UNSUPPORTED_FRACTIONAL_CO2',
      'eu_used_m1 slice EU-M1-2024 requires an integer co2GramsPerKm',
    );
  }

  assertNetPrice(input.netPriceEuro);

  const valueBasis = input.valueBasis;
  if (valueBasis === undefined) {
    reject(
      'MISSING_VALUE_DEVELOPMENT',
      'eu_used_m1 requires valueBasis known_new_net or achtelung',
    );
  }
  if (valueBasis !== 'known_new_net' && valueBasis !== 'achtelung') {
    reject(
      'INVALID_VALUE_BASIS',
      'valueBasis must be known_new_net or achtelung',
    );
  }

  let originalNewNetEuro: number | undefined;
  if (valueBasis === 'known_new_net') {
    const original = input.originalNewNetEuro;
    if (
      original === undefined ||
      !Number.isFinite(original) ||
      original <= 0
    ) {
      reject(
        'MISSING_ORIGINAL_NEW_NET',
        'known_new_net requires originalNewNetEuro greater than zero',
      );
    }
    originalNewNetEuro = original;
  }

  return {
    firstRegistrationDate: reg,
    taxableEventDate: event,
    valueBasis,
    originalNewNetEuro,
  };
}

export function calculateEuUsedM1Slice2024(
  input: EuUsedM1SliceInput,
): EuUsedM1SliceResult {
  const validated = validateEuUsedM1Gates(input);
  const { firstRegistrationDate, taxableEventDate, valueBasis, originalNewNetEuro } =
    validated;

  const tariff = getTariffVersionById(SLICE_TARIFF_ID);
  if (!tariff || tariff.vehicle_class !== 'passenger_z3') {
    reject(
      'UNKNOWN_TARIFF_VERSION',
      `Unknown tariff version: ${SLICE_TARIFF_ID}`,
    );
  }

  const effectiveCo2 = input.co2GramsPerKm!;
  const appliedRuleIds: string[] = [
    'import.eu_used_m1.slice_2024',
    'tariff.selected_by_first_eu_registration',
  ];

  const rateRawValue =
    (effectiveCo2 - tariff.co2_deduction_g) / tariff.rate_divisor;
  const rateRaw = formatRateRaw(
    effectiveCo2,
    tariff.co2_deduction_g,
    tariff.rate_divisor,
  );
  appliedRuleIds.push('tariff.co2_rate_formula');
  if (rateRawValue < 0) {
    appliedRuleIds.push('tariff.rate_floor_zero');
  }
  let ratePercent = Math.max(0, roundToWholePercent(rateRawValue));
  if (ratePercent > tariff.max_rate_percent) {
    ratePercent = tariff.max_rate_percent;
    appliedRuleIds.push('tariff.max_rate_cap');
  }

  const baseAmountEuro = roundMoneyEuro(
    (input.netPriceEuro * ratePercent) / 100,
  );
  appliedRuleIds.push('tariff.base_on_net_price');

  const malusGrossEuro =
    effectiveCo2 > tariff.malus_threshold_g
      ? (effectiveCo2 - tariff.malus_threshold_g) * tariff.malus_eur_per_g
      : 0;
  if (malusGrossEuro > 0) {
    appliedRuleIds.push('tariff.malus_per_gram');
  }
  const deductionGrossEuro = tariff.flat_deduction_eur;
  appliedRuleIds.push('tariff.flat_deduction');

  const fixedBeforeDevelopmentEuro = malusGrossEuro - deductionGrossEuro;
  const fullYearsElapsed = completedFullYearsElapsed(
    firstRegistrationDate,
    taxableEventDate,
  );

  let valueDevelopmentFactor: NovaValueDevelopmentFactor;
  if (valueBasis === 'known_new_net') {
    valueDevelopmentFactor = {
      numerator: input.netPriceEuro,
      denominator: originalNewNetEuro!,
    };
    appliedRuleIds.push('wertentwicklung.known_new_net');
  } else {
    const cappedYears = Math.min(fullYearsElapsed, 7);
    valueDevelopmentFactor = {
      numerator: 8 - cappedYears,
      denominator: 8,
    };
    appliedRuleIds.push('wertentwicklung.achtelung');
  }

  const factor =
    valueDevelopmentFactor.numerator / valueDevelopmentFactor.denominator;
  const fixedAfterDevelopmentEuro = roundMoneyEuro(
    fixedBeforeDevelopmentEuro * factor,
  );

  let novaAmountEuro = baseAmountEuro + fixedAfterDevelopmentEuro;
  if (novaAmountEuro < 0) {
    novaAmountEuro = 0;
    appliedRuleIds.push('tariff.no_tax_credit_floor');
  } else {
    novaAmountEuro = roundMoneyEuro(novaAmountEuro);
  }

  return {
    novaAmountEuro,
    tariffVersionId: SLICE_TARIFF_ID,
    tariffSelectionBasis: 'first_eu_registration',
    tariffSelectionDate: firstRegistrationDate,
    appliedRuleIds,
    warnings: [],
    ratePercentApplied: ratePercent,
    effectiveCo2GramsPerKm: effectiveCo2,
    intermediates: {
      rateRaw,
      baseAmountEuro,
      malusGrossEuro,
      deductionGrossEuro,
      fixedBeforeDevelopmentEuro,
      fullYearsElapsed,
      valueDevelopmentFactor,
      fixedAfterDevelopmentEuro,
      valueBasis,
    },
  };
}
