import {
  PUBLIC_ERROR_CODE_REGISTRY,
  isPublicWireErrorCode,
  listPublicWireErrorCodes,
} from './public-error-code-registry.js';

describe('public error code registry', () => {
  it('lists every client-safe wire code as public', () => {
    expect(isPublicWireErrorCode('ACTIVE_SITE_REQUIRED')).toBe(true);
    expect(isPublicWireErrorCode('IMPORT_JOB_NOT_FOUND')).toBe(true);
    expect(PUBLIC_ERROR_CODE_REGISTRY.codes.ACTIVE_SITE_REQUIRED?.params).toEqual([]);
  });

  it('exposes a stable generated catalog', () => {
    const codes = listPublicWireErrorCodes();
    expect(codes.length).toBeGreaterThan(100);
    expect(codes).toContain('CHECK_IN_CONFLICT');
  });
});
