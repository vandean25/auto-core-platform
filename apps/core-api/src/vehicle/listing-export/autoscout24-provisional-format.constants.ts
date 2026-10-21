/**
 * AutoScout24 AT provisional CSV export layout (AUT-570).
 *
 * AutoScout24 describes CSV import from `Mustertabelle_AS24.xls` with images in
 * a ZIP whose file names match CSV references (partner FAQ). The exact workbook
 * column layout was not available during research, so this profile implements
 * the pinned ACP provisional contract aligned to that transport model.
 */
/** Serializer profile code (not an API error code). */
export const AUTOSCOUT24_PROVISIONAL_PROFILE = 'AS24_PROVISIONAL_V1';

export const AUTOSCOUT24_PROVISIONAL_CSV_FILENAME =
  'autoscout24-provisional.csv';

/** UTF-8 byte order mark prepended to the CSV file. */
export const AUTOSCOUT24_PROVISIONAL_CSV_BOM = '﻿';

/** CRLF row terminator; one physical line per record (control chars normalised). */
export const AUTOSCOUT24_PROVISIONAL_ROW_TERMINATOR = '\r\n';

/**
 * ACP provisional image cap for AutoScout24 (spec: photo contract allows <=30,
 * labelled ACP limit, not a verified portal guarantee).
 */
export const AUTOSCOUT24_PROVISIONAL_MAX_IMAGES = 30;
