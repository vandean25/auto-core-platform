import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  assertRevision,
  assertUpdated,
  emptyProfile,
  requestHashFor,
  toProfileResponse,
  validateIdempotencyKey,
} from './document-branding-profile.rules.js';
import { DEFAULT_DOCUMENT_BRAND_THEME } from './theme-v1.js';

describe('document branding profile rules', () => {
  it('accepts printable ASCII idempotency keys up to 128 characters', () => {
    expect(validateIdempotencyKey('brand-key_01')).toBe('brand-key_01');
    expect(() => validateIdempotencyKey('x'.repeat(128))).not.toThrow();
  });

  it('rejects empty, oversized or non-printable idempotency keys', () => {
    expect(() => validateIdempotencyKey('')).toThrow(
      UnprocessableEntityException,
    );
    expect(() => validateIdempotencyKey('x'.repeat(129))).toThrow(
      UnprocessableEntityException,
    );
    expect(() => validateIdempotencyKey('has space')).toThrow(
      UnprocessableEntityException,
    );
  });

  it('hashes confirm and reset requests differently for the same revision', () => {
    expect(requestHashFor(false, 2)).toEqual(requestHashFor(false, 2));
    expect(requestHashFor(false, 2)).not.toEqual(requestHashFor(true, 2));
  });

  it('reports revision and write conflicts', () => {
    expect(() => assertRevision({ revision: 4 }, 3)).toThrow(
      /expected 3, current 4/,
    );
    expect(() => assertRevision({ revision: 4 }, 4)).not.toThrow();
    expect(() => assertUpdated(0)).toThrow(ConflictException);
    expect(() => assertUpdated(1)).not.toThrow();
  });

  it('maps a missing profile to an empty default response', () => {
    expect(
      toProfileResponse(emptyProfile('tenant-1', 'entity-1'), false),
    ).toMatchObject({
      revision: 0,
      activeRevision: 0,
      activeTheme: DEFAULT_DOCUMENT_BRAND_THEME,
      draftTheme: null,
      confirmedAt: null,
      draftSourceAssetId: null,
      draftSourceAsset: null,
    });
  });
});
