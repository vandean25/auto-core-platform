export const INSPECTION_CATALOG_SCHEMA_VERSION = 'acp-inspection-catalog/1';

export type InspectionCatalogueSourceKind =
  'STATUTORY_REFERENCE' | 'APPROVED_CATALOGUE' | 'TEST_ONLY';

export type InspectionCatalogueCoverage = 'SUBSET' | 'COMPLETE';

export type CatalogueManifestPosition = {
  position_id: string;
  entry_id: string | null;
  label: string;
  allowed_groups: string[];
  vehicle_scope: string;
};

export type CatalogueManifest = {
  schema_version: typeof INSPECTION_CATALOG_SCHEMA_VERSION;
  source_kind: InspectionCatalogueSourceKind;
  publisher: string;
  source_uri: string;
  source_document_id: string;
  source_version: string;
  valid_from: string;
  valid_to: string | null;
  retrieved_at: string;
  verified_current_at: string;
  recheck_after: string;
  coverage: InspectionCatalogueCoverage;
  rights: string;
  approval_evidence_ref: string | null;
  positions: CatalogueManifestPosition[];
};

export type CatalogueReferenceRequest = {
  position_id: string;
  entry_id?: string | null;
};

export type CatalogueResolutionStatus =
  | 'RESOLVED'
  | 'UNKNOWN_CODE'
  | 'STALE_CATALOG'
  | 'OUT_OF_SCOPE'
  | 'NOT_CONFIGURED'
  | 'SOURCE_CONFLICT';
