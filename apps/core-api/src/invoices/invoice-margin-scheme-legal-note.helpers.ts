import { InvoiceTaxMode } from '@prisma/client';
import { isInvoiceSnapshotV2 } from './invoice-snapshot-v2.validation.js';
import { resolveMarginSchemeLegalNote } from './margin-scheme-legal-notes.js';

export function resolveInvoiceMarginSchemeLegalNote(params: {
  tax_mode?: InvoiceTaxMode | null;
  snapshot: unknown;
}): string | undefined {
  if (params.tax_mode !== InvoiceTaxMode.MARGIN_SCHEME) {
    return undefined;
  }
  if (!isInvoiceSnapshotV2(params.snapshot) || !params.snapshot.seller) {
    return undefined;
  }
  try {
    return resolveMarginSchemeLegalNote(params.snapshot.seller.country_iso);
  } catch {
    return undefined;
  }
}
