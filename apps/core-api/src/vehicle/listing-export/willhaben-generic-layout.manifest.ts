/**
 * Pinned generic willhaben layout for WILLHABEN_GENERIC_V1 (UNVERIFIED).
 *
 * willhaben publishes no public CSV import format, so this is a neutral
 * generic export of all listing fields, not a portal-verified layout:
 * - UTF-8 (no BOM), `;` delimiter, RFC 4180 quoting (every field quoted,
 *   `""` escape).
 * - Row terminator `\n`; in-field line breaks stay inside quoted fields
 *   (RFC 4180 section 2).
 * - One header row followed by one row per listing; empty cell = value not
 *   available.
 * - Boolean columns use `1`/`0`; an empty cell means unknown (export
 *   assertions are optional in the generic layout).
 * - Multi-value cells are comma-separated lists inside the quoted field
 *   (`equipment_codes`, `image_filenames`); `equipment_free_text` keeps one
 *   line per entry.
 * - Must be replaced once the real willhaben import format is known.
 */

export const WILLHABEN_GENERIC_LAYOUT_VERSION = '1';

export const WILLHABEN_GENERIC_CSV_COLUMNS = [
  'listing_ref',
  'title',
  'description',
  'category',
  'price_gross_eur',
  'vat_display',
  'make',
  'model',
  'model_year',
  'first_registration',
  'mileage_km',
  'fuel',
  'power_kw',
  'color',
  'co2_wltp_g_km',
  'co2_nedc_g_km',
  'emission_class',
  'damage_free',
  'metallic',
  'guarantee',
  'jahreswagen',
  'recommendation',
  'demo_vehicle',
  'equipment_codes',
  'equipment_free_text',
  'image_count',
  'image_filenames',
] as const;

export type WillhabenGenericCsvColumn =
  (typeof WILLHABEN_GENERIC_CSV_COLUMNS)[number];

export const WILLHABEN_GENERIC_FIELD_COUNT =
  WILLHABEN_GENERIC_CSV_COLUMNS.length;

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

export function buildWillhabenGenericHeaderRow(): string[] {
  return [...WILLHABEN_GENERIC_CSV_COLUMNS];
}

/** Generic layout booleans: `1` = true, `0` = false, empty = unknown. */
export function formatWillhabenGenericBoolean(value: boolean | null): string {
  if (value === null) {
    return '';
  }
  return value ? '1' : '0';
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
