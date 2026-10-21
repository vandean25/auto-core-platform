import { maskEmailAddress } from '../audit/audit-redaction.util.js';
import { normalizeCustomerVatId } from './customer-vat-id.validation.js';

/**
 * One canonical matcher for customer master data (AUT-613).
 *
 * The registration intake matcher and the customer import already need the same
 * comparisons, so the normalization lives here once and every caller folds the
 * same way: e-mail case-insensitive, phone by national digits, UID upper case
 * without spaces, names umlaut- and case-insensitive.
 */
export const CUSTOMER_MATCH_REASONS = {
  email: 'email',
  phone: 'phone',
  vatId: 'vat_id',
  nameZip: 'name_zip',
} as const;

export type CustomerMatchReason =
  (typeof CUSTOMER_MATCH_REASONS)[keyof typeof CUSTOMER_MATCH_REASONS];

/** The customer fields a duplicate check compares. Every field is optional. */
export type CustomerMatchProbe = {
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
  vat_id?: string | null;
  address_zip?: string | null;
};

/** A customer row a probe matched, with the reasons it matched. */
export type CustomerMatchCandidate = {
  customer_id: string;
  match_reasons: CustomerMatchReason[];
  display_name_initials: string;
};

const UMLAUT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['ä', 'ae'],
  ['ö', 'oe'],
  ['ü', 'ue'],
  ['ß', 'ss'],
];

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/** E-mail addresses match case-insensitively. */
export function normalizeMatchEmail(
  value: string | null | undefined,
): string | null {
  const trimmed = trimmedOrNull(value);
  return trimmed ? trimmed.toLowerCase() : null;
}

/**
 * Phone numbers match by national digits: the country code and the national
 * trunk prefix are removed, so +43 664 123456, 0043 664 123456 and
 * 0664 123456 all become 664123456.
 */
export function normalizeMatchPhone(
  value: string | null | undefined,
): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) {
    return null;
  }
  const withoutCountry = digits.startsWith('0043')
    ? digits.slice(4)
    : digits.startsWith('43') && digits.length > 4
      ? digits.slice(2)
      : digits;
  const national = withoutCountry.startsWith('0')
    ? withoutCountry.slice(1)
    : withoutCountry;
  return national.length > 0 ? national : null;
}

/** The UID (vat_id) matches upper case and without spaces. */
export function normalizeMatchVatId(
  value: string | null | undefined,
): string | null {
  return normalizeCustomerVatId(value);
}

/** A name key that ignores case and umlauts: Müller and Mueller both fold to mueller. */
export function foldMatchName(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ');
}

/** The postcode matches upper case and without separators. */
export function normalizeMatchZip(
  value: string | null | undefined,
): string | null {
  const normalized = (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return normalized.length > 0 ? normalized : null;
}

/**
 * The one name comparison of the platform: two names are the same when they
 * fold to the same key. The registration intake, the customer import, and the
 * MCP customer proposals all use it.
 */
export function isSameCustomerName(
  first: string | null | undefined,
  last: string | null | undefined,
  otherFirst: string | null | undefined,
  otherLast: string | null | undefined,
): boolean {
  if (foldMatchName(first) !== foldMatchName(otherFirst)) {
    return false;
  }
  return foldMatchName(last) === foldMatchName(otherLast);
}

/** The spellings of a name the database may hold, so a folded name finds its row. */
export function buildNameVariants(value: string | null | undefined): string[] {
  const raw = trimmedOrNull(value);
  if (!raw) {
    return [];
  }
  const variants = new Set<string>([raw]);
  for (const [umlaut, plain] of UMLAUT_PAIRS) {
    for (const candidate of [...variants]) {
      if (candidate.includes(umlaut)) {
        variants.add(candidate.split(umlaut).join(plain));
      }
      const lower = candidate.toLowerCase();
      if (lower.includes(plain)) {
        variants.add(
          restoreLeadingCase(candidate, lower.split(plain).join(umlaut)),
        );
      }
    }
  }
  return [...variants];
}

function restoreLeadingCase(source: string, replacement: string): string {
  if (!replacement) {
    return replacement;
  }
  const first = source.charAt(0);
  return first === first.toUpperCase()
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement;
}

/** The spellings of a phone number the database may hold. */
export function buildPhoneVariants(value: string | null | undefined): string[] {
  const raw = trimmedOrNull(value);
  const national = normalizeMatchPhone(raw);
  if (!raw || !national) {
    return [];
  }
  return [
    ...new Set([
      raw,
      national,
      `0${national}`,
      `+43${national}`,
      `0043${national}`,
    ]),
  ];
}

/** The spellings of a postcode the database may hold. */
export function buildZipVariants(value: string | null | undefined): string[] {
  const raw = trimmedOrNull(value);
  const normalized = normalizeMatchZip(raw);
  if (!raw || !normalized) {
    return [];
  }
  return [...new Set([raw, normalized])];
}

/** Keeps the first letter and the domain of an e-mail: max@example.at becomes m***@example.at. */
export function maskMatchEmail(value: string | null | undefined): string {
  const trimmed = trimmedOrNull(value);
  return trimmed ? maskEmailAddress(trimmed) : '';
}

/** Keeps the last three digits of a phone number and masks the rest. */
export function maskMatchPhone(value: string | null | undefined): string {
  const trimmed = trimmedOrNull(value);
  if (!trimmed) {
    return '';
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length <= 3) {
    return '*'.repeat(digits.length);
  }
  let remaining = digits.length - 3;
  return trimmed.replace(/\d/g, (digit) => {
    if (remaining <= 0) {
      return digit;
    }
    remaining -= 1;
    return '*';
  });
}

/** The initials a supervisor sees instead of the full name: Max Mustermann becomes MM. */
export function buildDisplayNameInitials(probe: {
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
}): string {
  const parts = [probe.first_name, probe.last_name]
    .map((part) => trimmedOrNull(part))
    .filter((part): part is string => part !== null);
  if (parts.length === 0) {
    const company = trimmedOrNull(probe.company_name);
    if (!company) {
      return '';
    }
    parts.push(...company.split(/\s+/).slice(0, 2));
  }
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}
