import { UnprocessableEntityException } from '@nestjs/common';
import {
  buildAccountingExportFilenameForRun,
  exportProfileCanGenerate,
  resolveAccountingExportSerializer,
} from './accounting-export-serializer.registry.js';

describe('accounting-export-serializer.registry', () => {
  it('resolves the DATEV serializer for the DE profile code', () => {
    const serializer = resolveAccountingExportSerializer('ACP-DATEV-DE-EUR-1');
    expect(serializer.isImplemented).toBe(true);
    expect(serializer.profileCode).toBe('ACP-DATEV-DE-EUR-1');
  });

  it('registers the RZL profile stub as not implemented', () => {
    const serializer = resolveAccountingExportSerializer('ACP-RZL-AT-EUR-1');
    expect(serializer.isImplemented).toBe(false);
    expect(() =>
      serializer.serialize({
        profile: {
          version: 1,
          profileCode: 'ACP-RZL-AT-EUR-1',
          formatVersion: null,
          chart: 'UGB',
          accountLength: 4,
          advisorNumber: null,
          clientNumber: null,
          fiscalYearStartMonth: 1,
          defaultDebtorAccount: '2000',
          serializerParams: {},
          isEnabled: false,
        },
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        rows: [],
      }),
    ).toThrow(UnprocessableEntityException);
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

  it('treats enabled RZL profiles as not generatable', () => {
    expect(exportProfileCanGenerate('ACP-RZL-AT-EUR-1', true)).toBe(false);
    expect(exportProfileCanGenerate('ACP-DATEV-DE-EUR-1', true)).toBe(true);
    expect(exportProfileCanGenerate('ACP-DATEV-DE-EUR-1', false)).toBe(false);
  });
});
