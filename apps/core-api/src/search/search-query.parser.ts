import { normalizePlate } from '../vehicle/vehicle-plate.util.js';
import { splitSearchTerms } from '../workshop/workshop-customer-name-search.helpers.js';
import type { ParsedSearchQuery, SearchQueryKind } from './search.types.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^\S+@\S*$/;
// ISO 3779 charset, 17 characters, at least one letter (17 digits is a number).
const VIN_RE = /^(?=.*[A-Z])[A-HJ-NPR-Z0-9]{17}$/i;
const PHONE_RE = /^\+?\d[\d\s/().-]*$/;
const MIN_PHONE_DIGITS = 6;
// Digits only, or a document prefix (2+ letters, dash) with a digit later on, like RE-2026-0012.
const NUMBER_RE = /^(\d+|[A-Za-z]{2,}-[\w-]*\d[\w-]*)$/;
const PLATE_INPUT_RE = /^[A-Za-z0-9 .-]+$/;
const PLATE_SHAPE_RE = /^[A-Z]{1,3}\d{1,6}[A-Z]{0,3}$/;

function isPhone(text: string): boolean {
  const digits = text.replace(/\D/g, '').length;
  return (
    PHONE_RE.test(text) &&
    digits >= MIN_PHONE_DIGITS &&
    (text.startsWith('+') || text.startsWith('0'))
  );
}

function detectPlate(text: string): string | null {
  if (!PLATE_INPUT_RE.test(text)) {
    return null;
  }
  const plate = normalizePlate(text);
  return plate && PLATE_SHAPE_RE.test(plate) ? plate : null;
}

function detectKind(text: string, plate: string | null): SearchQueryKind {
  if (UUID_RE.test(text)) return 'uuid';
  if (EMAIL_RE.test(text)) return 'email';
  if (VIN_RE.test(text)) return 'vin';
  if (isPhone(text)) return 'phone';
  if (NUMBER_RE.test(text)) return 'number';
  return plate ? 'plate' : 'name';
}

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const text = raw.trim().replace(/\s+/g, ' ');
  const plate = detectPlate(text);
  return {
    text,
    kind: detectKind(text, plate),
    plate,
    terms: splitSearchTerms(text),
  };
}
