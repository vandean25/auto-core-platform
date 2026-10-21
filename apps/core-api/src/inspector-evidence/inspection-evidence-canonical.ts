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

export function parseAssessmentInstant(
  value: string | undefined,
  fallback: Date,
): Date {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('INVALID_ASSESSMENT_TIMESTAMP');
  }
  return parsed;
}

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
  if (Number.isNaN(day)) {
    return false;
  }
  return (
    day >= calendarDayUtc(fromInclusive) && day < calendarDayUtc(untilExclusive)
  );
}

export function clampReviewValidUntil(
  reviewedAt: Date,
  requestedValidUntil: Date,
): Date {
  const cap = new Date(reviewedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  return requestedValidUntil.getTime() > cap.getTime()
    ? cap
    : requestedValidUntil;
}

export function validateEvidencePayload(
  payload: InspectorEvidencePayload,
): void {
  if (payload.schema_version !== INSPECTOR_EVIDENCE_SCHEMA_VERSION) {
    throw new Error('UNSUPPORTED_SCHEMA_VERSION');
  }
  if (
    payload.vehicle_classes.length === 0 ||
    payload.vehicle_classes.length > 32
  ) {
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

export function isSupersededRevision(
  revisionId: string,
  revisions: StoredEvidenceRevision[],
): boolean {
  return revisions.some(
    (row) =>
      row.predecessor_revision_id === revisionId &&
      row.evidence_review === 'EVIDENCE_REVIEWED',
  );
}

export function resolveEvidenceReviewState(
  revisions: StoredEvidenceRevision[],
): InspectorEvidenceReviewState {
  if (revisions.length === 0) {
    return 'UNREVIEWED';
  }

  if (revisions.some((row) => row.evidence_review === 'SOURCE_CONFLICT')) {
    return 'SOURCE_CONFLICT';
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

export function hasAmbiguousPersonIdentity(
  revisions: StoredEvidenceRevision[],
): boolean {
  const refs = new Set<string>();
  for (const row of revisions) {
    if (
      row.evidence_review === 'EVIDENCE_REVIEWED' ||
      row.evidence_review === 'SOURCE_CONFLICT'
    ) {
      refs.add(row.source_person_ref);
    }
  }
  return refs.size > 1;
}

function trainingCoversInspection(
  revision: StoredEvidenceRevision,
  at: Date,
): boolean {
  if (!revision.training_completed_on || !revision.next_training_due_on) {
    return false;
  }
  const completed = parseViennaCalendarDate(revision.training_completed_on);
  const due = parseViennaCalendarDate(revision.next_training_due_on);
  const day = calendarDayUtc(at);
  if (Number.isNaN(day)) {
    return false;
  }
  return day >= calendarDayUtc(completed) && day < calendarDayUtc(due);
}

export function evaluateTemporalScope(
  revision: StoredEvidenceRevision,
  request: EvidenceAssessmentRequest,
  at: Date,
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

  if (revision.withdrawal_effective_at) {
    const revokedAt = new Date(revision.withdrawal_effective_at);
    if (
      !Number.isNaN(revokedAt.getTime()) &&
      at.getTime() >= revokedAt.getTime()
    ) {
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

  if (revision.continuation_from && revision.continuation_until_exclusive) {
    const contFrom = parseViennaCalendarDate(revision.continuation_from);
    const contUntil = parseViennaCalendarDate(
      revision.continuation_until_exclusive,
    );
    if (isInstantInCalendarInterval(at, contFrom, contUntil)) {
      if (!trainingCoversInspection(revision, at)) {
        return 'UNKNOWN';
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
      return 'CONTINUATION';
    }
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

  if (!trainingCoversInspection(revision, at)) {
    return 'UNKNOWN';
  }

  return 'CURRENT';
}

const SCOPE_PRECEDENCE: Record<EvidenceTemporalScope, number> = {
  REVOKED: 7,
  EXPIRED: 6,
  OUT_OF_SCOPE: 5,
  UNKNOWN: 4,
  NOT_YET_VALID: 3,
  CONTINUATION: 2,
  CURRENT: 1,
};

function mergeTemporalScopes(
  scopes: EvidenceTemporalScope[],
): EvidenceTemporalScope {
  if (scopes.length === 0) {
    return 'UNKNOWN';
  }
  return scopes.reduce((worst, scope) =>
    SCOPE_PRECEDENCE[scope] > SCOPE_PRECEDENCE[worst] ? scope : worst,
  );
}

function activeReviewedRevisions(
  revisions: StoredEvidenceRevision[],
  stationRef: string,
): StoredEvidenceRevision[] {
  return revisions
    .filter(
      (row) =>
        row.station_ref === stationRef &&
        row.evidence_review === 'EVIDENCE_REVIEWED' &&
        !isSupersededRevision(row.id, revisions),
    )
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

export function isRevisionApplicableForAssessment(
  revision: StoredEvidenceRevision,
  request: EvidenceAssessmentRequest,
): boolean {
  if (revision.station_ref !== request.station_ref) {
    return false;
  }
  if (
    request.vehicle_class &&
    !revision.vehicle_classes.includes(request.vehicle_class)
  ) {
    return false;
  }
  return true;
}

function aggregateApplicableScopes(
  scopes: EvidenceTemporalScope[],
): EvidenceTemporalScope {
  if (scopes.length === 0) {
    return 'UNKNOWN';
  }
  if (scopes.includes('REVOKED')) {
    return 'REVOKED';
  }

  const competing = scopes.filter(
    (scope) => scope !== 'OUT_OF_SCOPE' && scope !== 'NOT_YET_VALID',
  );
  if (competing.length > 0) {
    return mergeTemporalScopes(competing);
  }
  if (scopes.includes('NOT_YET_VALID')) {
    return 'NOT_YET_VALID';
  }
  if (scopes.includes('OUT_OF_SCOPE')) {
    return 'OUT_OF_SCOPE';
  }
  return 'UNKNOWN';
}

export function aggregateTemporalScope(
  revisions: StoredEvidenceRevision[],
  request: EvidenceAssessmentRequest,
  at: Date,
): EvidenceTemporalScope {
  const active = activeReviewedRevisions(revisions, request.station_ref);
  const applicable = active.filter((row) =>
    isRevisionApplicableForAssessment(row, request),
  );

  if (applicable.length === 0) {
    const anyAtStation = revisions.some(
      (row) => row.station_ref === request.station_ref,
    );
    if (!anyAtStation) {
      return 'OUT_OF_SCOPE';
    }
    if (
      request.vehicle_class &&
      active.some(
        (row) => !row.vehicle_classes.includes(request.vehicle_class!),
      ) &&
      !active.some((row) =>
        row.vehicle_classes.includes(request.vehicle_class!),
      )
    ) {
      return 'OUT_OF_SCOPE';
    }
    return 'UNKNOWN';
  }

  const scopes = applicable.map((row) =>
    evaluateTemporalScope(row, request, at),
  );
  return aggregateApplicableScopes(scopes);
}

export function pickFreshnessRevision(
  revisions: StoredEvidenceRevision[],
  request: EvidenceAssessmentRequest,
): StoredEvidenceRevision | null {
  const applicable = activeReviewedRevisions(
    revisions,
    request.station_ref,
  ).filter((row) => isRevisionApplicableForAssessment(row, request));
  return applicable[0] ?? null;
}

export function evaluateFreshness(
  revision: StoredEvidenceRevision | null,
  asOf: Date,
): EvidenceFreshness {
  if (!revision?.review_valid_until) {
    return 'STALE';
  }
  return asOf.getTime() < revision.review_valid_until.getTime()
    ? 'CURRENT'
    : 'STALE';
}

export function applyStaleReviewToScope(
  scope: EvidenceTemporalScope,
  freshness: EvidenceFreshness,
): EvidenceTemporalScope {
  if (freshness !== 'STALE') {
    return scope;
  }
  if (scope === 'EXPIRED' || scope === 'REVOKED') {
    return scope;
  }
  return 'UNKNOWN';
}

export function deriveQualificationSupportStatus(
  evidenceReview: InspectorEvidenceReviewState,
  temporalAtInspection: EvidenceTemporalScope,
  temporalAsOf: EvidenceTemporalScope,
  freshness: EvidenceFreshness,
  identityConflict: boolean,
): QualificationSupportStatus {
  if (identityConflict || evidenceReview === 'SOURCE_CONFLICT') {
    return 'QUALIFICATION_UNKNOWN';
  }
  if (evidenceReview !== 'EVIDENCE_REVIEWED') {
    return 'QUALIFICATION_UNKNOWN';
  }
  if (temporalAtInspection === 'EXPIRED' || temporalAsOf === 'EXPIRED') {
    return 'QUALIFICATION_EXPIRED';
  }
  if (freshness === 'STALE') {
    return 'QUALIFICATION_UNKNOWN';
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

  const identityConflict =
    request.identity_conflict === true || hasAmbiguousPersonIdentity(revisions);
  const evidenceReview = resolveEvidenceReviewState(revisions);

  const rawInspectionScope = aggregateTemporalScope(
    revisions,
    request,
    request.inspection_time,
  );
  const rawAsOfScope = aggregateTemporalScope(
    revisions,
    request,
    request.as_of,
  );

  const freshnessRevision = pickFreshnessRevision(revisions, request);
  const freshness = evaluateFreshness(freshnessRevision, request.as_of);

  const inspectionScope = applyStaleReviewToScope(
    rawInspectionScope,
    freshness,
  );
  const asOfTemporal = applyStaleReviewToScope(rawAsOfScope, freshness);

  const qualificationSupportStatus = deriveQualificationSupportStatus(
    evidenceReview,
    inspectionScope,
    asOfTemporal,
    freshness,
    identityConflict,
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
