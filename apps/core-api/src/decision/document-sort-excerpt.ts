import { createHash } from 'node:crypto';
import { EMAIL_IN_TEXT_PATTERN } from '../audit/audit-redaction.util.js';
import type { DocumentSortType } from './decision.constants.js';

/** Hard cap on the document text that reaches Jev in the live document_sort call. */
export const DOCUMENT_SORT_EXCERPT_MAX_CHARS = 1500;

/**
 * Only this head of the text is scanned for identifiers: four times the cap. A
 * token that straddles the cap is then fully inside the scanned text, so it is
 * redacted before the cap cuts it. The bound also keeps the scan cheap on large PDFs.
 */
const DOCUMENT_SORT_EXCERPT_SCAN_CHARS = 4 * DOCUMENT_SORT_EXCERPT_MAX_CHARS;

/** Country code and check digits, then 11 to 30 alphanumerics: the IBAN length range of 15 to 34. */
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g;
const VIN_PATTERN = /\b(?=[A-HJ-NPR-Z0-9]*[A-Z])[A-HJ-NPR-Z0-9]{17}\b/g;
/**
 * A run of digits, optionally grouped by one space, slash, dash or bracket between
 * digits. Letters on either side stop the run, so an identifier such as RE2026000123
 * is not split into digit runs.
 */
const DIGIT_RUN_PATTERN =
  /(?<![\p{L}\p{N}])\+?\d(?:[ ()/-]?\d)*(?![\p{L}\p{N}])/gu;
const DIGIT_RUN_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

/** The only form of the document text that leaves the process. */
export type DocumentSortExcerpt = {
  /** Redacted and capped at DOCUMENT_SORT_EXCERPT_MAX_CHARS. */
  text: string;
  /** Length of `text` in characters. */
  length: number;
  /** Hex SHA-256 of `text`. */
  sha256: string;
};

/** Live document_sort input for Jev: the heuristic signals plus the excerpt. */
export type DocumentSortLiveInput = {
  signals: DocumentSortType[];
  text_excerpt: string;
};

/** What the audit and shadow rows keep of the excerpt: its length and hash, never the text. */
export type DocumentSortExcerptAudit = {
  text_excerpt_length: number;
  text_excerpt_sha256: string;
};

export function buildDocumentSortExcerpt(text: string): DocumentSortExcerpt {
  const excerpt = capExcerpt(redactDocumentSortText(text));
  return {
    text: excerpt,
    length: excerpt.length,
    sha256: createHash('sha256').update(excerpt).digest('hex'),
  };
}

export function documentSortExcerptAudit(
  excerpt: DocumentSortExcerpt,
): DocumentSortExcerptAudit {
  return {
    text_excerpt_length: excerpt.length,
    text_excerpt_sha256: excerpt.sha256,
  };
}

/**
 * Replaces emails, IBANs, VINs and long digit runs with placeholders. Names and
 * street addresses are not detected and stay in the text.
 */
export function redactDocumentSortText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DOCUMENT_SORT_EXCERPT_SCAN_CHARS)
    .replace(EMAIL_IN_TEXT_PATTERN, '[EMAIL]')
    .replace(IBAN_PATTERN, '[IBAN]')
    .replace(VIN_PATTERN, '[VIN]')
    .replace(DIGIT_RUN_PATTERN, redactDigitRun);
}

function redactDigitRun(run: string): string {
  const digits = run.replace(/\D/g, '');
  if (digits.length < DIGIT_RUN_MIN_DIGITS) {
    return run;
  }
  const phoneShaped = /^[+0]/.test(run) && digits.length <= PHONE_MAX_DIGITS;
  return phoneShaped ? '[PHONE]' : '[NUMBER]';
}

function capExcerpt(redacted: string): string {
  const capped = redacted.slice(0, DOCUMENT_SORT_EXCERPT_MAX_CHARS);
  // A placeholder cut by the cap would leave a fragment such as "[IB", so it is dropped.
  const openBracket = capped.lastIndexOf('[');
  return openBracket > capped.lastIndexOf(']')
    ? capped.slice(0, openBracket).trimEnd()
    : capped;
}
