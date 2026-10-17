import type { DocumentSnapshotLocaleFields } from '../common/i18n/document-snapshot-locale.js';
import { buildDocumentSnapshotLocaleFields } from '../common/i18n/document-snapshot-locale.js';
import type { DisplayLanguage } from '../common/i18n/display-language.js';

export const WORKSHOP_ORDER_PDF_RENDER_INPUT_SCHEMA_VERSION = 2;

export type WorkshopOrderPdfRenderInput = {
  schema_version: typeof WORKSHOP_ORDER_PDF_RENDER_INPUT_SCHEMA_VERSION;
  workshop_order_id: string;
  order_number: string;
  frozen_at: string;
  check_in_content_sha256: string | null;
} & DocumentSnapshotLocaleFields;

export function buildWorkshopOrderPdfRenderInput(params: {
  workshopOrderId: string;
  orderNumber: string;
  frozenAt: Date;
  documentLocale: DisplayLanguage;
  checkInContentSha256: string | null;
}): WorkshopOrderPdfRenderInput {
  return {
    schema_version: WORKSHOP_ORDER_PDF_RENDER_INPUT_SCHEMA_VERSION,
    workshop_order_id: params.workshopOrderId,
    order_number: params.orderNumber,
    frozen_at: params.frozenAt.toISOString(),
    check_in_content_sha256: params.checkInContentSha256,
    ...buildDocumentSnapshotLocaleFields(params.documentLocale),
  };
}

export function readStoredCheckInContentSha256(
  renderInput: unknown,
): string | null {
  if (!renderInput || typeof renderInput !== 'object') {
    return null;
  }
  const value = (renderInput as { check_in_content_sha256?: unknown })
    .check_in_content_sha256;
  return typeof value === 'string' ? value : null;
}
