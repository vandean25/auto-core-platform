/**
 * Parse a date string as local date, not UTC.
 * 
 * ISO date strings like "2026-03-07" are treated as UTC by new Date(),
 * causing one-day drift in negative timezones. This function detects
 * date-only strings and constructs a local Date instead.
 * 
 * @param dateString - ISO date string (YYYY-MM-DD) or full datetime
 * @returns Date object representing the intended calendar day in local timezone,
 *          or null if invalid/empty
 */
export function parseLocalDate(dateString?: string | null): Date | null {
  if (!dateString) return null;

  // Trim and validate
  const trimmed = dateString.trim();
  if (!trimmed) return null;

  // Detect date-only format (YYYY-MM-DD without time)
  const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (dateOnlyRegex.test(trimmed)) {
    // Parse as local date to avoid UTC interpretation
    const [year, month, day] = trimmed.split('-').map(Number);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
      return null;
    }
    return new Date(year, month - 1, day); // month is 0-indexed
  }

  // Fall back to standard parsing for full datetime strings
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}
