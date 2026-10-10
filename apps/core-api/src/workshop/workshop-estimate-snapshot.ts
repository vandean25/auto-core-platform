import type { CustomerType } from '@prisma/client';
import { hashCanonicalJson } from '../invoices/invoice-snapshot-hash.js';
import type {
  InvoiceCustomerSnapshot,
  InvoiceSellerSnapshot,
} from '../invoices/invoice-snapshot-v2.helpers.js';
import {
  buildCustomerSnapshot,
  buildSellerSnapshot,
} from '../invoices/invoice-snapshot-v2.helpers.js';
import type {
  InvoiceSnapshotV2Branding,
  InvoiceSnapshotV2TaxBucket,
} from '../invoices/invoice-snapshot-v2.js';
import {
  WORKSHOP_ESTIMATE_BRANDED_TEMPLATE_VERSION,
  WORKSHOP_ESTIMATE_TITLE,
  WORKSHOP_ESTIMATE_SNAPSHOT_SCHEMA_VERSION,
  WORKSHOP_ESTIMATE_VALIDITY_DAYS,
} from './workshop-estimate.constants.js';
import {
  buildWorkshopEstimateLegalBlock,
  type WorkshopEstimateLegalBlock,
} from './workshop-estimate-legal-text.js';
import type { WorkshopEstimateLine } from './workshop-estimate-lines.helpers.js';

/**
 * Immutable record of what the customer was offered (ADR-0025 §4). Built once
 * at send and stored with its SHA-256. Later order edits never change it.
 */
export type WorkshopEstimateSnapshot = {
  schema_version: number;
  document: {
    kind: 'WORKSHOP_ESTIMATE';
    title: string;
    estimate_number: string;
    version: number;
    issued_at: string;
    valid_from: string;
    valid_until: string;
    validity_days: number;
    non_binding: true;
    free_of_charge: boolean;
    price_display: 'GROSS' | 'NET_WITH_VAT';
  };
  seller: InvoiceSellerSnapshot;
  customer: InvoiceCustomerSnapshot;
  vehicle: {
    make: string;
    model: string;
    vin: string | null;
    plate: string | null;
    year: number | null;
  };
  order: {
    order_number: string;
    odometer: number;
  };
  lines: WorkshopEstimateLine[];
  totals: {
    total_net: string;
    total_tax: string;
    total_gross: string;
    tax_breakdown: InvoiceSnapshotV2TaxBucket[];
  };
  branding: WorkshopEstimateBranding;
  legal: WorkshopEstimateLegalBlock;
};

/** Frozen ADR-0024 branding, labelled with the estimate renderer version. */
export type WorkshopEstimateBranding = Omit<
  InvoiceSnapshotV2Branding,
  'renderer_version'
> & {
  renderer_version: typeof WORKSHOP_ESTIMATE_BRANDED_TEMPLATE_VERSION;
};

export function toWorkshopEstimateBranding(
  branding: InvoiceSnapshotV2Branding,
): WorkshopEstimateBranding {
  return {
    ...branding,
    renderer_version: WORKSHOP_ESTIMATE_BRANDED_TEMPLATE_VERSION,
  };
}

export type BuildWorkshopEstimateSnapshotInput = {
  estimateNumber: string;
  version: number;
  issuedAt: Date;
  validFrom: Date;
  validUntil: Date;
  freeOfCharge: boolean;
  seller: Parameters<typeof buildSellerSnapshot>[0];
  customer: Parameters<typeof buildCustomerSnapshot>[0] & {
    type: CustomerType;
  };
  vehicle: WorkshopEstimateSnapshot['vehicle'];
  order: WorkshopEstimateSnapshot['order'];
  lines: WorkshopEstimateLine[];
  totals: WorkshopEstimateSnapshot['totals'];
  branding: InvoiceSnapshotV2Branding;
};

/** Business-time date for the document ("24.10.2026"). */
export function formatWorkshopEstimateDate(instant: Date): string {
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: 'Europe/Vienna',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instant);
}

/**
 * The exact expiry instant as printed ("24.10.2026, 10:00"). The stored
 * valid_until is the send minute plus 14 x 24 hours, so the printed cut-off must
 * carry the time too; a date alone would promise the whole day.
 */
export function formatWorkshopEstimateValidUntil(instant: Date): string {
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: 'Europe/Vienna',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

/**
 * Validity starts at the send minute and ends exactly 14 x 24 hours later. Both
 * instants are floored to whole minutes, so the stored expiry is the same instant
 * the customer sees printed, with no seconds left over.
 */
export function buildWorkshopEstimateValidityWindow(issuedAt: Date): {
  validFrom: Date;
  validUntil: Date;
} {
  const validFrom = new Date(issuedAt.getTime());
  validFrom.setUTCSeconds(0, 0);
  const validUntil = new Date(
    validFrom.getTime() + WORKSHOP_ESTIMATE_VALIDITY_DAYS * 24 * 60 * 60 * 1000,
  );
  return { validFrom, validUntil };
}

export function buildWorkshopEstimateSnapshot(
  input: BuildWorkshopEstimateSnapshotInput,
): WorkshopEstimateSnapshot {
  return {
    schema_version: WORKSHOP_ESTIMATE_SNAPSHOT_SCHEMA_VERSION,
    document: {
      kind: 'WORKSHOP_ESTIMATE',
      title: WORKSHOP_ESTIMATE_TITLE,
      estimate_number: input.estimateNumber,
      version: input.version,
      issued_at: input.issuedAt.toISOString(),
      valid_from: input.validFrom.toISOString(),
      valid_until: input.validUntil.toISOString(),
      validity_days: WORKSHOP_ESTIMATE_VALIDITY_DAYS,
      non_binding: true,
      free_of_charge: input.freeOfCharge,
      price_display:
        input.customer.type === 'PRIVATE' ? 'GROSS' : 'NET_WITH_VAT',
    },
    seller: buildSellerSnapshot(input.seller),
    customer: buildCustomerSnapshot(input.customer),
    vehicle: input.vehicle,
    order: input.order,
    lines: input.lines,
    totals: input.totals,
    branding: toWorkshopEstimateBranding(input.branding),
    legal: buildWorkshopEstimateLegalBlock({
      freeOfCharge: input.freeOfCharge,
      validUntilLabel: formatWorkshopEstimateValidUntil(input.validUntil),
    }),
  };
}

/** SHA-256 over the canonical JSON of the whole stored snapshot. */
export function hashWorkshopEstimateSnapshot(
  snapshot: WorkshopEstimateSnapshot,
): string {
  return hashCanonicalJson(snapshot);
}
