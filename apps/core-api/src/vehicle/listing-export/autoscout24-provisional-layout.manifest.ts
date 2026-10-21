/**
 * Pinned provisional AutoScout24 layout for AS24_PROVISIONAL_V1.
 *
 * The public partner FAQ only verifies CSV export from `Mustertabelle_AS24.xls`
 * (“CSV (Trennzeichen getrennt)”) and a ZIP whose image file names match the
 * CSV. UTF-8 BOM, delimiter, quoting, CRLF, and column names are **UNVERIFIED**
 * against Mustertabelle until the workbook is pinned — see
 * `autoscout24-provisional-fields.md`.
 *
 * Encoding rules match the generic spreadsheet-oriented export profiles (ACP):
 * - UTF-8 with BOM, `;` delimiter, every cell double-quoted with doubled
 *   quotes, CRLF rows, header + one physical line per listing.
 * - CR, LF and other control characters in any cell are replaced with a
 *   space; formula-leading text (`= + - @`, including leading
 *   whitespace/control characters) is prefixed with an apostrophe.
 * - `action` is `UPSERT` for rows included in download (ACTIVE channels only).
 *   Inactive / removal-pending channels are excluded by the export service, not
 *   by a companion removal file in this slice.
 * - Numbers use a decimal point without grouping; ISO first-registration
 *   day; EUR currency.
 * - Nullable boolean columns are lowercase `true`/`false` or empty; every
 *   boolean column currently mapped stays empty until the inputs exist.
 * - `equipment_codes` and `image_files` are `|`-joined lists; a literal `|`
 *   inside either atomic value is rejected. Image references match the
 *   flat `<listing_ref>_<01..30>.jpg` ZIP members exactly (ACP cap 30).
 */

/** `action` for active offers in the provisional layout. */
export const AUTOSCOUT24_PROVISIONAL_ACTION = 'UPSERT';

export const AUTOSCOUT24_PROVISIONAL_CURRENCY = 'EUR';

export const AUTOSCOUT24_PROVISIONAL_CSV_COLUMNS = [
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

export type Autoscout24ProvisionalCsvColumn =
  (typeof AUTOSCOUT24_PROVISIONAL_CSV_COLUMNS)[number];

export const AUTOSCOUT24_PROVISIONAL_FIELD_COUNT =
  AUTOSCOUT24_PROVISIONAL_CSV_COLUMNS.length;

export function buildAutoscout24ProvisionalHeaderRow(): string[] {
  return [...AUTOSCOUT24_PROVISIONAL_CSV_COLUMNS];
}

const AUTOSCOUT24_PROVISIONAL_COLUMN_INDEXES = new Map(
  AUTOSCOUT24_PROVISIONAL_CSV_COLUMNS.map((name, index): [string, number] => [
    name,
    index,
  ]),
);

export function autoscout24ProvisionalColumnIndex(
  column: Autoscout24ProvisionalCsvColumn,
): number {
  const index = AUTOSCOUT24_PROVISIONAL_COLUMN_INDEXES.get(column);
  if (index === undefined) {
    throw new Error(`Unknown AutoScout24 provisional column: ${column}`);
  }
  return index;
}

/**
 * Canonical damage_status from the only damage input that exists today
 * (damage_free). `true` maps to NONE; everything else stays UNKNOWN so a
 * missing/false assertion is never silently exported as no damage.
 */
export function formatAutoscout24DamageStatus(
  damageFree: boolean | null,
): string {
  return damageFree === true ? 'NONE' : 'UNKNOWN';
}

export function formatAutoscout24ProvisionalPriceGross(amount: string): string {
  const parsed = Number.parseFloat(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid gross price for AutoScout24 provisional export: ${amount}`,
    );
  }
  return parsed.toFixed(2);
}
