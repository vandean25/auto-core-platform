import type { DocumentSnapshotLocaleFields } from '../common/i18n/document-snapshot-locale.js';
import { buildDocumentSnapshotLocaleFields } from '../common/i18n/document-snapshot-locale.js';
import type { DisplayLanguage } from '../common/i18n/display-language.js';

export const WORKSHOP_ORDER_PDF_RENDER_INPUT_SCHEMA_VERSION = 1;

export type WorkshopOrderPdfRenderInput = {
  schema_version: typeof WORKSHOP_ORDER_PDF_RENDER_INPUT_SCHEMA_VERSION;
  workshop_order_id: string;
  order_number: string;
  frozen_at: string;
} & DocumentSnapshotLocaleFields;

export function buildWorkshopOrderPdfRenderInput(params: {
  workshopOrderId: string;
  orderNumber: string;
  frozenAt: Date;
  documentLocale: DisplayLanguage;
}): WorkshopOrderPdfRenderInput {
  return {
    schema_version: WORKSHOP_ORDER_PDF_RENDER_INPUT_SCHEMA_VERSION,
    workshop_order_id: params.workshopOrderId,
    order_number: params.orderNumber,
    frozen_at: params.frozenAt.toISOString(),
    ...buildDocumentSnapshotLocaleFields(params.documentLocale),
  };
}
