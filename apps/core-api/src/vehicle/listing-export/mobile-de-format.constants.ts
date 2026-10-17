/**
 * mobile.de CSV upload interface (public manual).
 * @see https://services.mobile.de/manual/upload-interface-csv_de.html
 */
export const MOBILE_DE_REFERENCE_PROFILE_CODE = 'MOBILE_DE_REFERENCE_V1';

/** Positional CSV columns 0..211 inclusive (212 fields). */
export const MOBILE_DE_FIELD_COUNT = 212;

/** Encoding required by the public mobile.de CSV manual. */
export const MOBILE_DE_CSV_ENCODING = 'ISO-8859-15';

export const MOBILE_DE_CSV_FILENAME = 'mobile-de-reference.csv';

export const MOBILE_DE_MAX_IMAGES = 15;

/**
 * In-field line break for bemerkung (column 25) per mobile.de formatting syntax.
 * @see https://services.mobile.de/manual/formatting-syntax.html
 */
export const MOBILE_DE_DESCRIPTION_LINE_BREAK = '\\\\';
