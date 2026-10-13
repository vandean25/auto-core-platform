import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { assertChartAllowedForProfile } from '../accounting-profile/accounting-chart-catalog.js';
import { isAccountingExportReleased } from '../accounting-profile/accounting-export-release.js';
import {
  isExportSerializerReleased,
  RZL_SERIALIZER_RELEASE_ENV,
} from '../accounting-profile/accounting-profile.codes.js';
import {
  BMD_SERIALIZER_RELEASE_ENV,
  DEFAULT_BMD_AT_PROFILE_CODE,
  isBmdProfileCode,
  isBmdSerializerReleased,
} from '../accounting-profile/bmd-profile.codes.js';
import { validateAccountingProfilePatch } from '../accounting-profile/accounting-profile.validation.js';
import {
  buildAccountingExportFilenameForRun,
  exportProfileCanGenerate,
  resolveAccountingExportSerializer,
} from './accounting-export-serializer.registry.js';
import {
  BMD_SAMPLE_CREATED_AT,
  BMD_SAMPLE_DATE_FROM,
  BMD_SAMPLE_DATE_TO,
  bmdSampleProfile,
  bmdSampleRows,
} from './fixtures/bmd-sample-export.fixture.js';

const atContext = {
  countryIso: 'AT' as const,
  currentProfileCode: DEFAULT_BMD_AT_PROFILE_CODE,
  currentChart: 'UGB',
  currentIsEnabled: false,
};

const serializeInput = {
  profile: bmdSampleProfile,
  dateFrom: BMD_SAMPLE_DATE_FROM,
  dateTo: BMD_SAMPLE_DATE_TO,
  createdAt: BMD_SAMPLE_CREATED_AT,
  rows: bmdSampleRows,
};

describe('BMD profile release gate', () => {
  const originalBmdFlag = process.env[BMD_SERIALIZER_RELEASE_ENV];
  const originalRzlFlag = process.env[RZL_SERIALIZER_RELEASE_ENV];

  function setFlag(name: string, value: string | undefined) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  afterEach(() => {
    setFlag(BMD_SERIALIZER_RELEASE_ENV, originalBmdFlag);
    setFlag(RZL_SERIALIZER_RELEASE_ENV, originalRzlFlag);
  });

  it('recognises the BMD profile code and no other', () => {
    expect(isBmdProfileCode('ACP-BMD-AT-EUR-1')).toBe(true);
    expect(isBmdProfileCode('ACP-RZL-AT-EUR-1')).toBe(false);
    expect(isBmdProfileCode('ACP-DATEV-DE-EUR-1')).toBe(false);
    expect(isBmdProfileCode(null)).toBe(false);
  });

  it('keeps the BMD serializer released only when the flag is exactly true (default off)', () => {
    setFlag(BMD_SERIALIZER_RELEASE_ENV, undefined);
    expect(isBmdSerializerReleased()).toBe(false);
    expect(isAccountingExportReleased(DEFAULT_BMD_AT_PROFILE_CODE)).toBe(false);

    setFlag(BMD_SERIALIZER_RELEASE_ENV, 'false');
    expect(isAccountingExportReleased(DEFAULT_BMD_AT_PROFILE_CODE)).toBe(false);

    setFlag(BMD_SERIALIZER_RELEASE_ENV, 'true');
    expect(isBmdSerializerReleased()).toBe(true);
    expect(isAccountingExportReleased(DEFAULT_BMD_AT_PROFILE_CODE)).toBe(true);
  });

  it('keeps the RZL and BMD flags independent', () => {
    setFlag(RZL_SERIALIZER_RELEASE_ENV, undefined);
    setFlag(BMD_SERIALIZER_RELEASE_ENV, 'true');

    expect(isExportSerializerReleased('ACP-RZL-AT-EUR-1')).toBe(false);
    expect(isAccountingExportReleased(DEFAULT_BMD_AT_PROFILE_CODE)).toBe(true);
  });

  it('registers the BMD serializer on the AUT-350 registry with the shared limits', () => {
    const serializer = resolveAccountingExportSerializer(
      DEFAULT_BMD_AT_PROFILE_CODE,
    );

    expect(serializer.profileCode).toBe(DEFAULT_BMD_AT_PROFILE_CODE);
    expect(serializer.isImplemented).toBe(true);
    expect(serializer.limits).toEqual({
      maxCsvBytes: 20 * 1024 * 1024,
      maxDocumentsPerRun: 10_000,
    });
  });

  it('lets a BMD profile generate only when it is enabled and the flag is on', () => {
    setFlag(BMD_SERIALIZER_RELEASE_ENV, undefined);
    expect(exportProfileCanGenerate(DEFAULT_BMD_AT_PROFILE_CODE, true)).toBe(
      false,
    );

    setFlag(BMD_SERIALIZER_RELEASE_ENV, 'true');
    expect(exportProfileCanGenerate(DEFAULT_BMD_AT_PROFILE_CODE, false)).toBe(
      false,
    );
    expect(exportProfileCanGenerate(DEFAULT_BMD_AT_PROFILE_CODE, true)).toBe(
      true,
    );
  });

  it('fails closed in the serializer itself while the flag is off, even after a preview', () => {
    setFlag(BMD_SERIALIZER_RELEASE_ENV, undefined);
    const serializer = resolveAccountingExportSerializer(
      DEFAULT_BMD_AT_PROFILE_CODE,
    );

    let caught: unknown;
    try {
      serializer.serialize(serializeInput);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnprocessableEntityException);
    expect((caught as UnprocessableEntityException).getResponse()).toMatchObject(
      { code: 'EXPORT_PROFILE_DISABLED' },
    );
  });

  it('serializes once the flag is on', () => {
    setFlag(BMD_SERIALIZER_RELEASE_ENV, 'true');
    const serializer = resolveAccountingExportSerializer(
      DEFAULT_BMD_AT_PROFILE_CODE,
    );

    const result = serializer.serialize(serializeInput);

    expect(result.rowCount).toBe(bmdSampleRows.length);
    expect(result.byteLength).toBe(result.bytes.length);
  });

  it('names BMD runs with the BMD prefix', () => {
    expect(
      buildAccountingExportFilenameForRun(DEFAULT_BMD_AT_PROFILE_CODE, {
        legalEntityId: 'le-1',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        runId: 'run-1',
      }),
    ).toBe('BMD_le-1_2026-01-01_2026-01-31_run-1.csv');
  });

  it('refuses to enable the BMD profile while the flag is off', () => {
    setFlag(BMD_SERIALIZER_RELEASE_ENV, undefined);

    expect(() =>
      validateAccountingProfilePatch({ isEnabled: true }, atContext),
    ).toThrow(BadRequestException);
  });

  it('allows enabling an AT BMD profile once the flag is on', () => {
    setFlag(BMD_SERIALIZER_RELEASE_ENV, 'true');

    expect(
      validateAccountingProfilePatch({ isEnabled: true }, atContext),
    ).toMatchObject({ isEnabled: true });
  });

  it('refuses to enable the BMD profile for a DE legal entity', () => {
    setFlag(BMD_SERIALIZER_RELEASE_ENV, 'true');

    expect(() =>
      validateAccountingProfilePatch(
        { isEnabled: true },
        { ...atContext, countryIso: 'DE' },
      ),
    ).toThrow('BMD export profile can only be enabled for AT legal entities');
  });

  it('disables the profile when its code is switched to BMD, as for any serializer switch', () => {
    const normalized = validateAccountingProfilePatch(
      { profileCode: DEFAULT_BMD_AT_PROFILE_CODE },
      {
        countryIso: 'AT',
        currentProfileCode: 'ACP-RZL-AT-EUR-1',
        currentChart: 'UGB',
        currentIsEnabled: true,
      },
    );

    expect(normalized.isEnabled).toBe(false);
  });

  it('allows only the AT charts UGB and EA for BMD', () => {
    expect(() =>
      assertChartAllowedForProfile(DEFAULT_BMD_AT_PROFILE_CODE, 'UGB'),
    ).not.toThrow();
    expect(() =>
      assertChartAllowedForProfile(DEFAULT_BMD_AT_PROFILE_CODE, 'EA'),
    ).not.toThrow();
    expect(() =>
      assertChartAllowedForProfile(DEFAULT_BMD_AT_PROFILE_CODE, 'SKR03'),
    ).toThrow('chart must be one of UGB, EA for BMD profiles');
  });
});
