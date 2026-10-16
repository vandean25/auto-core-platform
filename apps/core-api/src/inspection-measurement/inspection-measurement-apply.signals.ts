/** Thrown inside apply transaction; handled outside to persist conflict then return 409. */
export class InspectionMeasurementApplyConflictSignal extends Error {
  constructor(
    readonly params: {
      tenantId: string;
      siteId: string;
      importId: string;
      actorUserId: string;
      previousState: string;
      semanticDigest?: string;
      conflictingDigest?: string;
      reason: 'MEASUREMENT_CONFLICT' | 'REVIEW_REQUIRED';
    },
  ) {
    super('INSPECTION_MEASUREMENT_APPLY_CONFLICT');
  }
}
