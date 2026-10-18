import { UnprocessableEntityException } from '@nestjs/common';
import { resolveListingSerializer } from './listing-serializer.registry.js';

describe('listing-serializer.registry', () => {
  it('resolves the mobile.de reference serializer', () => {
    const serializer = resolveListingSerializer('MOBILE_DE_REFERENCE_V1');
    expect(serializer.profileCode).toBe('MOBILE_DE_REFERENCE_V1');
    expect(serializer.platform).toBe('MOBILE_DE');
  });

  it('resolves the AutoScout24 provisional serializer as UNVERIFIED', () => {
    const serializer = resolveListingSerializer('AS24_PROVISIONAL_V1');
    expect(serializer.profileCode).toBe('AS24_PROVISIONAL_V1');
    expect(serializer.platform).toBe('AS24');
    expect(serializer.verification).toBe('UNVERIFIED');
  });

  it('resolves the willhaben generic serializer as UNVERIFIED', () => {
    const serializer = resolveListingSerializer('WILLHABEN_GENERIC_V1');
    expect(serializer.profileCode).toBe('WILLHABEN_GENERIC_V1');
    expect(serializer.platform).toBe('WILLHABEN');
    expect(serializer.verification).toBe('UNVERIFIED');
  });

  it('rejects unknown profile codes with LISTING_SERIALIZER_UNSUPPORTED', () => {
    let thrown: unknown;
    try {
      resolveListingSerializer('UNKNOWN_PROFILE');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnprocessableEntityException);
    expect(
      (thrown as UnprocessableEntityException).getResponse(),
    ).toMatchObject({ code: 'LISTING_SERIALIZER_UNSUPPORTED' });
  });
});
