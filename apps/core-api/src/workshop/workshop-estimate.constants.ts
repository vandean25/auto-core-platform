import { WorkshopOrderStatus } from '@prisma/client';

/** Kostenvoranschlag (ADR-0025 §1; product values from AUT-360). */
export const WORKSHOP_ESTIMATE_TITLE = 'Kostenvoranschlag';
export const WORKSHOP_ESTIMATE_VALIDITY_DAYS = 14;
export const WORKSHOP_ESTIMATE_SNAPSHOT_SCHEMA_VERSION = 1;
/** Renderer label stored with the frozen branding (the invoice label does not apply to estimates). */
export const WORKSHOP_ESTIMATE_BRANDED_TEMPLATE_VERSION =
  'workshop-estimate-brand-v1' as const;

/**
 * Customer-facing send stays closed until the lawyer approves the legal copy
 * (AUT-360 D19; ADR-0025 §1). Read at request time, like the invoice branding
 * writer flag, so a deployment can open it without a code change.
 */
export const CUSTOMER_ESTIMATE_SEND_FLAG = 'CUSTOMER_ESTIMATE_SEND_ENABLED';

/** Orders that can still take a new estimate. COMPLETED and INVOICED are closed. */
export const WORKSHOP_ESTIMATE_OPEN_ORDER_STATUSES: readonly WorkshopOrderStatus[] =
  [WorkshopOrderStatus.INTAKE, WorkshopOrderStatus.IN_PROGRESS];

export function isCustomerEstimateSendEnabled(): boolean {
  return process.env[CUSTOMER_ESTIMATE_SEND_FLAG] === 'true';
}
