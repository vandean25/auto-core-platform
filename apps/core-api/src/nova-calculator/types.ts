export type EmissionCycle = 'WLTP' | 'NEDC';

export type NovaDriveType = 'BEV' | 'FCEV' | 'PHEV' | 'ICE' | 'OTHER';

export type NovaVehicleClass = 'm1_z3' | 'n1_z3' | 'motorcycle_z1_z2';

export interface CalculateNovaInput {
  co2GramsPerKm?: number;
  emissionCycle: EmissionCycle;
  netPriceEuro: number;
  driveType: NovaDriveType;
  firstRegistrationDate: string;
  vehicleClass?: NovaVehicleClass;
  /** § 6 Abs. 6 — substitute when CO₂ is absent (2 × kW). */
  ratedPowerKw?: number;
}

export interface NovaTariffVersion {
  id: string;
  vehicle_class: NovaVehicleClass;
  valid_from: string;
  valid_to: string;
  co2_deduction_g: number;
  rate_divisor: number;
  max_rate_percent: number;
  malus_threshold_g: number;
  malus_eur_per_g: number;
  flat_deduction_eur: number;
  min_rate_percent?: number;
  source_url: string;
  source_retrieved: string;
}

export interface CalculateNovaResult {
  novaAmountEuro: number;
  tariffVersionId: string;
  appliedRuleIds: string[];
  warnings: string[];
  ratePercentApplied: number;
  effectiveCo2GramsPerKm: number;
}

export type NovaCalculationErrorCode =
  | 'MISSING_CO2'
  | 'UNKNOWN_TARIFF_VERSION'
  | 'INVALID_NET_PRICE';

export class NovaCalculationError extends Error {
  readonly code: NovaCalculationErrorCode;

  constructor(code: NovaCalculationErrorCode, message: string) {
    super(message);
    this.name = 'NovaCalculationError';
    this.code = code;
  }
}
