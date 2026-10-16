import type { DocumentSnapshotLocaleFields } from '../common/i18n/document-snapshot-locale.js';
import { buildDocumentSnapshotLocaleFields } from '../common/i18n/document-snapshot-locale.js';
import type { DisplayLanguage } from '../common/i18n/display-language.js';

export const WORKSHOP_CHECK_IN_EVIDENCE_SCHEMA_VERSION = 1;

/** Frozen customer-language bundle for completed tablet check-in evidence (AUT-576). */
export type WorkshopCheckInEvidenceSnapshot = {
  schema_version: typeof WORKSHOP_CHECK_IN_EVIDENCE_SCHEMA_VERSION;
  check_in_id: string;
  workshop_order_id: string;
  frozen_at: string;
} & DocumentSnapshotLocaleFields;

export function buildWorkshopCheckInEvidenceSnapshot(params: {
  checkInId: string;
  workshopOrderId: string;
  frozenAt: Date;
  documentLocale: DisplayLanguage;
}): WorkshopCheckInEvidenceSnapshot {
  return {
    schema_version: WORKSHOP_CHECK_IN_EVIDENCE_SCHEMA_VERSION,
    check_in_id: params.checkInId,
    workshop_order_id: params.workshopOrderId,
    frozen_at: params.frozenAt.toISOString(),
    ...buildDocumentSnapshotLocaleFields(params.documentLocale),
  };
}
