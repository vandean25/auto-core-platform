import { normalizePlate } from '../vehicle/vehicle-plate.util.js';
import { splitSearchTerms } from '../workshop/workshop-customer-name-search.helpers.js';
import type { ParsedSearchQuery, SearchQueryKind } from './search.types.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@\S*$/;
// ISO 3779 charset, 17 characters.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;
const VIN_FRAGMENT_RE = /^[A-HJ-NPR-Z0-9]{6,17}$/i;
const PHONE_RE = /^\+?\d[\d\s/().-]*$/;
const MIN_PHONE_DIGITS = 6;
const DIGITS_RE = /^\d+$/;
// Document prefix (2+ letters, dash) like RE-2026-0012; the digit is checked separately to keep the pattern linear.
const DOCUMENT_PREFIX_RE = /^[A-Za-z]{2,}-[\w-]+$/;
const PLATE_INPUT_RE = /^[A-Za-z0-9 .-]+$/;
const MAX_PLATE_LENGTH = 10;
// Strict Austrian/German shape; only this makes the plate the primary kind (names with digits stay names).
const PLATE_SHAPE_RE = /^[A-Z]{1,3}\d{1,6}[A-Z]{0,3}$/;

function isPhone(text: string): boolean {
  const digits = text.replace(/\D/g, '').length;
  return (
    PHONE_RE.test(text) &&
    digits >= MIN_PHONE_DIGITS &&
    (text.startsWith('+') || text.startsWith('0'))
  );
}

function isNumber(text: string): boolean {
  return (
    DIGITS_RE.test(text) || (DOCUMENT_PREFIX_RE.test(text) && /\d/.test(text))
  );
}

function isVin(text: string): boolean {
  return VIN_RE.test(text) && /[A-Z]/i.test(text); // 17 digits is a number
}

/** Any short input with a letter and a digit may be a plate (also vanity plates like S-SKODA1). */
function detectPlate(text: string): string | null {
  if (!PLATE_INPUT_RE.test(text)) {
    return null;
  }
  const plate = normalizePlate(text);
  return plate &&
    plate.length <= MAX_PLATE_LENGTH &&
    /[A-Z]/.test(plate) &&
    /\d/.test(plate)
    ? plate
    : null;
}

function detectKind(text: string, plate: string | null): SearchQueryKind {
  if (UUID_RE.test(text)) return 'uuid';
  if (EMAIL_RE.test(text)) return 'email';
  if (isVin(text)) return 'vin';
  if (isPhone(text)) return 'phone';
  if (isNumber(text)) return 'number';
  return plate && PLATE_SHAPE_RE.test(plate) ? 'plate' : 'name';
}

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const text = raw.trim().replace(/\s+/g, ' ');
  const plate = detectPlate(text);
  return {
    text,
    kind: detectKind(text, plate),
    plate,
    vin: VIN_FRAGMENT_RE.test(text) ? text.toUpperCase() : null,
    terms: splitSearchTerms(text),
  };
}
