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

/**
 * Country code and check digits, then either 11 to 30 alphanumerics with no spaces
 * (the IBAN length range of 15 to 34) or groups of four separated by single spaces,
 * as printed. Spaces are not allowed anywhere else, so neighbouring identifiers
 * such as "RE2026000123 ATU12345678" are not joined into one match. The optional last
 * group must hold a digit, so a word that follows the IBAN is kept.
 */
const IBAN_PATTERN =
  /\b[A-Z]{2}\d{2}(?:[A-Z0-9]{11,30}|(?: [A-Z0-9]{4}){2,7}(?: (?=[A-Z0-9]{0,3}\d)[A-Z0-9]{1,4})?)\b/g;

/**
 * The same form in lowercase. It is a separate pattern so that a lowercase word after
 * an uppercase IBAN is not swallowed by the optional last group.
 */
const IBAN_LOWERCASE_PATTERN =
  /\b[a-z]{2}\d{2}(?:[a-z0-9]{11,30}|(?: [a-z0-9]{4}){2,7}(?: (?=[a-z0-9]{0,3}\d)[a-z0-9]{1,4})?)\b/g;

/**
 * A VIN as one unbroken string, or in the 3-3-3-3-5 groups printed with single spaces.
 * Case-insensitive, and I, O and Q never occur in a VIN. There is no left word boundary,
 * so a VIN glued to the word before it is still found. Each candidate must contain a
 * letter and a digit, which redactVin checks. Dashed or otherwise split VINs are not
 * detected.
 */
const VIN_PATTERN =
  /(?:[A-HJ-NPR-Z0-9]{17}|[A-HJ-NPR-Z0-9]{3}(?: [A-HJ-NPR-Z0-9]{3}){3} [A-HJ-NPR-Z0-9]{5})(?![A-HJ-NPR-Z0-9])/gi;

/**
 * A run of digits, grouped by spaces, brackets, slashes, dots, colons, commas, middle
 * dots, bullets or dashes (including en dashes and the minus sign) between digits.
 * Letters next to the run do not stop it, so the digits of a VAT id such as
 * ATU12345678 are redacted and only its country prefix stays.
 */
const DIGIT_RUN_PATTERN = /(?<!\d)\+?\d(?:[ ()/.:,·•\-‐-―−]{0,6}\d)*(?!\d)/g;
const DIGIT_RUN_MIN_DIGITS = 7;
const PHONE_MIN_DIGITS = 9;
const PHONE_MAX_DIGITS = 15;
/**
 * Soft hyphen, zero-width characters and byte-order mark: invisible, so removed. Built
 * from a string so that the characters themselves do not sit in the source.
 */
const INVISIBLE_PATTERN = new RegExp(
  '[\\u00AD\\u200B-\\u200D\\u2060\\uFEFF]',
  'g',
);

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
 * Replaces emails, IBANs, VINs and long digit runs with placeholders. Full-width
 * characters are folded and invisible characters removed first. Names and street
 * addresses are not detected and stay in the text.
 */
export function redactDocumentSortText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(INVISIBLE_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DOCUMENT_SORT_EXCERPT_SCAN_CHARS)
    .replace(EMAIL_IN_TEXT_PATTERN, '[EMAIL]')
    .replace(IBAN_PATTERN, '[IBAN]')
    .replace(IBAN_LOWERCASE_PATTERN, '[IBAN]')
    .replace(VIN_PATTERN, redactVin)
    .replace(DIGIT_RUN_PATTERN, redactDigitRun);
}

function redactVin(candidate: string): string {
  // A 17-digit or 17-letter run is not a VIN. It is left for the digit rule or kept.
  return /[A-Z]/i.test(candidate) && /\d/.test(candidate) ? '[VIN]' : candidate;
}

function redactDigitRun(run: string): string {
  const digits = run.replace(/\D/g, '');
  if (digits.length < DIGIT_RUN_MIN_DIGITS) {
    return run;
  }
  // Dates such as 01.03.2026 have eight digits, so they are numbers, not phone numbers.
  const phoneShaped =
    /^[+0]/.test(run) &&
    digits.length >= PHONE_MIN_DIGITS &&
    digits.length <= PHONE_MAX_DIGITS;
  return phoneShaped ? '[PHONE]' : '[NUMBER]';
}

function capExcerpt(redacted: string): string {
  if (redacted.length <= DOCUMENT_SORT_EXCERPT_MAX_CHARS) {
    return redacted;
  }
  return (
    redacted
      .slice(0, DOCUMENT_SORT_EXCERPT_MAX_CHARS)
      // A high surrogate at the cut would leave half of an astral character.
      .replace(/[\uD800-\uDBFF]$/, '')
      // A placeholder the cap cut in half would leave a fragment such as "[EM".
      .replace(/\[[A-Z]*$/, '')
      .trimEnd()
  );
}
