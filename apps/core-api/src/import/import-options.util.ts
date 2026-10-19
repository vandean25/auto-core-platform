import type { ImportJobOptions } from './import.types.js';

function rowNumbersOrUndefined(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map((n) => Number(n)).filter((n) => Number.isFinite(n));
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function trimmedStringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Keeps only known option keys, with flags as strict booleans and invalid numbers dropped. */
export function normalizeImportOptions(
  options?: ImportJobOptions,
): ImportJobOptions {
  if (!options) {
    return {};
  }
  return {
    update_existing: options.update_existing === true,
    fill_empty_only: options.fill_empty_only === true,
    allow_missing_vin: options.allow_missing_vin === true,
    invalid_vat_as_error: options.invalid_vat_as_error === true,
    create_new_catalog_items: options.create_new_catalog_items === true,
    accept_all_price_jumps: options.accept_all_price_jumps === true,
    accepted_row_numbers: rowNumbersOrUndefined(options.accepted_row_numbers),
    price_jump_threshold_percent: finiteNumberOrUndefined(
      options.price_jump_threshold_percent,
    ),
    vendor_id: trimmedStringOrUndefined(options.vendor_id),
  };
}

/**
 * Options used for apply: the job's stored options, overridden by the apply request.
 * Accepted row numbers from both sides are concatenated, not de-duplicated.
 */
export function mergeApplyOptions(
  jobOptions: ImportJobOptions,
  applyOptions?: ImportJobOptions,
): ImportJobOptions {
  return {
    ...jobOptions,
    ...(applyOptions ?? {}),
    ...(applyOptions?.accepted_row_numbers
      ? {
          accepted_row_numbers: [
            ...(jobOptions.accepted_row_numbers ?? []),
            ...applyOptions.accepted_row_numbers,
          ],
        }
      : {}),
  };
}
