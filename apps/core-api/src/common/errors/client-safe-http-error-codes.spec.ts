import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WARRANTY_CLAIM_ERROR_CODES } from '../../warranty-claim/warranty-claim.rules.js';
import { IMPORT_ERROR_CODES } from '../../import/import.constants.js';
import {
  CLIENT_SAFE_HTTP_ERROR_CODES,
  pickClientSafeHttpErrorDetails,
  pickClientSafeHttpErrorParams,
  pickClientSafeHttpErrorStructuredDetails,
} from './client-safe-http-error-codes.js';

const API_SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/** Files that throw import errors straight at an API client. */
const CLIENT_FACING_IMPORT_FILES = [
  'import/import-source.service.ts',
  'import/import.controller.ts',
  'import/import-worker.controller.ts',
  'import/import-direct-upload.ts',
  'import/import-job.errors.ts',
] as const;

/** Codes those files can throw at a client, read off the sources so a new one is caught. */
function clientFacingImportCodes(): string[] {
  const keys = new Set<keyof typeof IMPORT_ERROR_CODES>();
  for (const file of CLIENT_FACING_IMPORT_FILES) {
    const source = readFileSync(resolve(API_SRC_ROOT, file), 'utf8');
    for (const match of source.matchAll(/IMPORT_ERROR_CODES\.([A-Z0-9_]+)/g)) {
      keys.add(match[1] as keyof typeof IMPORT_ERROR_CODES);
    }
  }
  return [...keys].map((key) => IMPORT_ERROR_CODES[key]).sort();
}

function readWebPublicErrorCodes(): Set<string> {
  const source = readFileSync(
    resolve(REPO_ROOT, 'apps/core-web/src/api/generated/public-error-codes.ts'),
    'utf8',
  );
  return new Set(
    [...source.matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map((match) => match[1]),
  );
}

function readLocaleErrorTexts(language: 'de' | 'en'): Record<string, string> {
  const bundle = JSON.parse(
    readFileSync(resolve(REPO_ROOT, `locales/${language}/errors.json`), 'utf8'),
  ) as { codes: Record<string, string> };
  return bundle.codes;
}

describe('client-safe HTTP error codes', () => {
  // The global filter drops any code that is not in this set, so a warranty code missing here would never reach
  // the client. This keeps the two lists in step.
  it('lists every warranty claim code', () => {
    for (const code of Object.values(WARRANTY_CLAIM_ERROR_CODES)) {
      expect(CLIENT_SAFE_HTTP_ERROR_CODES.has(code)).toBe(true);
    }
  });

  it('lists the free-text part line code so agents and clients can tell it apart from a site error', () => {
    expect(CLIENT_SAFE_HTTP_ERROR_CODES.has('NOT_A_CATALOG_LINE')).toBe(true);
  });

  it('lists the active-order conflict code and forwards only its order ids', () => {
    expect(CLIENT_SAFE_HTTP_ERROR_CODES.has('VEHICLE_HAS_ACTIVE_ORDER')).toBe(true);
    expect(
      pickClientSafeHttpErrorDetails({
        code: 'VEHICLE_HAS_ACTIVE_ORDER',
        message: 'Vehicle already has active order WO-2026-0007',
        orderId: 'wo-live',
        orderNumber: 'WO-2026-0007',
        internalNote: 'not for the client',
      }),
    ).toEqual({ orderId: 'wo-live', orderNumber: 'WO-2026-0007' });
  });

  it('keeps a value from params when a non-nullable detail is null at the top level', () => {
    expect(
      pickClientSafeHttpErrorParams({
        code: 'VEHICLE_HAS_ACTIVE_ORDER',
        message: 'Vehicle already has active order WO-2026-0007',
        orderId: null,
        params: { orderId: 'wo-7' },
      }),
    ).toEqual({ orderId: 'wo-7' });
  });

  it('drops a null non-nullable detail when there is no nested value', () => {
    expect(
      pickClientSafeHttpErrorParams({
        code: 'VEHICLE_HAS_ACTIVE_ORDER',
        orderId: null,
      }),
    ).toEqual({});
  });

  it('lists the estimate send gates the advisor dialog maps to German copy', () => {
    for (const code of [
      'ESTIMATE_NOT_DRAFT',
      'ESTIMATE_NO_LINES',
      'ESTIMATE_CUSTOMER_REQUIRED',
      'ESTIMATE_CUSTOMER_INCOMPLETE',
      'SELLER_IDENTITY_INCOMPLETE',
      'WORKSHOP_ORDER_NOT_ESTIMATABLE',
      'ESTIMATE_ROLE_FORBIDDEN',
    ]) {
      expect(CLIENT_SAFE_HTTP_ERROR_CODES.has(code)).toBe(true);
    }
  });

  it('lists the Gewährleistung shortening codes so the sale form can point at the Verkürzung field', () => {
    for (const code of [
      'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED',
      'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW',
      'GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER',
    ]) {
      expect(CLIENT_SAFE_HTTP_ERROR_CODES.has(code)).toBe(true);
    }
  });

  it('lists the tyre measurement codes and forwards only the failing wheel position', () => {
    for (const code of [
      'TYRE_DOT_FUTURE_DATE',
      'TYRE_DOT_INVALID_FORMAT',
      'TYRE_DOT_INVALID_WEEK',
      'TYRE_EVALUATION_DATE_INVALID',
      'TYRE_MEASUREMENT_EVENT_INVALID',
      'TYRE_MEASUREMENT_MEDIA_INVALID',
      'TYRE_MEASUREMENT_NOT_FOUND',
      'TYRE_MEASUREMENT_ORDER_MISMATCH',
      'TYRE_MEASUREMENT_PARENT_NOT_FOUND',
      'TYRE_MEASUREMENT_VEHICLE_REQUIRED',
      'TYRE_THRESHOLDS_INVALID',
      'TYRE_TREAD_INVALID',
    ]) {
      expect(CLIENT_SAFE_HTTP_ERROR_CODES.has(code)).toBe(true);
    }
    expect(
      pickClientSafeHttpErrorParams({
        code: 'TYRE_DOT_INVALID_WEEK',
        position: 'FL',
        dot: '0020',
      }),
    ).toEqual({ position: 'FL' });
  });

  it('forwards no detail fields for codes outside the allowlist', () => {
    expect(
      pickClientSafeHttpErrorDetails({ code: 'SOMETHING_ELSE', orderId: 'wo-live' }),
    ).toEqual({});
  });

  it('forwards the live apply lease for IMPORT_APPLY_IN_PROGRESS', () => {
    const leaseExpiresAt = '2026-10-28T12:00:00.000Z';
    expect(
      pickClientSafeHttpErrorParams({
        code: 'IMPORT_APPLY_IN_PROGRESS',
        message: 'Import job is already being applied',
        leaseExpiresAt,
        internalNote: 'not for the client',
      }),
    ).toEqual({ leaseExpiresAt });
  });

  it('forwards an explicit null lease for IMPORT_APPLY_IN_PROGRESS', () => {
    expect(
      pickClientSafeHttpErrorParams({
        code: 'IMPORT_APPLY_IN_PROGRESS',
        message: 'Import job is already being applied',
        leaseExpiresAt: null,
      }),
    ).toEqual({ leaseExpiresAt: null });
  });

  it('omits the apply lease when the body has no lease field', () => {
    expect(
      pickClientSafeHttpErrorParams({
        code: 'IMPORT_APPLY_IN_PROGRESS',
        message: 'Import job is already being applied',
      }),
    ).toEqual({});
  });

  it('forwards sanitized field_issues for listing readiness errors', () => {
    expect(
      pickClientSafeHttpErrorStructuredDetails({
        code: 'VEHICLE_LISTING_NOT_READY',
        field_issues: [
          {
            field: 'price_gross_eur',
            code: 'LISTING_PRICE_REQUIRED',
            message: 'internal copy',
          },
          { field: 123 },
        ],
      }),
    ).toEqual({
      field_issues: [{ field: 'price_gross_eur', code: 'LISTING_PRICE_REQUIRED' }],
    });
  });
});

describe('client-safe allowlist parity', () => {
  it('lists every import code the controllers and error helpers throw at a client', () => {
    const codes = clientFacingImportCodes();

    expect(codes).toEqual([
      'IMPORT_APPLY_INTERRUPTED',
      'IMPORT_APPLY_IN_PROGRESS',
      'IMPORT_DIRECT_UPLOAD_CONTENT_TYPE',
      'IMPORT_DIRECT_UPLOAD_INVALID',
      'IMPORT_DIRECT_UPLOAD_NOT_FOUND',
      'IMPORT_DIRECT_UPLOAD_TOO_LARGE',
      'IMPORT_INVALID_MAPPING',
      'IMPORT_INVALID_SOURCE_KEY',
      'IMPORT_JOB_ALREADY_APPLIED',
      'IMPORT_JOB_EXPIRED',
      'IMPORT_JOB_NOT_FOUND',
      'IMPORT_JOB_PURGED',
      'IMPORT_JOB_STALE',
      'IMPORT_SOURCE_ALREADY_EXISTS',
      'IMPORT_SOURCE_NOT_FOUND',
      'IMPORT_UNKNOWN_SOURCE',
    ]);
    for (const code of codes) {
      expect(CLIENT_SAFE_HTTP_ERROR_CODES.has(code)).toBe(true);
    }
  });

  it('publishes every allowlisted code to the web app with German and English copy', () => {
    const publicCodes = readWebPublicErrorCodes();
    const de = readLocaleErrorTexts('de');
    const en = readLocaleErrorTexts('en');

    const unpublished: string[] = [];
    const untranslated: string[] = [];
    for (const code of CLIENT_SAFE_HTTP_ERROR_CODES) {
      if (!publicCodes.has(code)) {
        unpublished.push(code);
      }
      if (!de[code]?.trim() || !en[code]?.trim()) {
        untranslated.push(code);
      }
    }

    expect(unpublished).toEqual([]);
    expect(untranslated).toEqual([]);
  });
});
