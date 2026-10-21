/**
 * Pinned generic willhaben layout for WILLHABEN_GENERIC_V1 (UNVERIFIED).
 * ACP-defined provisional contract (docs/internal/02-Feature-Specs/Vehicle/
 * marketplace-export.md, AS24/willhaben section) — not a willhaben import
 * format; must be replaced once the real format is known:
 * - UTF-8 with BOM, `;` delimiter, every cell double-quoted with doubled
 *   quotes, CRLF rows, header + one physical line per listing.
 * - CR, LF and other control characters in any cell are replaced with a
 *   space; formula-leading text (`= + - @`, including leading
 *   whitespace/control characters) is prefixed with an apostrophe.
 * - `action` is `UPSERT` for active offers; removals travel separately.
 * - Numbers use a decimal point without grouping; ISO first-registration
 *   day; EUR currency.
 * - Nullable boolean columns are lowercase `true`/`false` or empty; every
 *   boolean column currently mapped stays empty until the inputs exist.
 * - `equipment_codes` and `image_files` are `|`-joined lists; a literal `|`
 *   inside either atomic value is rejected. Image references match the
 *   flat `<listing_ref>_<01..30>.jpg` ZIP members exactly (ACP cap 30).
 * - `body_type`, `transmission`, `doors`, `seats`, `roadworthy`,
 *   `nova_included`, `description_language` and `seller_*` stay empty until
 *   those inputs exist (empty cell = value not available).
 */

/** `action` for active offers in the provisional layout. */
export const WILLHABEN_GENERIC_ACTION = 'UPSERT';

export const WILLHABEN_GENERIC_CURRENCY = 'EUR';

export const WILLHABEN_GENERIC_CSV_COLUMNS = [
  'listing_ref',
  'action',
  'title',
  'make',
  'model',
  'model_year',
  'first_registration',
  'mileage_km',
  'fuel',
  'power_kw',
  'body_type',
  'transmission',
  'doors',
  'seats',
  'color',
  'damage_status',
  'roadworthy',
  'price_gross_eur',
  'currency',
  'vat_display',
  'nova_included',
  'co2_wltp_g_km',
  'co2_nedc_g_km',
  'emission_class',
  'description_language',
  'description',
  'equipment_codes',
  'equipment_free_text',
  'image_files',
  'seller_name',
  'seller_contact',
  'seller_postcode',
  'seller_city',
] as const;

export type WillhabenGenericCsvColumn =
  (typeof WILLHABEN_GENERIC_CSV_COLUMNS)[number];

export const WILLHABEN_GENERIC_FIELD_COUNT =
  WILLHABEN_GENERIC_CSV_COLUMNS.length;

export function buildWillhabenGenericHeaderRow(): string[] {
  return [...WILLHABEN_GENERIC_CSV_COLUMNS];
}

const WILLHABEN_GENERIC_COLUMN_INDEXES = new Map(
  WILLHABEN_GENERIC_CSV_COLUMNS.map((name, index): [string, number] => [
    name,
    index,
  ]),
);

export function willhabenGenericColumnIndex(
  column: WillhabenGenericCsvColumn,
): number {
  const index = WILLHABEN_GENERIC_COLUMN_INDEXES.get(column);
  if (index === undefined) {
    throw new Error(`Unknown willhaben generic column: ${column}`);
  }
  return index;
}

/**
 * Canonical damage_status from the only damage input that exists today
 * (damage_free). `true` maps to NONE; everything else stays UNKNOWN so a
 * missing/false assertion is never silently exported as no damage.
 */
export function formatWillhabenDamageStatus(
  damageFree: boolean | null,
): string {
  return damageFree === true ? 'NONE' : 'UNKNOWN';
}

export function formatWillhabenGenericPriceGross(amount: string): string {
  const parsed = Number.parseFloat(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid gross price for willhaben generic export: ${amount}`,
    );
  }
  return parsed.toFixed(2);
}
