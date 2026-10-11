import type { ImportJobOptions } from './import.types.js';

function isBlankValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function hasFilledValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  return typeof value !== 'string' || value.trim() !== '';
}

/**
 * Builds the write set of an update from the planned values. Blank values never overwrite.
 * With fill_empty_only, a non-empty stored value is kept.
 */
export function assignImportUpdateFields(
  existing: Record<string, unknown>,
  fields: ReadonlyArray<readonly [string, unknown]>,
  options: ImportJobOptions,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of fields) {
    if (options.fill_empty_only && hasFilledValue(existing[key])) {
      continue;
    }
    if (isBlankValue(value)) {
      continue;
    }
    data[key] = value;
  }
  return data;
}

export { isBlankValue };
