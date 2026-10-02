export type EmissionCycle = 'WLTP' | 'NEDC';

export type NovaDriveType = 'BEV' | 'FCEV' | 'PHEV' | 'ICE' | 'OTHER';

/** § 2 Abs. 1 Z 3 (passenger), legacy § 6 Abs. 3 N1, § 2 Z 1–2 motorcycles. */
export type NovaVehicleClass =
  'passenger_z3' | 'n1_legacy_z6' | 'motorcycle_z1_z2';

export interface CalculateNovaInput {
  co2GramsPerKm?: number;
  emissionCycle: EmissionCycle;
  netPriceEuro: number;
  driveType: NovaDriveType;
  /** Lieferung, IG-Erwerb, or Zulassung — drives tariff resolution. */
  taxableEventDate: string;
  /** Optional; used for § 6 Abs. 8 / Wertentwicklung warnings only in v1. */
  firstRegistrationDate?: string;
  vehicleClass?: NovaVehicleClass;
  /** § 6 Abs. 6 Z 2 — substitute when CO₂ is absent (Z 3 only). */
  ratedPowerKw?: number;
  /** § 6 Abs. 6 Z 1 — motorcycle hubraum rate when CO₂ absent. */
  displacementCc?: number;
  /** Wohnmobil Aufbauart SA: 16% minimum when using 2×kW basis (§ 6 Abs. 6 Z 4). */
  isCamperSA?: boolean;
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
  | 'INVALID_NEDC_CYCLE'
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
