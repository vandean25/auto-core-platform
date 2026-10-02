import { roundMoneyEuro, roundToWholePercent } from './rounding.js';
import { getTariffVersionById } from './tariff-table.js';
import {
  NovaCalculationError,
  type CalculateNovaInput,
  type CalculateNovaResult,
  type NovaTariffVersion,
} from './types.js';

const NEDC_TO_WLTP_FACTOR = 1.27;

function assertNetPrice(netPriceEuro: number): void {
  if (!Number.isFinite(netPriceEuro) || netPriceEuro < 0) {
    throw new NovaCalculationError(
      'INVALID_NET_PRICE',
      'netPriceEuro must be a non-negative finite number',
    );
  }
}

function isZeroEmissionExempt(driveType: CalculateNovaInput['driveType']): boolean {
  return driveType === 'BEV' || driveType === 'FCEV';
}

function resolveEffectiveCo2(input: CalculateNovaInput): number {
  if (input.co2GramsPerKm !== undefined && input.co2GramsPerKm !== null) {
    let co2 = input.co2GramsPerKm;
    if (input.emissionCycle === 'NEDC') {
      co2 = co2 * NEDC_TO_WLTP_FACTOR;
    }
    return co2;
  }
  if (input.ratedPowerKw !== undefined && input.ratedPowerKw !== null) {
    return input.ratedPowerKw * 2;
  }
  throw new NovaCalculationError(
    'MISSING_CO2',
    'co2GramsPerKm is required unless drive type is BEV/FCEV or ratedPowerKw is provided',
  );
}

function computeRatePercent(
  effectiveCo2: number,
  tariff: NovaTariffVersion,
  appliedRuleIds: string[],
): number {
  const raw =
    (effectiveCo2 - tariff.co2_deduction_g) / tariff.rate_divisor;
  appliedRuleIds.push('tariff.co2_rate_formula');
  let rate = Math.max(0, roundToWholePercent(raw));
  if (raw < 0) {
    appliedRuleIds.push('tariff.rate_floor_zero');
  }
  if (rate > tariff.max_rate_percent) {
    rate = tariff.max_rate_percent;
    appliedRuleIds.push('tariff.max_rate_cap');
  }
  if (tariff.min_rate_percent !== undefined && rate < tariff.min_rate_percent) {
    rate = tariff.min_rate_percent;
    appliedRuleIds.push('tariff.min_rate_floor');
  }
  return rate;
}

function computeMalus(
  effectiveCo2: number,
  tariff: NovaTariffVersion,
  appliedRuleIds: string[],
): number {
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

  const appliedRuleIds: string[] = [];
  const warnings: string[] = [];

  if (input.driveType === 'PHEV') {
    warnings.push('phev_weighted_wltp');
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

  const effectiveCo2 = resolveEffectiveCo2(input);
  if (effectiveCo2 === 0) {
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

  if (input.emissionCycle === 'NEDC') {
    appliedRuleIds.push('co2.nedc_to_wltp_factor');
  }
  if (
    input.co2GramsPerKm === undefined &&
    input.ratedPowerKw !== undefined
  ) {
    appliedRuleIds.push('co2.substitute_double_kw');
  }

  const ratePercent = computeRatePercent(effectiveCo2, tariff, appliedRuleIds);
  const baseAmount = (input.netPriceEuro * ratePercent) / 100;
  appliedRuleIds.push('tariff.base_on_net_price');

  const malus = computeMalus(effectiveCo2, tariff, appliedRuleIds);
  let total = baseAmount + malus - tariff.flat_deduction_eur;
  if (total < 0) {
    total = 0;
    appliedRuleIds.push('tariff.no_tax_credit_floor');
  }
  appliedRuleIds.push('tariff.flat_deduction');

  return {
    novaAmountEuro: roundMoneyEuro(total),
    tariffVersionId: tariff.id,
    appliedRuleIds,
    warnings,
    ratePercentApplied: ratePercent,
    effectiveCo2GramsPerKm: effectiveCo2,
  };
}
