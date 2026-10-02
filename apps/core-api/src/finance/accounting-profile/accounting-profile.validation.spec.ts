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
});
