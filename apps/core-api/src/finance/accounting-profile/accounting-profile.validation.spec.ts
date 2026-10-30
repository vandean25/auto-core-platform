import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_AT_PROFILE_CODE,
  DEFAULT_DE_PROFILE_CODE,
  RZL_SERIALIZER_RELEASE_ENV,
  defaultProfileCodeForCountry,
  defaultFormatVersionForCountry,
} from './accounting-profile.codes.js';
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
  it.each([
    ['AT', 'ACP-RZL-AT-EUR-1', 'RZL-FIBU-IMPORT-ACP-DRAFT-1'],
    ['DE', 'ACP-DATEV-DE-EUR-1', 'EXTF-700-Buchungsstapel-13'],
  ] as const)(
    'keeps %s default profile and format',
    (country, profile, format) => {
      expect(defaultProfileCodeForCountry(country)).toBe(profile);
      expect(defaultFormatVersionForCountry(country)).toBe(format);
    },
  );

  it('rejects enabling the RZL profile before serializer approval', () => {
    expect(() =>
      validateAccountingProfilePatch({ isEnabled: true }, atContext),
    ).toThrow(BadRequestException);
  });

  it('keeps autosaving an already enabled RZL profile while the flag is off', () => {
    const original = process.env[RZL_SERIALIZER_RELEASE_ENV];
    delete process.env[RZL_SERIALIZER_RELEASE_ENV];
    try {
      const patch = validateAccountingProfilePatch(
        { isEnabled: true },
        { ...atContext, currentIsEnabled: true },
      );
      expect(patch.isEnabled).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env[RZL_SERIALIZER_RELEASE_ENV];
      } else {
        process.env[RZL_SERIALIZER_RELEASE_ENV] = original;
      }
    }
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

  it('disables an enabled AT profile that switches to a DATEV serializer', () => {
    const patch = validateAccountingProfilePatch(
      { profileCode: DEFAULT_DE_PROFILE_CODE, chart: 'SKR03' },
      {
        countryIso: 'AT',
        currentProfileCode: DEFAULT_AT_PROFILE_CODE,
        currentChart: 'UGB',
        currentIsEnabled: true,
      },
    );
    expect(patch.isEnabled).toBe(false);
  });

  describe('RZL release gate', () => {
    const originalFlag = process.env[RZL_SERIALIZER_RELEASE_ENV];

    function setRzlRelease(value: string | undefined) {
      if (value === undefined) {
        delete process.env[RZL_SERIALIZER_RELEASE_ENV];
      } else {
        process.env[RZL_SERIALIZER_RELEASE_ENV] = value;
      }
    }

    afterEach(() => {
      setRzlRelease(originalFlag);
    });

    it('allows enabling RZL for AT entities once the release flag is on', () => {
      setRzlRelease('true');
      const patch = validateAccountingProfilePatch(
        { isEnabled: true },
        atContext,
      );
      expect(patch.isEnabled).toBe(true);
    });

    it('rejects enabling RZL for DE entities even when released', () => {
      setRzlRelease('true');
      expect(() =>
        validateAccountingProfilePatch(
          { isEnabled: true },
          { ...atContext, countryIso: 'DE' },
        ),
      ).toThrow('RZL export profile can only be enabled for AT legal entities');
    });

    it('keeps DATEV enablement independent of the RZL flag', () => {
      setRzlRelease(undefined);
      const patch = validateAccountingProfilePatch(
        { isEnabled: true },
        deContext,
      );
      expect(patch.isEnabled).toBe(true);
    });

    it('blocks switching an enabled profile onto RZL while the flag is off', () => {
      setRzlRelease(undefined);
      expect(() =>
        validateAccountingProfilePatch(
          {
            profileCode: DEFAULT_AT_PROFILE_CODE,
            chart: 'UGB',
            isEnabled: true,
          },
          {
            countryIso: 'AT',
            currentProfileCode: DEFAULT_DE_PROFILE_CODE,
            currentChart: 'SKR03',
            currentIsEnabled: true,
          },
        ),
      ).toThrow(
        'Accounting export profile cannot be enabled until its serializer is released',
      );
    });

    it('allows an enabled profile to switch onto RZL once the flag is on', () => {
      setRzlRelease('true');
      const patch = validateAccountingProfilePatch(
        { profileCode: DEFAULT_AT_PROFILE_CODE, chart: 'UGB', isEnabled: true },
        {
          countryIso: 'AT',
          currentProfileCode: DEFAULT_DE_PROFILE_CODE,
          currentChart: 'SKR03',
          currentIsEnabled: true,
        },
      );
      expect(patch.isEnabled).toBe(true);
    });
  });
});
