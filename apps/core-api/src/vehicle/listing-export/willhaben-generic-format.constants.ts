/**
 * Generic willhaben CSV export layout (AUT-571).
 *
 * willhaben publishes no public CSV import format. This layout is therefore a
 * generic, provisional export of all listing fields and is UNVERIFIED against
 * any real willhaben import; it must be replaced once the real format is known.
 */
export const WILLHABEN_GENERIC_PROFILE_CODE = 'WILLHABEN_GENERIC_V1';

export const WILLHABEN_GENERIC_CSV_FILENAME = 'willhaben-generic.csv';

/** Node BufferEncoding label for UTF-8. */
export const WILLHABEN_GENERIC_CSV_ENCODING = 'utf-8';

export const WILLHABEN_GENERIC_CSV_DELIMITER = ';';

/** Row terminator of the provisional generic layout (header + data rows). */
export const WILLHABEN_GENERIC_ROW_TERMINATOR = '\n';

/**
 * Provisional image cap for the unverified generic layout
 * (not confirmed against a real willhaben import).
 */
export const WILLHABEN_GENERIC_MAX_IMAGES = 25;
