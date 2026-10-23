/** Shared by vehicle import and global search: spaces, hyphens and dots are dropped, letters upper-cased. */
export function normalizePlate(
  value: string | null | undefined,
): string | null {
  const normalized = value?.replace(/[\s.-]+/g, '').toUpperCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}
