import { selectPickerlComputationRecords } from './apply-pickerl-record-selection.js';

describe('selectPickerlComputationRecords', () => {
  it('detects manual expiry ambiguity on the same day', () => {
    const result = selectPickerlComputationRecords([
      {
        inspected_on: '2026-10-15',
        plaketten_valid_until_year: 2027,
        plaketten_valid_until_month: 10,
        source: 'MANUAL',
      },
      {
        inspected_on: '2026-10-15',
        plaketten_valid_until_year: 2028,
        plaketten_valid_until_month: 10,
        source: 'MANUAL',
      },
    ]);
    expect(result.forceUnknown).toBe(true);
    expect(result.extraWarnings.map((w) => w.code)).toContain(
      'MANUAL_EXPIRY_AMBIGUITY',
    );
  });

  it('forces UNKNOWN when external conflict barrier is active', () => {
    const result = selectPickerlComputationRecords(
      [
        {
          inspected_on: '2026-10-15',
          plaketten_valid_until_year: 2027,
          plaketten_valid_until_month: 10,
          source: 'MANUAL',
        },
      ],
      { externalConflictBarrier: true },
    );
    expect(result.forceUnknown).toBe(true);
    expect(result.extraWarnings.map((w) => w.code)).toContain(
      'EXTERNAL_RESULT_REQUIRES_REVIEW',
    );
  });
});
