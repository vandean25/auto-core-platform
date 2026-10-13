import {
  DATEV_MAX_CSV_BYTES,
  DATEV_MAX_DOCUMENTS_PER_RUN,
} from './datev-format.constants.js';

/**
 * ACP draft BMD NTCS booking layout (see bmd-ntcs-import.serializer.ts and the
 * BMD spec). The field order is ACP's reading of a third-party description, not
 * a copy of a BMD document. It must be validated before any enablement.
 */
export const BMD_ENCODING = 'win1252';
export const BMD_FIELD_SEPARATOR = ';';
export const BMD_LINE_BREAK = '\r\n';

/** Eleven fields per booking record, in the order fixed by the spec (A1). */
export const BMD_BOOKING_FIELD_COUNT = 11;

/** Limit for the deterministic booking text built by the candidate rules. */
export const BMD_BOOKING_TEXT_MAX_LENGTH = 60;

/** Sollhabenkennzeichen of the debtor line: S opens the open item (invoice), H reduces it (credit). */
export const BMD_SOLLHABEN_BY_DOCUMENT_KIND = {
  INVOICE: 'S',
  CREDIT_NOTE: 'H',
} as const;

/** Same bounds as DATEV and RZL: 10,000 documents and 20 MiB encoded per run. */
export const BMD_MAX_DOCUMENTS_PER_RUN = DATEV_MAX_DOCUMENTS_PER_RUN;
export const BMD_MAX_CSV_BYTES = DATEV_MAX_CSV_BYTES;
