/**
 * Normalizes decoder make labels for VehicleMakeAlias lookup.
 * Uppercase alphanumeric only; diacritics stripped (Citroën → CITROEN).
 */
export function normalizeVehicleMakeAlias(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
