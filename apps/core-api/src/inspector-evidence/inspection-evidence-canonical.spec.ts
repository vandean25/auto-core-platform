import {
  assessEvidence,
  clampReviewValidUntil,
  evaluateFreshness,
  parseAssessmentInstant,
  resolveEvidenceReviewState,
} from './inspection-evidence-canonical.js';
import { SYNTHETIC_INSPECTOR_EVIDENCE_PAYLOAD } from './inspection-evidence-synthetic-fixtures.js';
import type { StoredEvidenceRevision } from './inspection-evidence.types.js';

let revisionCounter = 0;

function reviewedRevision(
  overrides: Partial<StoredEvidenceRevision> = {},
): StoredEvidenceRevision {
  revisionCounter += 1;
  return {
    ...SYNTHETIC_INSPECTOR_EVIDENCE_PAYLOAD,
    id: overrides.id ?? `rev-${revisionCounter}`,
    predecessor_revision_id: overrides.predecessor_revision_id ?? null,
    created_at: overrides.created_at ?? new Date('2026-10-16T08:00:00Z'),
    evidence_review: 'EVIDENCE_REVIEWED',
    document_digest: 'a'.repeat(64),
    reviewed_at: new Date('2026-10-16T09:00:00Z'),
    review_valid_until: new Date('2026-11-15T09:00:00Z'),
    ...overrides,
  };
}

describe('inspection-evidence-canonical', () => {
  const station = 'SYNTH-STATION-1';
  const now = new Date('2026-10-16T10:00:00Z');

  it('parseAssessmentInstant rejects invalid timestamps', () => {
    expect(() => parseAssessmentInstant('not-a-date', now)).toThrow(
      'INVALID_ASSESSMENT_TIMESTAMP',
    );
  });

  it('resolveEvidenceReviewState honors SOURCE_CONFLICT rows', () => {
    expect(
      resolveEvidenceReviewState([
        reviewedRevision({ evidence_review: 'SOURCE_CONFLICT' }),
      ]),
    ).toBe('SOURCE_CONFLICT');
  });

  it('clampReviewValidUntil caps client bound to 30 days after review', () => {
    const reviewedAt = new Date('2026-10-16T09:00:00Z');
    const capped = clampReviewValidUntil(
      reviewedAt,
      new Date('2099-01-01T00:00:00Z'),
    );
    expect(capped.getTime()).toBe(
      reviewedAt.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
  });

  it('evaluateFreshness is STALE when as_of equals review_valid_until', () => {
    const revision = reviewedRevision({
      review_valid_until: new Date('2026-10-16T10:00:00Z'),
    });
    expect(
      evaluateFreshness(revision, new Date('2026-10-16T10:00:00Z')),
    ).toBe('STALE');
  });

  describe('assessEvidence', () => {
    it('returns UNKNOWN when no evidence exists', () => {
      const result = assessEvidence([], {
        station_ref: station,
        vehicle_class: 'M1',
        inspection_time: now,
        as_of: now,
      });
      expect(result.inspection_time_temporal_scope).toBe('UNKNOWN');
    });

    it('returns CURRENT for reviewed support with training in range', () => {
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

    it('returns EXPIRED when effective window ended before continuation', () => {
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

    it('returns CONTINUATION when explicit continuation covers after effective end', () => {
      const result = assessEvidence(
        [
          reviewedRevision({
            effective_until_exclusive: '2026-10-01',
            continuation_from: '2026-10-01',
            continuation_until_exclusive: '2027-02-01',
          }),
        ],
        {
          station_ref: station,
          vehicle_class: 'M1',
          inspection_time: new Date('2026-11-01T12:00:00Z'),
          as_of: now,
        },
      );
      expect(result.inspection_time_temporal_scope).toBe('CONTINUATION');
    });

    it('returns UNKNOWN when training next due is before inspection', () => {
      const result = assessEvidence(
        [
          reviewedRevision({
            next_training_due_on: '2026-01-10',
          }),
        ],
        {
          station_ref: station,
          vehicle_class: 'M1',
          inspection_time: now,
          as_of: now,
        },
      );
      expect(result.inspection_time_temporal_scope).toBe('UNKNOWN');
    });

    it('keeps REVOKED when a newer reviewed row does not supersede', () => {
      const revoked = reviewedRevision({
        id: 'rev-old',
        created_at: new Date('2026-09-01T08:00:00Z'),
        withdrawal_effective_at: '2026-10-15T00:00:00Z',
      });
      const newer = reviewedRevision({
        id: 'rev-new',
        created_at: new Date('2026-10-16T08:00:00Z'),
        withdrawal_effective_at: null,
        predecessor_revision_id: null,
      });
      const result = assessEvidence([newer, revoked], {
        station_ref: station,
        vehicle_class: 'M1',
        inspection_time: now,
        as_of: now,
      });
      expect(result.inspection_time_temporal_scope).toBe('REVOKED');
    });

    it('clears revocation only with evidenced predecessor link', () => {
      const revoked = reviewedRevision({
        id: 'rev-old',
        created_at: new Date('2026-09-01T08:00:00Z'),
        withdrawal_effective_at: '2026-10-15T00:00:00Z',
      });
      const successor = reviewedRevision({
        id: 'rev-new',
        created_at: new Date('2026-10-16T08:00:00Z'),
        predecessor_revision_id: 'rev-old',
        withdrawal_effective_at: null,
      });
      const result = assessEvidence([successor, revoked], {
        station_ref: station,
        vehicle_class: 'M1',
        inspection_time: now,
        as_of: now,
      });
      expect(result.inspection_time_temporal_scope).toBe('CURRENT');
    });

    it('marks stale review as UNKNOWN but keeps EXPIRED qualification status', () => {
      const result = assessEvidence(
        [
          reviewedRevision({
            effective_until_exclusive: '2026-10-16',
            review_valid_until: new Date('2026-10-16T10:00:00Z'),
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
      expect(result.inspection_time_temporal_scope).toBe('EXPIRED');
      expect(result.qualification_support_status).toBe('QUALIFICATION_EXPIRED');
    });

    it('marks stale non-expired review as UNKNOWN support', () => {
      const result = assessEvidence(
        [
          reviewedRevision({
            review_valid_until: new Date('2026-10-16T10:00:00Z'),
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
      expect(result.qualification_support_status).toBe('QUALIFICATION_UNKNOWN');
    });

    it('blocks assessment when person identity is ambiguous', () => {
      const result = assessEvidence(
        [
          reviewedRevision({ source_person_ref: 'PERSON-A' }),
          reviewedRevision({ source_person_ref: 'PERSON-B' }),
        ],
        {
          station_ref: station,
          vehicle_class: 'M1',
          inspection_time: now,
          as_of: now,
        },
      );
      expect(result.qualification_support_status).toBe('QUALIFICATION_UNKNOWN');
    });

    it('considers older non-superseded revocation beyond fifty newest rows', () => {
      const revoked = reviewedRevision({
        id: 'rev-revoked',
        created_at: new Date('2026-01-01T08:00:00Z'),
        withdrawal_effective_at: '2026-10-15T00:00:00Z',
      });
      const filler = Array.from({ length: 55 }, (_, index) =>
        reviewedRevision({
          id: `rev-filler-${index}`,
          created_at: new Date(`2026-10-${String(10 + (index % 5)).padStart(2, '0')}T08:00:00Z`),
          withdrawal_effective_at: null,
          predecessor_revision_id: null,
          source_version: `SYNTH-FILLER-${index}`,
          document_digest: `${index.toString(16).padStart(64, '0')}`,
        }),
      );
      const result = assessEvidence([...filler, revoked], {
        station_ref: station,
        vehicle_class: 'M1',
        inspection_time: now,
        as_of: now,
      });
      expect(result.inspection_time_temporal_scope).toBe('REVOKED');
    });
  });
});
