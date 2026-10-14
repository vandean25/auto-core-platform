import {
  EstimateNotificationChannel,
  type EstimateCustomerReaction,
  Prisma,
} from '@prisma/client';
import type { WorkshopEstimateOverrunWarning } from './workshop-estimate-overrun.helpers.js';

/** The persisted overrun state of one approved baseline. */
export type OverrunTrackingRow = {
  id: string;
  detected_at: Date;
  approved_total_gross: Prisma.Decimal;
  detected_total_gross: Prisma.Decimal;
  notified_at: Date | null;
  notified_channel: EstimateNotificationChannel | null;
  notified_amount_gross: Prisma.Decimal | null;
  customer_reaction: EstimateCustomerReaction | null;
  note: string | null;
};

/**
 * The live warning joined with the tracked state. `requires_customer_notice` is true until the customer has been told
 * the current total: no notice yet, or the total has moved since the last notice.
 */
export type WorkshopEstimateOverrunView = WorkshopEstimateOverrunWarning & {
  detected_at: string;
  notified_at: string | null;
  notified_channel: EstimateNotificationChannel | null;
  notified_amount_gross: string | null;
  customer_reaction: EstimateCustomerReaction | null;
  note: string | null;
  requires_customer_notice: boolean;
};

/** Whether the customer still has to be told the current total. */
export function needsCustomerNotice(
  currentTotalGross: string,
  row: Pick<OverrunTrackingRow, 'notified_at' | 'notified_amount_gross'>,
): boolean {
  if (row.notified_at === null || row.notified_amount_gross === null) {
    return true;
  }
  return !new Prisma.Decimal(currentTotalGross).equals(
    row.notified_amount_gross,
  );
}

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
    requires_customer_notice: needsCustomerNotice(
      warning.current_total_gross,
      row,
    ),
  };
}
