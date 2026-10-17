/**
 * Generic willhaben CSV export layout (AUT-571).
 *
 * willhaben publishes no public CSV import format. This layout is therefore a
 * generic, provisional export of all listing fields and is UNVERIFIED against
 * any real willhaben import; it must be replaced once the real format is known.
 */
export const WILLHABEN_GENERIC_PROFILE_CODE = 'WILLHABEN_GENERIC_V1';

export const WILLHABEN_GENERIC_CSV_FILENAME = 'willhaben-generic.csv';

/** Node BufferEncoding label for UTF-8 (files carry an explicit BOM). */
export const WILLHABEN_GENERIC_CSV_ENCODING = 'utf-8';

/** UTF-8 byte order mark prepended to the CSV file. */
export const WILLHABEN_GENERIC_CSV_BOM = '﻿';

export const WILLHABEN_GENERIC_CSV_DELIMITER = ';';

/** CRLF row terminator; one physical line per record (control chars normalised). */
export const WILLHABEN_GENERIC_ROW_TERMINATOR = '\r\n';

/**
 * ACP provisional image cap for willhaben (spec: photo contract allows <=30,
 * labelled ACP limit, not a verified portal guarantee).
 */
export const WILLHABEN_GENERIC_MAX_IMAGES = 30;
