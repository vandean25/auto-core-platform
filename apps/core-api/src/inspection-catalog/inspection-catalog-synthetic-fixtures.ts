import type { CatalogueManifest } from './inspection-catalog.types.js';

export const STATUTORY_MANIFEST_REFERENCE = 'ACP-RIS-Anl6-258-2022-subset';
export const TEST_ONLY_MANIFEST_REFERENCE = 'TEST_ONLY_CATALOGUE';
export const APPROVED_CATALOGUE_MANIFEST_REFERENCE = 'APPROVED_CATALOGUE';

export const SYNTHETIC_STATUTORY_MANIFEST: CatalogueManifest = {
  schema_version: 'acp-inspection-catalog/1',
  source_kind: 'STATUTORY_REFERENCE',
  publisher: 'RIS statutory text',
  source_uri:
    'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10012794',
  source_document_id: 'PBStV Anlage 6 / BGBl II 258/2022',
  source_version: STATUTORY_MANIFEST_REFERENCE,
  valid_from: '2023-02-02',
  valid_to: null,
  retrieved_at: '2026-10-16T10:00:00.000Z',
  verified_current_at: '2026-10-16T10:00:00.000Z',
  recheck_after: '2026-11-15T10:00:00.000Z',
  coverage: 'SUBSET',
  rights: 'PUBLIC_STATUTORY_REFERENCE_ONLY',
  approval_evidence_ref: null,
  positions: [
    {
      position_id: '0.1',
      entry_id: null,
      label: 'Kennzeichen(tafeln) (falls vorgeschrieben)',
      allowed_groups: [],
      vehicle_scope: 'REQUIRES_SOURCE_REVIEW',
    },
  ],
};

export const SYNTHETIC_TEST_ONLY_MANIFEST: CatalogueManifest = {
  ...SYNTHETIC_STATUTORY_MANIFEST,
  source_kind: 'TEST_ONLY',
  source_version: 'SYNTH-TEST-ONLY-1',
  positions: [
    {
      position_id: 'SYNTH-0.1',
      entry_id: null,
      label: 'SYNTH Testposition',
      allowed_groups: [],
      vehicle_scope: 'M1',
    },
  ],
};

const manifestByReference = new Map<string, CatalogueManifest>([
  [STATUTORY_MANIFEST_REFERENCE, SYNTHETIC_STATUTORY_MANIFEST],
  [TEST_ONLY_MANIFEST_REFERENCE, SYNTHETIC_TEST_ONLY_MANIFEST],
]);

export function resolveBuiltinManifestReference(
  manifestReference: string,
): CatalogueManifest | 'NOT_CONFIGURED' {
  if (manifestReference === APPROVED_CATALOGUE_MANIFEST_REFERENCE) {
    return 'NOT_CONFIGURED';
  }
  return manifestByReference.get(manifestReference) ?? 'NOT_CONFIGURED';
}
