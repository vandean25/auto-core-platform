import { DEFAULT_RZL_FORMAT_VERSION } from './accounting-profile.codes.js';
import {
  computeRzlExportMissingFields,
  RZL_EXPORT_MISSING_FIELDS,
  rzlExportMissingFieldLabel,
} from './accounting-profile-export-readiness.js';

const complete = {
  profileCode: 'ACP-RZL-AT-EUR-1',
  formatVersion: DEFAULT_RZL_FORMAT_VERSION,
  chart: 'UGB',
  accountLength: 4,
  defaultDebtorAccount: '2000',
  serializerParams: {
    firmNumber: 'FN-4711',
    steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
  },
};

describe('computeRzlExportMissingFields', () => {
  it('returns nothing when the RZL export configuration is complete', () => {
    expect(computeRzlExportMissingFields(complete)).toEqual([]);
  });

  it('reports every missing export-only item', () => {
    expect(
      computeRzlExportMissingFields({
        ...complete,
        formatVersion: 'RZL-FIBU-IMPORT-PENDING',
        chart: null,
        accountLength: null,
        defaultDebtorAccount: '  ',
        serializerParams: { steuercodes: { vat20: '20', vat13: null } },
      }),
    ).toEqual([
      RZL_EXPORT_MISSING_FIELDS.FIRM_NUMBER,
      RZL_EXPORT_MISSING_FIELDS.STEUERCODE_VAT13,
      RZL_EXPORT_MISSING_FIELDS.STEUERCODE_VAT10,
      RZL_EXPORT_MISSING_FIELDS.FORMAT_VERSION,
      RZL_EXPORT_MISSING_FIELDS.CHART,
      RZL_EXPORT_MISSING_FIELDS.ACCOUNT_LENGTH,
      RZL_EXPORT_MISSING_FIELDS.DEFAULT_DEBTOR_ACCOUNT,
    ]);
  });

  it('does not apply RZL rules to DATEV profiles', () => {
    expect(
      computeRzlExportMissingFields({
        ...complete,
        profileCode: 'ACP-DATEV-DE-EUR-1',
        serializerParams: {},
      }),
    ).toEqual([]);
  });

  it('labels every missing field for blocker messages', () => {
    for (const field of Object.values(RZL_EXPORT_MISSING_FIELDS)) {
      expect(rzlExportMissingFieldLabel(field).length).toBeGreaterThan(0);
    }
  });
});
