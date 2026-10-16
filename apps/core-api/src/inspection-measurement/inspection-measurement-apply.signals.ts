/** Thrown inside apply transaction; handled outside to persist conflict then return 409. */
/** Thrown when identity insert races; reconcile outside the aborted transaction. */
export class InspectionMeasurementIdentityRaceSignal extends Error {
  constructor(
    readonly params: {
      tenantId: string;
      siteId: string;
      importId: string;
      actorUserId: string;
      orderId: string;
      vehicleId: string;
      deviceSourceId: string;
      identityKey: {
        tenant_id: string;
        source_system: 'WORKSHOP_NET';
        source_instance_id: string;
        measurement_id: string;
      };
      semanticDigest: string;
      importVersion: number;
    },
  ) {
    super('INSPECTION_MEASUREMENT_IDENTITY_RACE');
  }
}

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
