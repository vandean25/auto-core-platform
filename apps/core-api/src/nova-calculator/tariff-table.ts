import type { NovaTariffVersion, NovaVehicleClass } from './types.js';

const BMF_2021_2025 =
  'https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-steuersatz/rechtslage_von_1_juli_2021_bis_30_Juni_2025.html';
const BMF_AB_JUL_2025 =
  'https://www.bmf.gv.at/themen/steuern/kraftfahrzeuge/normverbrauchsabgabe-uebersicht/nova-steuersatz/rechtslage_ab_1_juli_2025.html';
const RETRIEVED = '2026-10-02';

function m1Row(
  id: string,
  valid_from: string,
  valid_to: string,
  co2_deduction_g: number,
  max_rate_percent: number,
  malus_threshold_g: number,
  malus_eur_per_g: number,
  source_url: string,
): NovaTariffVersion {
  return {
    id,
    vehicle_class: 'm1_z3',
    valid_from,
    valid_to,
    co2_deduction_g,
    rate_divisor: 5,
    max_rate_percent,
    malus_threshold_g,
    malus_eur_per_g,
    flat_deduction_eur: 350,
    source_url,
    source_retrieved: RETRIEVED,
  };
}

function n1Row(
  id: string,
  valid_from: string,
  valid_to: string,
  co2_deduction_g: number,
  max_rate_percent: number,
  malus_threshold_g: number,
  malus_eur_per_g: number,
  source_url: string,
): NovaTariffVersion {
  return {
    id,
    vehicle_class: 'n1_z3',
    valid_from,
    valid_to,
    co2_deduction_g,
    rate_divisor: 5,
    max_rate_percent,
    malus_threshold_g,
    malus_eur_per_g,
    flat_deduction_eur: 350,
    source_url,
    source_retrieved: RETRIEVED,
  };
}

/** Git-versioned tariff data — annual BMF changes are new rows, not code changes. */
export const NOVA_TARIFF_TABLE: readonly NovaTariffVersion[] = [
  m1Row(
    'at-m1-2021-h2',
    '2021-07-01',
    '2021-12-31',
    112,
    50,
    200,
    50,
    BMF_2021_2025,
  ),
  m1Row(
    'at-m1-2022',
    '2022-01-01',
    '2022-12-31',
    107,
    60,
    185,
    60,
    BMF_2021_2025,
  ),
  m1Row(
    'at-m1-2023',
    '2023-01-01',
    '2023-12-31',
    102,
    70,
    170,
    70,
    BMF_2021_2025,
  ),
  m1Row(
    'at-m1-2024',
    '2024-01-01',
    '2024-12-31',
    97,
    80,
    155,
    80,
    BMF_2021_2025,
  ),
  m1Row(
    'at-m1-2025-h1',
    '2025-01-01',
    '2025-06-30',
    94,
    80,
    155,
    80,
    BMF_2021_2025,
  ),
  m1Row(
    'at-m1-2025-h2',
    '2025-07-01',
    '2025-12-31',
    94,
    80,
    155,
    80,
    BMF_AB_JUL_2025,
  ),
  m1Row(
    'at-m1-2026',
    '2026-01-01',
    '2026-12-31',
    91,
    80,
    155,
    80,
    BMF_AB_JUL_2025,
  ),
  m1Row(
    'at-m1-2027',
    '2027-01-01',
    '2027-12-31',
    88,
    80,
    155,
    80,
    BMF_AB_JUL_2025,
  ),
  m1Row(
    'at-m1-2028',
    '2028-01-01',
    '2028-12-31',
    85,
    80,
    155,
    80,
    BMF_AB_JUL_2025,
  ),
  m1Row(
    'at-m1-2029',
    '2029-01-01',
    '2029-12-31',
    82,
    80,
    155,
    80,
    BMF_AB_JUL_2025,
  ),
  n1Row(
    'at-n1-2021-h2',
    '2021-07-01',
    '2021-12-31',
    165,
    50,
    253,
    50,
    BMF_2021_2025,
  ),
  n1Row(
    'at-n1-2025-h1',
    '2025-01-01',
    '2025-06-30',
    147,
    80,
    208,
    80,
    BMF_2021_2025,
  ),
];

export function getTariffVersionById(
  id: string,
): NovaTariffVersion | undefined {
  return NOVA_TARIFF_TABLE.find((row) => row.id === id);
}

export function resolveTariffVersion(
  vehicleClass: NovaVehicleClass,
  referenceDateIso: string,
): NovaTariffVersion | undefined {
  const ref = referenceDateIso.slice(0, 10);
  return NOVA_TARIFF_TABLE.find(
    (row) =>
      row.vehicle_class === vehicleClass &&
      row.valid_from <= ref &&
      ref <= row.valid_to,
  );
}
