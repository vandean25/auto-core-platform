import {
  BMD_EXPORT_MISSING_FIELDS,
  computeBmdExportMissingFields,
} from './accounting-profile-bmd-export-readiness.js';
import {
  DEFAULT_BMD_AT_PROFILE_CODE,
  DEFAULT_BMD_FORMAT_VERSION,
} from './bmd-profile.codes.js';

const complete = {
  profileCode: DEFAULT_BMD_AT_PROFILE_CODE,
  formatVersion: DEFAULT_BMD_FORMAT_VERSION,
  chart: 'UGB',
  accountLength: 4,
  defaultDebtorAccount: '2000',
  serializerParams: {
    steuercodes: { vat20: '5020', vat13: '5013', vat10: '5010' },
  },
};

describe('computeBmdExportMissingFields', () => {
  it('reports nothing for a complete BMD configuration', () => {
    expect(computeBmdExportMissingFields(complete)).toEqual([]);
  });

  it('reports nothing for profile codes that are not BMD', () => {
    expect(
      computeBmdExportMissingFields({
        ...complete,
        profileCode: 'ACP-RZL-AT-EUR-1',
        serializerParams: {},
      }),
    ).toEqual([]);
    expect(
      computeBmdExportMissingFields({
        ...complete,
        profileCode: 'ACP-DATEV-DE-EUR-1',
        serializerParams: {},
      }),
    ).toEqual([]);
  });

  it('lists each missing Steuercode in rate order', () => {
    expect(
      computeBmdExportMissingFields({ ...complete, serializerParams: {} }),
    ).toEqual([
      'steuercode_vat20',
      'steuercode_vat13',
      'steuercode_vat10',
    ]);
  });

  it('treats a blank Steuercode as missing', () => {
    expect(
      computeBmdExportMissingFields({
        ...complete,
        serializerParams: {
          steuercodes: { vat20: '  ', vat13: '5013', vat10: '5010' },
        },
      }),
    ).toEqual(['steuercode_vat20']);
  });

  it('requires the pinned BMD format version', () => {
    expect(
      computeBmdExportMissingFields({
        ...complete,
        formatVersion: 'BMD-NTCS-ASCII-IMPORT-ACP-DRAFT-0',
      }),
    ).toEqual(['format_version']);
  });

  it('requires a chart, an account length and a default debtor account', () => {
    expect(
      computeBmdExportMissingFields({
        ...complete,
        chart: null,
        accountLength: null,
        defaultDebtorAccount: null,
      }),
    ).toEqual(['chart', 'account_length', 'default_debtor_account']);
  });

  it('rejects an account length below 1', () => {
    expect(
      computeBmdExportMissingFields({ ...complete, accountLength: 0 }),
    ).toEqual(['account_length']);
  });

  it('rejects a debtor account the file cannot carry', () => {
    expect(
      computeBmdExportMissingFields({
        ...complete,
        defaultDebtorAccount: 'Müller',
      }),
    ).toEqual(['default_debtor_account']);
  });

  it('exposes the stable field names used by the API', () => {
    expect(BMD_EXPORT_MISSING_FIELDS.STEUERCODE_VAT20).toBe(
      'steuercode_vat20',
    );
    expect(BMD_EXPORT_MISSING_FIELDS.DEFAULT_DEBTOR_ACCOUNT).toBe(
      'default_debtor_account',
    );
  });
});
