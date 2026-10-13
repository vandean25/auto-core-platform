import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_AT_PROFILE_CODE,
  DEFAULT_DE_PROFILE_CODE,
} from './accounting-profile.codes.js';
import { validateAccountingProfilePatch } from './accounting-profile.validation.js';

const deContext = {
  countryIso: 'DE' as const,
  currentProfileCode: DEFAULT_DE_PROFILE_CODE,
  currentChart: 'SKR03',
};

const storedMargin = {
  marginScheme: { enabled: true, vatAccount: '1776' },
};

describe('accounting-profile.validation margin scheme merge', () => {
  it('rejects a profile change to RZL while the margin scheme is stored as enabled', () => {
    expect(() =>
      validateAccountingProfilePatch(
        { profileCode: DEFAULT_AT_PROFILE_CODE },
        {
          countryIso: 'AT',
          currentProfileCode: DEFAULT_DE_PROFILE_CODE,
          currentChart: 'UGB',
          currentSerializerParams: storedMargin,
        },
      ),
    ).toThrow(BadRequestException);
  });

  it('allows a profile change to RZL once the stored margin scheme is disabled', () => {
    const patch = validateAccountingProfilePatch(
      { profileCode: DEFAULT_AT_PROFILE_CODE },
      {
        countryIso: 'AT',
        currentProfileCode: DEFAULT_DE_PROFILE_CODE,
        currentChart: 'UGB',
        currentSerializerParams: {
          marginScheme: { enabled: false, vatAccount: '1776' },
        },
      },
    );

    expect(patch.profileCode).toBe(DEFAULT_AT_PROFILE_CODE);
  });

  it('rejects enabling the margin scheme on an RZL profile', () => {
    expect(() =>
      validateAccountingProfilePatch(
        {
          serializerParams: {
            marginScheme: { enabled: true, vatAccount: '1776' },
          },
        },
        {
          countryIso: 'AT',
          currentProfileCode: DEFAULT_AT_PROFILE_CODE,
          currentChart: 'UGB',
        },
      ),
    ).toThrow(BadRequestException);
  });

  it('accepts an enabled-only margin patch when a VAT account is already stored', () => {
    const patch = validateAccountingProfilePatch(
      { serializerParams: { marginScheme: { enabled: true } } },
      { ...deContext, currentSerializerParams: storedMargin },
    );

    expect(patch.serializerParams).toEqual({
      marginScheme: { enabled: true, vatAccount: '1776' },
    });
  });

  it('rejects an enabled margin patch when neither the patch nor the stored params has a VAT account', () => {
    expect(() =>
      validateAccountingProfilePatch(
        { serializerParams: { marginScheme: { enabled: true } } },
        { ...deContext, currentSerializerParams: {} },
      ),
    ).toThrow(BadRequestException);
  });

  it('keeps the stored margin switch on an RZL-only patch', () => {
    const patch = validateAccountingProfilePatch(
      { serializerParams: { rzl: { firmNumber: 'FN-1' } } },
      { ...deContext, currentSerializerParams: storedMargin },
    );

    expect(patch.serializerParams).toEqual({
      rzl: expect.objectContaining({ firmNumber: 'FN-1' }),
      marginScheme: { enabled: true, vatAccount: '1776' },
    });
  });

  it('keeps the stored switch on a VAT-account-only patch', () => {
    const patch = validateAccountingProfilePatch(
      { serializerParams: { marginScheme: { vatAccount: '1777' } } },
      { ...deContext, currentSerializerParams: storedMargin },
    );

    expect(patch.serializerParams).toEqual({
      marginScheme: { enabled: true, vatAccount: '1777' },
    });
  });

  it('clears the stored VAT account only when the patch sends null', () => {
    const patch = validateAccountingProfilePatch(
      {
        serializerParams: {
          marginScheme: { enabled: false, vatAccount: null },
        },
      },
      { ...deContext, currentSerializerParams: storedMargin },
    );

    expect(patch.serializerParams).toEqual({
      marginScheme: { enabled: false, vatAccount: null },
    });
  });
});
