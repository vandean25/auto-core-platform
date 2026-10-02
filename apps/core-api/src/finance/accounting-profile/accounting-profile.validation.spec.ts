import { BadRequestException } from '@nestjs/common';
import { DEFAULT_AT_PROFILE_CODE, DEFAULT_DE_PROFILE_CODE } from './accounting-profile.codes.js';
import { validateAccountingProfilePatch } from './accounting-profile.validation.js';

const deContext = {
  countryIso: 'DE' as const,
  currentProfileCode: DEFAULT_DE_PROFILE_CODE,
  currentChart: 'SKR03',
};

const atContext = {
  countryIso: 'AT' as const,
  currentProfileCode: DEFAULT_AT_PROFILE_CODE,
  currentChart: 'UGB',
};

describe('accounting-profile.validation', () => {
  it('rejects enabling the RZL profile before serializer approval', () => {
    expect(() =>
      validateAccountingProfilePatch({ isEnabled: true }, atContext),
    ).toThrow(BadRequestException);
  });

  it('rejects enabling DATEV export for AT entities', () => {
    expect(() =>
      validateAccountingProfilePatch(
        { isEnabled: true, profileCode: DEFAULT_DE_PROFILE_CODE },
        atContext,
      ),
    ).toThrow(BadRequestException);
  });

  it('allows incomplete profile patches', () => {
    const patch = validateAccountingProfilePatch(
      { advisorNumber: '12345' },
      deContext,
    );
    expect(patch.advisorNumber).toBe('12345');
  });

  it('drops incomplete mapping rules instead of rejecting the patch', () => {
    const patch = validateAccountingProfilePatch(
      {
        mappingRules: [
          {
            sourceCategoryKey: 'labor',
            sourceCategoryLabel: 'Labor',
            taxMode: 'STANDARD',
            taxRate: '20.00',
            revenueAccount: '',
            taxTreatment: 'automatic',
          },
        ],
      },
      deContext,
    );

    expect(patch.mappingRules).toEqual([]);
  });

  it('rejects manual_bu without buKey', () => {
    expect(() =>
      validateAccountingProfilePatch(
        {
          mappingRules: [
            {
              sourceCategoryKey: 'labor',
              sourceCategoryLabel: 'Labor',
              taxMode: 'STANDARD',
              taxRate: '20.00',
              revenueAccount: '4000',
              taxTreatment: 'manual_bu',
            },
          ],
        },
        deContext,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects DATEV charts on RZL profiles', () => {
    expect(() =>
      validateAccountingProfilePatch({ chart: 'SKR03' }, atContext),
    ).toThrow(BadRequestException);
  });

  it('allows saving unrelated fields when legacy chart is unchanged', () => {
    const patch = validateAccountingProfilePatch(
      { chart: 'skr03', advisorNumber: '99999' },
      {
        countryIso: 'DE',
        currentProfileCode: DEFAULT_DE_PROFILE_CODE,
        currentChart: 'skr03',
      },
    );
    expect(patch.advisorNumber).toBe('99999');
  });

  it('disables export when profile code changes to a non-implemented serializer', () => {
    const patch = validateAccountingProfilePatch(
      { profileCode: DEFAULT_AT_PROFILE_CODE, chart: 'UGB' },
      {
        countryIso: 'DE',
        currentProfileCode: DEFAULT_DE_PROFILE_CODE,
        currentChart: 'SKR03',
      },
    );
    expect(patch.isEnabled).toBe(false);
  });
});
