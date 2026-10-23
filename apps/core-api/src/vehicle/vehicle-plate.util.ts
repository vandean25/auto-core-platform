// Explicit set (not \s) so the SQL backfill in the AUT-662 migration can mirror it exactly.
const PLATE_SEPARATORS = /[ \t\n\r\f\v\u00a0\ufeff.-]+/g;

/** Shared by vehicle import and global search: spaces, hyphens and dots are dropped, letters upper-cased. */
export function normalizePlate(
  value: string | null | undefined,
): string | null {
  const normalized = value?.replace(PLATE_SEPARATORS, '').toUpperCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}

/**
 * Every vehicle write that sets `plate` runs its data through this, so `plate_normalized` (the search column)
 * cannot drift. Data that does not write the plate is returned as is.
 */
export function withPlateNormalized<T extends { plate?: unknown }>(
  data: T,
): T & { plate_normalized?: string | null } {
  const { plate } = data;
  if (plate === undefined) {
    return data;
  }
  const value =
    plate !== null && typeof plate === 'object' && 'set' in plate
      ? plate.set
      : plate;
  return {
    ...data,
    plate_normalized: normalizePlate(typeof value === 'string' ? value : null),
  };
}
