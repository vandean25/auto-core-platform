import { UnprocessableEntityException } from '@nestjs/common';
import { RZL_SERIALIZER_RELEASE_ENV } from '../accounting-profile/accounting-profile.codes.js';
import {
  buildAccountingExportFilenameForRun,
  exportProfileCanGenerate,
  resolveAccountingExportSerializer,
} from './accounting-export-serializer.registry.js';

const rzlSerializeInput = {
  profile: {
    version: 1,
    profileCode: 'ACP-RZL-AT-EUR-1',
    formatVersion: 'RZL-FIBU-IMPORT-ACP-DRAFT-1',
    chart: 'UGB',
    accountLength: 4,
    advisorNumber: null,
    clientNumber: null,
    fiscalYearStartMonth: 1,
    defaultDebtorAccount: '2000',
    serializerParams: {
      rzl: {
        firmNumber: 'FN-1',
        steuercodes: { vat20: '20', vat13: '13', vat10: '10' },
      },
    },
    isEnabled: true,
  },
  dateFrom: '2026-01-01',
  dateTo: '2026-01-31',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  rows: [],
};

describe('accounting-export-serializer.registry', () => {
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

  it('resolves the DATEV serializer for the DE profile code', () => {
    const serializer = resolveAccountingExportSerializer('ACP-DATEV-DE-EUR-1');
    expect(serializer.isImplemented).toBe(true);
    expect(serializer.profileCode).toBe('ACP-DATEV-DE-EUR-1');
  });

  it('registers the RZL serializer as implemented', () => {
    const serializer = resolveAccountingExportSerializer('ACP-RZL-AT-EUR-1');
    expect(serializer.isImplemented).toBe(true);
    expect(serializer.profileCode).toBe('ACP-RZL-AT-EUR-1');
  });

  it('refuses RZL serialization while the release flag is off', () => {
    setRzlRelease(undefined);
    const serializer = resolveAccountingExportSerializer('ACP-RZL-AT-EUR-1');

    let thrown: unknown;
    try {
      serializer.serialize(rzlSerializeInput);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnprocessableEntityException);
    expect((thrown as UnprocessableEntityException).getResponse()).toMatchObject(
      { code: 'EXPORT_PROFILE_DISABLED' },
    );
  });

  it('serializes RZL runs once the release flag is on', () => {
    setRzlRelease('true');
    const serializer = resolveAccountingExportSerializer('ACP-RZL-AT-EUR-1');
    const result = serializer.serialize(rzlSerializeInput);

    expect(result.rowCount).toBe(0);
    expect(result.bytes.subarray(0, 2).toString('latin1')).toBe('K;');
  });

  it('falls back to legacy DATEV filenames for unknown snapshot profile codes', () => {
    const filename = buildAccountingExportFilenameForRun(null, {
      legalEntityId: 'entity-1',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      runId: 'run-1',
    });
    expect(filename).toBe('EXTF_entity-1_2026-01-01_2026-01-31_run-1.csv');
  });

  it('uses RZL filenames for RZL run snapshots', () => {
    expect(
      buildAccountingExportFilenameForRun('ACP-RZL-AT-EUR-1', {
        legalEntityId: 'entity-1',
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        runId: 'run-1',
      }),
    ).toBe('RZL_entity-1_2026-01-01_2026-01-31_run-1.csv');
  });

  it('gates RZL generation on the release flag, not only on profile enablement', () => {
    setRzlRelease(undefined);
    expect(exportProfileCanGenerate('ACP-RZL-AT-EUR-1', true)).toBe(false);

    setRzlRelease('true');
    expect(exportProfileCanGenerate('ACP-RZL-AT-EUR-1', true)).toBe(true);
    expect(exportProfileCanGenerate('ACP-RZL-AT-EUR-1', false)).toBe(false);
  });

  it('keeps DATEV generation gated only by profile enablement', () => {
    setRzlRelease(undefined);
    expect(exportProfileCanGenerate('ACP-DATEV-DE-EUR-1', true)).toBe(true);
    expect(exportProfileCanGenerate('ACP-DATEV-DE-EUR-1', false)).toBe(false);
  });
});
