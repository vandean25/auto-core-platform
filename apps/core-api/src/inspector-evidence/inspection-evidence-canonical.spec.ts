import { assessEvidence } from './inspection-evidence-canonical.js';
import { SYNTHETIC_INSPECTOR_EVIDENCE_PAYLOAD } from './inspection-evidence-synthetic-fixtures.js';
import type { StoredEvidenceRevision } from './inspection-evidence.types.js';

function reviewedRevision(
  overrides: Partial<StoredEvidenceRevision> = {},
): StoredEvidenceRevision {
  return {
    ...SYNTHETIC_INSPECTOR_EVIDENCE_PAYLOAD,
    evidence_review: 'EVIDENCE_REVIEWED',
    document_digest: 'a'.repeat(64),
    reviewed_at: new Date('2026-10-16T09:00:00Z'),
    review_valid_until: new Date('2026-11-15T09:00:00Z'),
    ...overrides,
  };
}

describe('assessEvidence', () => {
  const station = 'SYNTH-STATION-1';
  const now = new Date('2026-10-16T10:00:00Z');

  it('returns UNKNOWN when no evidence exists', () => {
    const result = assessEvidence([], {
      station_ref: station,
      vehicle_class: 'M1',
      inspection_time: now,
      as_of: now,
    });
    expect(result.inspection_time_temporal_scope).toBe('UNKNOWN');
    expect(result.qualification_support_status).toBe('QUALIFICATION_UNKNOWN');
  });

  it('returns EVIDENCE_REVIEWED and CURRENT for reviewed support', () => {
    const result = assessEvidence([reviewedRevision()], {
      station_ref: station,
      vehicle_class: 'M1',
      inspection_time: now,
      as_of: now,
    });
    expect(result.evidence_review).toBe('EVIDENCE_REVIEWED');
    expect(result.inspection_time_temporal_scope).toBe('CURRENT');
    expect(result.qualification_support_status).toBe('QUALIFICATION_CURRENT');
  });

  it('returns EXPIRED when effective_until_exclusive is on inspection day', () => {
    const result = assessEvidence(
      [
        reviewedRevision({
          effective_until_exclusive: '2026-10-16',
        }),
      ],
      {
        station_ref: station,
        vehicle_class: 'M1',
        inspection_time: now,
        as_of: now,
      },
    );
    expect(result.inspection_time_temporal_scope).toBe('EXPIRED');
    expect(result.qualification_support_status).toBe('QUALIFICATION_EXPIRED');
  });

  it('returns OUT_OF_SCOPE for wrong station', () => {
    const result = assessEvidence([reviewedRevision()], {
      station_ref: 'SYNTH-STATION-2',
      vehicle_class: 'M1',
      inspection_time: now,
      as_of: now,
    });
    expect(result.inspection_time_temporal_scope).toBe('OUT_OF_SCOPE');
  });

  it('returns UNKNOWN when validity end is missing', () => {
    const result = assessEvidence(
      [reviewedRevision({ effective_until_exclusive: null })],
      {
        station_ref: station,
        vehicle_class: 'M1',
        inspection_time: now,
        as_of: now,
      },
    );
    expect(result.inspection_time_temporal_scope).toBe('UNKNOWN');
  });

  it('marks stale source review as UNKNOWN temporal scope', () => {
    const result = assessEvidence(
      [
        reviewedRevision({
          review_valid_until: new Date('2026-10-16T09:00:00Z'),
        }),
      ],
      {
        station_ref: station,
        vehicle_class: 'M1',
        inspection_time: now,
        as_of: now,
      },
    );
    expect(result.freshness).toBe('STALE');
    expect(result.inspection_time_temporal_scope).toBe('UNKNOWN');
  });
});
