import { InvoiceTaxMode } from '@prisma/client';
import { isInvoiceSnapshotV2 } from './invoice-snapshot-v2.validation.js';
import { resolveMarginSchemeLegalNote } from './margin-scheme-legal-notes.js';

export function resolveInvoiceMarginSchemeLegalNote(params: {
  tax_mode?: InvoiceTaxMode | null;
  snapshot: unknown;
  sellerCountryIso?: string | null;
}): string | undefined {
  if (params.tax_mode !== InvoiceTaxMode.MARGIN_SCHEME) {
    return undefined;
  }

  const snapshotCountry =
    isInvoiceSnapshotV2(params.snapshot) && params.snapshot.seller
      ? params.snapshot.seller.country_iso
      : undefined;
  const countryIso = snapshotCountry ?? params.sellerCountryIso ?? undefined;

  try {
    return resolveMarginSchemeLegalNote(countryIso);
  } catch {
    return undefined;
  }
}
