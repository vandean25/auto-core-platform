/**
 * Parses German-formatted numbers (decimal comma, thousands dot/space)
 * as well as standard numbers and negative values.
 *
 * Examples:
 * - "1.234,50" -> 1234.5
 * - "1234,50" -> 1234.5
 * - "12,5" -> 12.5
 * - "12.50" -> 12.5
 * - "1 234,50" -> 1234.5
 * - "-1.234,50" -> -1234.5
 * - Invalid/empty -> null
 */
export function parseGermanNumber(
  raw: string | number | null | undefined,
): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }

  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  // Remove any whitespace (standard spaces, non-breaking spaces \u00A0, etc.)
  let s = trimmed.replace(/\s+/g, '');

  let isNegative = false;
  if (s.startsWith('-')) {
    isNegative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }

  if (s === '') {
    return null;
  }

  // Must only contain digits, dots, and commas
  if (!/^[0-9.,]+$/.test(s)) {
    return null;
  }

  const dotCount = (s.match(/\./g) ?? []).length;
  const commaCount = (s.match(/,/g) ?? []).length;

  let normalizedStr: string;

  if (dotCount > 0 && commaCount > 0) {
    const lastDotIndex = s.lastIndexOf('.');
    const lastCommaIndex = s.lastIndexOf(',');

    if (lastDotIndex < lastCommaIndex) {
      // German format: dots are thousand separators, comma is decimal (e.g. 1.234,50)
      if (commaCount > 1) {
        return null;
      }
      const [intPart, decPart] = s.split(',');
      const groups = intPart.split('.');
      // Verify valid thousand groups
      for (let i = 1; i < groups.length; i += 1) {
        if (groups[i].length !== 3) {
          return null;
        }
      }
      normalizedStr = `${intPart.replace(/\./g, '')}.${decPart}`;
    } else {
      // Anglo-Saxon format: commas are thousand separators, dot is decimal (e.g. 1,234.50)
      if (dotCount > 1) {
        return null;
      }
      const [intPart, decPart] = s.split('.');
      const groups = intPart.split(',');
      for (let i = 1; i < groups.length; i += 1) {
        if (groups[i].length !== 3) {
          return null;
        }
      }
      normalizedStr = `${intPart.replace(/,/g, '')}.${decPart}`;
    }
  } else if (commaCount > 0) {
    // Only commas: exactly one comma represents the decimal separator
    if (commaCount > 1) {
      return null;
    }
    normalizedStr = s.replace(',', '.');
  } else if (dotCount > 0) {
    if (dotCount === 1) {
      // Single dot represents decimal separator (e.g. 12.50)
      normalizedStr = s;
    } else {
      // Multiple dots represent German thousand separators (e.g. 1.234.567)
      const groups = s.split('.');
      for (let i = 1; i < groups.length; i += 1) {
        if (groups[i].length !== 3) {
          return null;
        }
      }
      normalizedStr = s.replace(/\./g, '');
    }
  } else {
    // Pure integer
    normalizedStr = s;
  }

  const num = Number(normalizedStr);
  if (!Number.isFinite(num)) {
    return null;
  }

  return isNegative ? -num : num;
}
