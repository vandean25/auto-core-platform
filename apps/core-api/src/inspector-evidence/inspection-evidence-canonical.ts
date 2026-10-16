import { createHash } from 'node:crypto';
import {
  INSPECTOR_EVIDENCE_SCHEMA_VERSION,
  type EvidenceAssessmentRequest,
  type EvidenceAssessmentResult,
  type EvidenceFreshness,
  type EvidenceTemporalScope,
  type InspectorEvidencePayload,
  type InspectorEvidenceReviewState,
  type QualificationSupportStatus,
  type StoredEvidenceRevision,
} from './inspection-evidence.types.js';

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function parseViennaCalendarDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid ISO calendar date: ${value}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}

export function calendarDayUtc(instant: Date): number {
  return Date.UTC(
    instant.getUTCFullYear(),
    instant.getUTCMonth(),
    instant.getUTCDate(),
  );
}

export function isInstantInCalendarInterval(
  instant: Date,
  fromInclusive: Date,
  untilExclusive: Date,
): boolean {
  const day = calendarDayUtc(instant);
  return (
    day >= calendarDayUtc(fromInclusive) && day < calendarDayUtc(untilExclusive)
  );
}

export function evidencePayloadDigest(payload: InspectorEvidencePayload): string {
  const canonical = JSON.stringify({
    schema_version: payload.schema_version,
    source_version: payload.source_version,
    issuer: payload.issuer,
    source_person_ref: payload.source_person_ref,
    station_ref: payload.station_ref,
    assignment_ref: payload.assignment_ref,
    assignment_from: payload.assignment_from,
    assignment_until_exclusive: payload.assignment_until_exclusive,
    vehicle_classes: [...payload.vehicle_classes].sort(),
    weight_scope: payload.weight_scope,
    brake_course_scope: payload.brake_course_scope,
    training_completed_on: payload.training_completed_on,
    next_training_due_on: payload.next_training_due_on,
    continuation_from: payload.continuation_from,
    continuation_until_exclusive: payload.continuation_until_exclusive,
    effective_from: payload.effective_from,
    effective_until_exclusive: payload.effective_until_exclusive,
    withdrawal_effective_at: payload.withdrawal_effective_at,
    document_ref: payload.document_ref,
    provenance: payload.provenance,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function validateEvidencePayload(payload: InspectorEvidencePayload): void {
  if (payload.schema_version !== INSPECTOR_EVIDENCE_SCHEMA_VERSION) {
    throw new Error('UNSUPPORTED_SCHEMA_VERSION');
  }
  if (payload.vehicle_classes.length === 0 || payload.vehicle_classes.length > 32) {
    throw new Error('INVALID_VEHICLE_CLASSES');
  }
  for (const field of [
    payload.issuer,
    payload.source_person_ref,
    payload.station_ref,
    payload.assignment_ref,
    payload.document_ref,
    payload.provenance,
    payload.source_version,
  ]) {
    if (!field || field.length > 128) {
      throw new Error('INVALID_REFERENCE');
    }
  }
  for (const dateField of [
    payload.assignment_from,
    payload.assignment_until_exclusive,
    payload.training_completed_on,
    payload.next_training_due_on,
    payload.continuation_from,
    payload.continuation_until_exclusive,
    payload.effective_from,
    payload.effective_until_exclusive,
  ]) {
    if (dateField !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dateField)) {
      throw new Error('INVALID_DATE');
    }
  }
}

export function assertDigestFormat(digest: string): void {
  if (!SHA256_HEX.test(digest)) {
    throw new Error('INVALID_DIGEST');
  }
}

export function resolveEvidenceReviewState(
  revisions: StoredEvidenceRevision[],
): InspectorEvidenceReviewState {
  if (revisions.length === 0) {
    return 'UNREVIEWED';
  }

  const reviewed = revisions.filter(
    (row) => row.evidence_review === 'EVIDENCE_REVIEWED',
  );
  if (reviewed.length === 0) {
    return 'UNREVIEWED';
  }

  const bySource = new Map<string, Set<string>>();
  for (const row of reviewed) {
    const digests = bySource.get(row.source_version) ?? new Set<string>();
    digests.add(row.document_digest);
    bySource.set(row.source_version, digests);
  }
  for (const digests of bySource.values()) {
    if (digests.size > 1) {
      return 'SOURCE_CONFLICT';
    }
  }

  return 'EVIDENCE_REVIEWED';
}

export function pickAssessmentRevision(
  revisions: StoredEvidenceRevision[],
  stationRef: string,
): StoredEvidenceRevision | null {
  const stationScoped = revisions.filter((row) => row.station_ref === stationRef);
  if (stationScoped.length === 0) {
    return null;
  }
  const reviewed = stationScoped.find(
    (row) => row.evidence_review === 'EVIDENCE_REVIEWED',
  );
  return reviewed ?? stationScoped[0];
}

export function evaluateTemporalScope(
  revision: StoredEvidenceRevision,
  request: EvidenceAssessmentRequest,
): EvidenceTemporalScope {
  if (revision.station_ref !== request.station_ref) {
    return 'OUT_OF_SCOPE';
  }

  if (
    request.vehicle_class &&
    !revision.vehicle_classes.includes(request.vehicle_class)
  ) {
    return 'OUT_OF_SCOPE';
  }

  const at = request.inspection_time;
  if (revision.withdrawal_effective_at) {
    const revokedAt = new Date(revision.withdrawal_effective_at);
    if (at.getTime() >= revokedAt.getTime()) {
      return 'REVOKED';
    }
  }

  if (!revision.effective_from || !revision.effective_until_exclusive) {
    return 'UNKNOWN';
  }

  const effectiveFrom = parseViennaCalendarDate(revision.effective_from);
  const effectiveUntil = parseViennaCalendarDate(
    revision.effective_until_exclusive,
  );

  if (calendarDayUtc(at) < calendarDayUtc(effectiveFrom)) {
    return 'NOT_YET_VALID';
  }
  if (!isInstantInCalendarInterval(at, effectiveFrom, effectiveUntil)) {
    return 'EXPIRED';
  }

  if (revision.assignment_from && revision.assignment_until_exclusive) {
    const assignFrom = parseViennaCalendarDate(revision.assignment_from);
    const assignUntil = parseViennaCalendarDate(
      revision.assignment_until_exclusive,
    );
    if (!isInstantInCalendarInterval(at, assignFrom, assignUntil)) {
      return 'OUT_OF_SCOPE';
    }
  } else {
    return 'UNKNOWN';
  }

  if (
    revision.continuation_from &&
    revision.continuation_until_exclusive
  ) {
    const contFrom = parseViennaCalendarDate(revision.continuation_from);
    const contUntil = parseViennaCalendarDate(
      revision.continuation_until_exclusive,
    );
    if (at >= contFrom && at < contUntil) {
      return 'CONTINUATION';
    }
  }

  return 'CURRENT';
}

export function evaluateFreshness(
  revision: StoredEvidenceRevision,
  asOf: Date,
): EvidenceFreshness {
  if (!revision.review_valid_until) {
    return 'STALE';
  }
  return asOf.getTime() <= revision.review_valid_until.getTime()
    ? 'CURRENT'
    : 'STALE';
}

export function deriveQualificationSupportStatus(
  evidenceReview: InspectorEvidenceReviewState,
  temporalAtInspection: EvidenceTemporalScope,
  temporalAsOf: EvidenceTemporalScope,
  freshness: EvidenceFreshness,
): QualificationSupportStatus {
  if (evidenceReview !== 'EVIDENCE_REVIEWED') {
    return 'QUALIFICATION_UNKNOWN';
  }
  if (freshness === 'STALE') {
    return 'QUALIFICATION_UNKNOWN';
  }
  if (temporalAtInspection === 'EXPIRED' || temporalAsOf === 'EXPIRED') {
    return 'QUALIFICATION_EXPIRED';
  }
  if (
    temporalAtInspection === 'UNKNOWN' ||
    temporalAsOf === 'UNKNOWN' ||
    temporalAtInspection === 'REVOKED' ||
    temporalAsOf === 'REVOKED' ||
    temporalAtInspection === 'OUT_OF_SCOPE' ||
    temporalAsOf === 'OUT_OF_SCOPE'
  ) {
    return 'QUALIFICATION_UNKNOWN';
  }
  if (
    temporalAtInspection === 'CURRENT' ||
    temporalAtInspection === 'CONTINUATION'
  ) {
    return 'QUALIFICATION_CURRENT';
  }
  return 'QUALIFICATION_UNKNOWN';
}

export function assessEvidence(
  revisions: StoredEvidenceRevision[],
  request: EvidenceAssessmentRequest,
): EvidenceAssessmentResult {
  if (revisions.length === 0) {
    return {
      evidence_review: 'UNREVIEWED',
      inspection_time_temporal_scope: 'UNKNOWN',
      as_of_temporal_scope: 'UNKNOWN',
      freshness: 'STALE',
      qualification_support_status: 'QUALIFICATION_UNKNOWN',
      registry_adapter: 'NOT_CONFIGURED',
    };
  }

  const evidenceReview = resolveEvidenceReviewState(revisions);
  const revision = pickAssessmentRevision(revisions, request.station_ref);

  if (!revision) {
    return {
      evidence_review: evidenceReview,
      inspection_time_temporal_scope: 'OUT_OF_SCOPE',
      as_of_temporal_scope: 'OUT_OF_SCOPE',
      freshness: 'STALE',
      qualification_support_status: 'QUALIFICATION_UNKNOWN',
      registry_adapter: 'NOT_CONFIGURED',
    };
  }

  const inspectionTimeScope = evaluateTemporalScope(revision, {
    ...request,
    inspection_time: request.inspection_time,
  });
  const asOfScope = evaluateTemporalScope(revision, {
    ...request,
    inspection_time: request.as_of,
  });
  const freshness = evaluateFreshness(revision, request.as_of);

  let inspectionScope = inspectionTimeScope;
  let asOfTemporal = asOfScope;
  if (freshness === 'STALE' && inspectionScope !== 'EXPIRED') {
    inspectionScope = 'UNKNOWN';
  }
  if (freshness === 'STALE' && asOfTemporal !== 'EXPIRED') {
    asOfTemporal = 'UNKNOWN';
  }

  const qualificationSupportStatus = deriveQualificationSupportStatus(
    evidenceReview,
    inspectionScope,
    asOfTemporal,
    freshness,
  );

  return {
    evidence_review: evidenceReview,
    inspection_time_temporal_scope: inspectionScope,
    as_of_temporal_scope: asOfTemporal,
    freshness,
    qualification_support_status: qualificationSupportStatus,
    registry_adapter: 'NOT_CONFIGURED',
  };
}
