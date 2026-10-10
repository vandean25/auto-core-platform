import type { AuditJsonValue } from './audit.types.js';

export const REDACTED_VALUE = '[REDACTED]';

const SECRET_FIELD_NAMES = new Set([
  'password',
  'passwordresettoken',
  'resetpasswordtoken',
  'refreshtoken',
  'accesstoken',
  'xrefreshtoken',
  'xaccesstoken',
  'firebasetoken',
  'apikey',
  'xapikey',
  'authorization',
  'authorizationheader',
]);

const PRIVATE_FIELD_NAMES = new Set([
  'identityresolutiontoken',
  'identityresolutiongeneration',
]);

const normalizeFieldName = (fieldName: string): string => {
  return fieldName.toLowerCase().replace(/[^a-z0-9]/g, '');
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const buildPath = (basePath: string, segment: string): string => {
  if (!basePath) {
    return segment;
  }
  if (segment.startsWith('[')) {
    return `${basePath}${segment}`;
  }
  return `${basePath}.${segment}`;
};

const redactValue = (
  value: AuditJsonValue,
  currentPath: string,
  redactedPaths: string[],
): AuditJsonValue => {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      redactValue(entry, buildPath(currentPath, `[${index}]`), redactedPaths),
    );
  }

  if (!isObject(value)) {
    return value;
  }

  const redactedObject: Record<string, AuditJsonValue> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const path = buildPath(currentPath, key);
    if (PRIVATE_FIELD_NAMES.has(normalizeFieldName(key))) {
      redactedPaths.push(path);
      continue;
    }
    if (SECRET_FIELD_NAMES.has(normalizeFieldName(key))) {
      redactedObject[key] = REDACTED_VALUE;
      redactedPaths.push(path);
      continue;
    }

    redactedObject[key] = redactValue(nestedValue, path, redactedPaths);
  }
  return redactedObject;
};

export const redactAuditSecrets = (
  value: AuditJsonValue,
): { value: AuditJsonValue; redactedPaths: string[] } => {
  const redactedPaths: string[] = [];
  const redactedValue = redactValue(value, '', redactedPaths);

  return {
    value: redactedValue,
    redactedPaths: [...new Set(redactedPaths)].sort(),
  };
};

/** Stands in for an email, phone, or address value whose shape is not kept. */
export const MASKED_PII_VALUE = '***';

export type AuditPiiKind = 'email' | 'phone' | 'address';

/**
 * An email address inside free text. The lookbehind starts a match only at the
 * first character of a run, so a long run of letters with no @ is scanned once
 * rather than from every position.
 */
const EMAIL_IN_TEXT_PATTERN =
  /(?<![\p{L}\p{N}._%+'-])[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
const PHONE_CHARACTERS_PATTERN = /^[+\d ()/-]+$/;
const ADDRESS_FIELD_NAMES = new Set([
  'city',
  'ort',
  'plz',
  'zip',
  'zipcode',
  'postcode',
  'postalcode',
  'housenumber',
  'hausnummer',
  'hausnr',
]);

const countDigits = (value: string): number => value.replace(/\D/g, '').length;

/**
 * Contact and address field rules, checked in order. A normalized name matches a rule when it
 * contains one of the partial markers or equals one of the exact names.
 */
const PII_FIELD_RULES: ReadonlyArray<{
  kind: AuditPiiKind;
  partialNames: readonly string[];
  exactNames: ReadonlySet<string>;
}> = [
  { kind: 'email', partialNames: ['email'], exactNames: new Set(['mail']) },
  {
    kind: 'phone',
    partialNames: ['phone', 'telefon', 'mobil', 'fax'],
    exactNames: new Set(['tel', 'handy']),
  },
  {
    kind: 'address',
    partialNames: ['address', 'adresse', 'street', 'strasse', 'strae'],
    exactNames: ADDRESS_FIELD_NAMES,
  },
];

/** Field names that hold contact or address data. Identifiers such as address_id are not masked. */
export const classifyPiiFieldName = (
  fieldName: string,
): AuditPiiKind | null => {
  const normalized = normalizeFieldName(fieldName);
  if (normalized.endsWith('id')) {
    return null;
  }
  const rule = PII_FIELD_RULES.find(
    ({ partialNames, exactNames }) =>
      exactNames.has(normalized) ||
      partialNames.some((partial) => normalized.includes(partial)),
  );
  return rule?.kind ?? null;
};

/**
 * Keeps the first letter of the local part and the domain after the last @:
 * john.doe@example.com becomes j***@example.com.
 */
export const maskEmailAddress = (email: string): string => {
  const atIndex = email.lastIndexOf('@');
  if (atIndex <= 0) {
    return MASKED_PII_VALUE;
  }
  return `${email.charAt(0)}***${email.slice(atIndex)}`;
};

/** Keeps only the last two digits and the separators: +43 660 1234567 becomes +** *** *****67. */
export const maskPhoneNumber = (phone: string): string => {
  const digitCount = countDigits(phone);
  if (digitCount < 3) {
    return MASKED_PII_VALUE;
  }
  let digitsToMask = digitCount - 2;
  return phone.replace(/\d/g, (digit) => {
    if (digitsToMask <= 0) {
      return digit;
    }
    digitsToMask -= 1;
    return '*';
  });
};

const looksLikePhoneNumber = (value: string): boolean => {
  if (!PHONE_CHARACTERS_PATTERN.test(value)) {
    return false;
  }
  const digitCount = countDigits(value);
  if (digitCount < 9 || digitCount > 15) {
    return false;
  }
  // A bare run of digits is more likely an identifier than a phone number.
  return /^[+0]/.test(value) || /[ ()/-]/.test(value);
};

const maskPiiString = (
  value: string,
  kind: AuditPiiKind | null,
): { value: string; masked: boolean } => {
  if (kind === 'address') {
    return { value: MASKED_PII_VALUE, masked: true };
  }
  if (kind === 'email') {
    // An email-named field holds one address, so the whole value is masked.
    return { value: maskEmailAddress(value), masked: true };
  }
  if (kind === 'phone') {
    return { value: maskPhoneNumber(value), masked: true };
  }

  const scrubbed = value.replace(EMAIL_IN_TEXT_PATTERN, maskEmailAddress);
  if (scrubbed !== value) {
    return { value: scrubbed, masked: true };
  }
  if (looksLikePhoneNumber(value)) {
    return { value: maskPhoneNumber(value), masked: true };
  }
  return { value, masked: false };
};

const maskPiiValue = (
  value: AuditJsonValue,
  currentPath: string,
  kind: AuditPiiKind | null,
  maskedPaths: string[],
): AuditJsonValue => {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const result = maskPiiString(value, kind);
    if (result.masked) {
      maskedPaths.push(currentPath);
    }
    return result.value;
  }
  if (kind !== null) {
    maskedPaths.push(currentPath);
    return MASKED_PII_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      maskPiiValue(
        entry,
        buildPath(currentPath, `[${index}]`),
        null,
        maskedPaths,
      ),
    );
  }
  if (isObject(value)) {
    const maskedObject: Record<string, AuditJsonValue> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      maskedObject[key] = maskPiiValue(
        nestedValue,
        buildPath(currentPath, key),
        classifyPiiFieldName(key),
        maskedPaths,
      );
    }
    return maskedObject;
  }
  return value;
};

/**
 * Masks contact and address data in a before, after, or diff value for MCP output.
 * Email addresses and phone numbers keep their shape; address values are replaced.
 * Field names decide the kind; email addresses and whole-value phone numbers are
 * also scrubbed wherever they appear. Personal names are not masked.
 */
export const maskAuditPiiForMcp = (
  value: AuditJsonValue,
  fieldName?: string,
): { value: AuditJsonValue; maskedPaths: string[] } => {
  const maskedPaths: string[] = [];
  const kind = fieldName === undefined ? null : classifyPiiFieldName(fieldName);
  const maskedValue = maskPiiValue(value, '', kind, maskedPaths);

  return {
    value: maskedValue,
    maskedPaths: [...new Set(maskedPaths)].sort(),
  };
};
