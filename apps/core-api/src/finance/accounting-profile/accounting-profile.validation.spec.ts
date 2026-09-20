import { BadRequestException } from '@nestjs/common';
import { validateAccountingProfilePatch } from './accounting-profile.validation.js';

describe('accounting-profile.validation', () => {
  it('rejects enabling DATEV export for AT entities', () => {
    expect(() =>
      validateAccountingProfilePatch({ isEnabled: true }, 'AT'),
    ).toThrow(BadRequestException);
  });

  it('allows incomplete profile patches', () => {
    const patch = validateAccountingProfilePatch(
      { advisorNumber: '12345' },
      'DE',
    );
    expect(patch.advisorNumber).toBe('12345');
  });

  it('rejects malformed mapping rules', () => {
    expect(() =>
      validateAccountingProfilePatch(
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
        'DE',
      ),
    ).toThrow(BadRequestException);
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
        'DE',
      ),
    ).toThrow(BadRequestException);
  });
});
