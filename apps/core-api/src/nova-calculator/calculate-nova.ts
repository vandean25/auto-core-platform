import { roundMoneyEuro, roundToWholePercent } from './rounding.js';
import { getTariffVersionById } from './tariff-table.js';
import {
  NovaCalculationError,
  type CalculateNovaInput,
  type CalculateNovaResult,
  type NovaTariffVersion,
  type NovaVehicleClass,
} from './types.js';

const NEDC_TO_WLTP_FACTOR = 1.27;
const CAMPER_SA_MIN_RATE_PERCENT = 16;

function assertNetPrice(netPriceEuro: number): void {
  if (!Number.isFinite(netPriceEuro) || netPriceEuro < 0) {
    throw new NovaCalculationError(
      'INVALID_NET_PRICE',
      'netPriceEuro must be a non-negative finite number',
    );
  }
}

function assertNonNegativeFinite(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new NovaCalculationError(
      'INVALID_CO2',
      `${fieldName} must be a non-negative finite number`,
    );
  }
}

function vehicleClass(input: CalculateNovaInput): NovaVehicleClass {
  return input.vehicleClass ?? 'passenger_z3';
}

function isZeroEmissionExempt(
  driveType: CalculateNovaInput['driveType'],
): boolean {
  return driveType === 'BEV' || driveType === 'FCEV';
}

function motorcycleHubraumRatePercent(displacementCc: number): number {
  const raw = (displacementCc - 100) * 0.02;
  return Math.min(30, Math.max(0, roundToWholePercent(raw)));
}

function resolveEffectiveCo2(
  input: CalculateNovaInput,
  vClass: NovaVehicleClass,
  appliedRuleIds: string[],
  warnings: string[],
): number {
  if (input.co2GramsPerKm !== undefined) {
    assertNonNegativeFinite(input.co2GramsPerKm, 'co2GramsPerKm');
    let co2 = input.co2GramsPerKm;
    if (input.emissionCycle === 'NEDC') {
      if (vClass !== 'passenger_z3') {
        throw new NovaCalculationError(
          'INVALID_NEDC_CYCLE',
          'NEDC emission cycle applies only to passenger_z3 vehicles',
        );
      }
      co2 = co2 * NEDC_TO_WLTP_FACTOR;
      appliedRuleIds.push('co2.nedc_to_wltp_factor');
      if (!Number.isInteger(co2)) {
        warnings.push('nedc_fractional_co2_unverified');
      }
    }
    return co2;
  }
  if (vClass === 'motorcycle_z1_z2') {
    if (input.displacementCc !== undefined) {
      assertNonNegativeFinite(input.displacementCc, 'displacementCc');
      appliedRuleIds.push('co2.substitute_motorcycle_hubraum');
      return 0;
    }
  }
  if (
    (vClass === 'passenger_z3' || vClass === 'n1_legacy_z6') &&
    input.ratedPowerKw !== undefined
  ) {
    assertNonNegativeFinite(input.ratedPowerKw, 'ratedPowerKw');
    appliedRuleIds.push('co2.substitute_double_kw');
    return input.ratedPowerKw * 2;
  }
  throw new NovaCalculationError(
    'MISSING_CO2',
    'co2GramsPerKm is required unless drive type is BEV/FCEV or a class-specific substitute is provided',
  );
}

function computeRatePercent(
  effectiveCo2: number,
  tariff: NovaTariffVersion,
  input: CalculateNovaInput,
  appliedRuleIds: string[],
  usedZ2Substitute: boolean,
): number {
  if (
    tariff.vehicle_class === 'motorcycle_z1_z2' &&
    input.co2GramsPerKm === undefined &&
    input.displacementCc !== undefined
  ) {
    appliedRuleIds.push('tariff.motorcycle_hubraum_formula');
    return motorcycleHubraumRatePercent(input.displacementCc);
  }

  const raw = (effectiveCo2 - tariff.co2_deduction_g) / tariff.rate_divisor;
  appliedRuleIds.push('tariff.co2_rate_formula');
  let rate = Math.max(0, roundToWholePercent(raw));
  if (raw < 0) {
    appliedRuleIds.push('tariff.rate_floor_zero');
  }
  if (rate > tariff.max_rate_percent) {
    rate = tariff.max_rate_percent;
    appliedRuleIds.push('tariff.max_rate_cap');
  }
  if (
    input.isCamperSA &&
    usedZ2Substitute &&
    rate < CAMPER_SA_MIN_RATE_PERCENT
  ) {
    rate = CAMPER_SA_MIN_RATE_PERCENT;
    appliedRuleIds.push('tariff.camper_sa_min_rate');
  }
  return rate;
}

function computeMalus(
  effectiveCo2: number,
  tariff: NovaTariffVersion,
  appliedRuleIds: string[],
  skipMalus: boolean,
): number {
  if (skipMalus || effectiveCo2 <= 0) {
    return 0;
  }
  if (effectiveCo2 <= tariff.malus_threshold_g) {
    return 0;
  }
  appliedRuleIds.push('tariff.malus_per_gram');
  const gramsOver = effectiveCo2 - tariff.malus_threshold_g;
  return gramsOver * tariff.malus_eur_per_g;
}

export function calculateNova(
  input: CalculateNovaInput,
  tariffVersionId: string,
): CalculateNovaResult {
  assertNetPrice(input.netPriceEuro);

  const tariff = getTariffVersionById(tariffVersionId);
  if (!tariff) {
    throw new NovaCalculationError(
      'UNKNOWN_TARIFF_VERSION',
      `Unknown tariff version: ${tariffVersionId}`,
    );
  }

  const vClass = vehicleClass(input);
  if (tariff.vehicle_class !== vClass) {
    throw new NovaCalculationError(
      'TARIFF_CLASS_MISMATCH',
      `Tariff ${tariff.id} is for ${tariff.vehicle_class}, input is ${vClass}`,
    );
  }

  const appliedRuleIds: string[] = [];
  const warnings: string[] = [];

  if (input.driveType === 'PHEV') {
    warnings.push('phev_weighted_wltp');
  }
  if (input.firstRegistrationDate) {
    warnings.push('wertentwicklung_not_applied');
    warnings.push('eu_import_tariff_hint');
    const reg = input.firstRegistrationDate.slice(0, 10);
    if (reg < tariff.valid_from || reg > tariff.valid_to) {
      warnings.push('tariff_outside_registration_date');
    }
  }

  if (isZeroEmissionExempt(input.driveType)) {
    appliedRuleIds.push('exempt.z3.zero_co2');
    return {
      novaAmountEuro: 0,
      tariffVersionId: tariff.id,
      appliedRuleIds,
      warnings,
      ratePercentApplied: 0,
      effectiveCo2GramsPerKm: 0,
    };
  }

  const usedKwSubstitute =
    input.co2GramsPerKm === undefined &&
    input.ratedPowerKw !== undefined &&
    vClass !== 'motorcycle_z1_z2';
  const usedNedcZ2Substitute =
    input.co2GramsPerKm !== undefined &&
    input.emissionCycle === 'NEDC' &&
    vClass === 'passenger_z3';
  const usedZ2Substitute = usedKwSubstitute || usedNedcZ2Substitute;

  const effectiveCo2 = resolveEffectiveCo2(
    input,
    vClass,
    appliedRuleIds,
    warnings,
  );
  if (input.co2GramsPerKm === 0) {
    appliedRuleIds.push('exempt.z3.zero_co2');
    return {
      novaAmountEuro: 0,
      tariffVersionId: tariff.id,
      appliedRuleIds,
      warnings,
      ratePercentApplied: 0,
      effectiveCo2GramsPerKm: 0,
    };
  }

  if (
    !Number.isInteger(effectiveCo2) &&
    effectiveCo2 > 0 &&
    !warnings.includes('nedc_fractional_co2_unverified')
  ) {
    warnings.push('fractional_co2_unverified');
  }

  const skipMalus =
    tariff.vehicle_class === 'motorcycle_z1_z2' &&
    input.co2GramsPerKm === undefined &&
    input.displacementCc !== undefined;

  const ratePercent = computeRatePercent(
    effectiveCo2,
    tariff,
    input,
    appliedRuleIds,
    usedZ2Substitute,
  );
  const baseAmount = (input.netPriceEuro * ratePercent) / 100;
  appliedRuleIds.push('tariff.base_on_net_price');

  const malus = computeMalus(effectiveCo2, tariff, appliedRuleIds, skipMalus);
  let total = baseAmount + malus - tariff.flat_deduction_eur;
  if (total < 0) {
    total = 0;
    appliedRuleIds.push('tariff.no_tax_credit_floor');
  }
  if (tariff.flat_deduction_eur > 0) {
    appliedRuleIds.push('tariff.flat_deduction');
  }

  return {
    novaAmountEuro: roundMoneyEuro(total),
    tariffVersionId: tariff.id,
    appliedRuleIds,
    warnings,
    ratePercentApplied: ratePercent,
    effectiveCo2GramsPerKm: effectiveCo2,
  };
}
