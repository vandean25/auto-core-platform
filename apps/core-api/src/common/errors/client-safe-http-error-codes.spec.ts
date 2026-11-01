import { readdirSync, readFileSync } from 'node:fs';
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

/** Codes import sources throw at a client, recursively scanned across all non-test files under import/. */
function clientFacingImportCodes(): string[] {
  const keys = new Set<keyof typeof IMPORT_ERROR_CODES>();
  const importDir = resolve(API_SRC_ROOT, 'import');

  function scanDir(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.test.ts') &&
        entry.name !== 'import.constants.ts'
      ) {
        const source = readFileSync(fullPath, 'utf8');
        for (const match of source.matchAll(/IMPORT_ERROR_CODES\.([A-Z0-9_]+)/g)) {
          keys.add(match[1] as keyof typeof IMPORT_ERROR_CODES);
        }
      }
    }
  }

  scanDir(importDir);
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
  it('lists workshop command error codes', () => {
    for (const code of ['AUDIO_EMPTY', 'AUDIO_TOO_LARGE', 'AUDIO_UNSUPPORTED_TYPE', 'COMMAND_ID_REUSED', 'CONTRACT_VERSION_UNSUPPORTED', 'DURATION_REQUIRED', 'HUMAN_ONLY_EXCLUDED', 'INTENT_INCOMPLETE', 'LOANER_NOT_PERMITTED', 'LOCALE_UNSUPPORTED', 'PLAN_STALE', 'RESOURCE_AMBIGUOUS', 'RESOURCE_MISSING', 'SELECTION_NOT_OFFERED', 'SESSION_NOT_FOUND', 'SITE_MISMATCH', 'TEXT_TOO_LONG', 'TIME_CONTRADICTORY', 'TIME_IN_PAST', 'TRANSCRIPT_EMPTY', 'UNSUPPORTED_GRAMMAR', 'UNSUPPORTED_SERVICE']) {
      expect(CLIENT_SAFE_HTTP_ERROR_CODES.has(code)).toBe(true);
    }
  });
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
      'IMPORT_AMBIGUOUS_VENDOR',
      'IMPORT_APPLY_FAILED',
      'IMPORT_APPLY_INTERRUPTED',
      'IMPORT_APPLY_IN_PROGRESS',
      'IMPORT_ARTICLE_NOT_FOUND',
      'IMPORT_DESCRIPTION_REQUIRED',
      'IMPORT_DIRECT_UPLOAD_CONTENT_TYPE',
      'IMPORT_DIRECT_UPLOAD_INVALID',
      'IMPORT_DIRECT_UPLOAD_NOT_FOUND',
      'IMPORT_DIRECT_UPLOAD_TOO_LARGE',
      'IMPORT_DUPLICATE_ARTICLE_NO_IN_FILE',
      'IMPORT_DUPLICATE_CODE_IN_FILE',
      'IMPORT_DUPLICATE_EMAIL_IN_FILE',
      'IMPORT_DUPLICATE_EXTERNAL_ID_IN_FILE',
      'IMPORT_EMPTY_FILE',
      'IMPORT_FILE_TOO_LARGE',
      'IMPORT_GROUP_TOO_LARGE',
      'IMPORT_INVALID_COST_PRICE',
      'IMPORT_INVALID_ENCODING',
      'IMPORT_INVALID_ENTITY_TYPE',
      'IMPORT_INVALID_HOURLY_RATE',
      'IMPORT_INVALID_INTERNAL_COST',
      'IMPORT_INVALID_MAPPING',
      'IMPORT_INVALID_SOURCE_KEY',
      'IMPORT_INVALID_STANDARD_AW',
      'IMPORT_JOB_ALREADY_APPLIED',
      'IMPORT_JOB_EXPIRED',
      'IMPORT_JOB_NOT_FOUND',
      'IMPORT_JOB_PURGED',
      'IMPORT_JOB_STALE',
      'IMPORT_LABOR_CODE_CONFLICT',
      'IMPORT_LABOR_CODE_REQUIRED',
      'IMPORT_LABOR_DESCRIPTION_REQUIRED',
      'IMPORT_LABOR_FITMENT_MAKE_MODEL_REQUIRED',
      'IMPORT_MAPPING_PROFILE_EXISTS',
      'IMPORT_PRICE_JUMP_REQUIRES_ACCEPTANCE',
      'IMPORT_ROW_LIMIT_EXCEEDED',
      'IMPORT_ROW_STALE',
      'IMPORT_SOURCE_ALREADY_EXISTS',
      'IMPORT_SOURCE_NOT_FOUND',
      'IMPORT_STORAGE_UNAVAILABLE',
      'IMPORT_SUPPLIER_ARTICLE_NO_REQUIRED',
      'IMPORT_SUPPLIER_VENDOR_REQUIRED',
      'IMPORT_UNKNOWN_SOURCE',
      'PRICE_JUMP_EXCEEDED',
      'RRP_MISSING_FOR_MARGIN_RULE',
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
