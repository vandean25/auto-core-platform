export class InspectionCatalogueActivateConflictSignal extends Error {
  constructor(
    readonly params: {
      tenantId: string;
      siteId: string;
      importId: string;
      actorUserId: string;
      manifestDigest?: string;
    },
  ) {
    super('INSPECTION_CATALOGUE_ACTIVATE_CONFLICT');
  }
}
