import {
  EstimateNotificationChannel,
  type EstimateCustomerReaction,
  type Prisma,
} from '@prisma/client';
import type { WorkshopEstimateOverrunWarning } from './workshop-estimate-overrun.helpers.js';

/** The persisted overrun state of one approved baseline. */
export type OverrunTrackingRow = {
  id: string;
  detected_at: Date;
  notified_at: Date | null;
  notified_channel: EstimateNotificationChannel | null;
  notified_amount_gross: Prisma.Decimal | null;
  customer_reaction: EstimateCustomerReaction | null;
  note: string | null;
};

/** The live warning joined with the tracked state. `requires_customer_notice` is true until the customer is told. */
export type WorkshopEstimateOverrunView = WorkshopEstimateOverrunWarning & {
  detected_at: string;
  notified_at: string | null;
  notified_channel: EstimateNotificationChannel | null;
  notified_amount_gross: string | null;
  customer_reaction: EstimateCustomerReaction | null;
  note: string | null;
  requires_customer_notice: boolean;
};

export function toOverrunView(
  warning: WorkshopEstimateOverrunWarning,
  row: OverrunTrackingRow,
): WorkshopEstimateOverrunView {
  return {
    ...warning,
    detected_at: row.detected_at.toISOString(),
    notified_at: row.notified_at?.toISOString() ?? null,
    notified_channel: row.notified_channel,
    notified_amount_gross: row.notified_amount_gross?.toFixed(2) ?? null,
    customer_reaction: row.customer_reaction,
    note: row.note,
    requires_customer_notice: row.notified_at === null,
  };
}
