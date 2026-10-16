/** Thrown inside apply transaction; handled outside to persist CONFLICT then return 409. */
export class InspectionImportApplyConflictSignal extends Error {
  constructor(
    readonly params: {
      tenantId: string;
      siteId: string;
      importId: string;
      actorUserId: string;
      previousState: string;
      semanticDigest?: string;
      conflictingDigest?: string;
    },
  ) {
    super('INSPECTION_IMPORT_APPLY_CONFLICT');
  }
}
