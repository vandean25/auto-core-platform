import { WorkshopEstimateStatus } from '@prisma/client';

export type EstimateVersionFixture = {
  id: string;
  version: number;
  status: WorkshopEstimateStatus;
  sent_at: Date | null;
  valid_until: Date | null;
  total_net: null;
  total_gross: null;
  approvals: [];
  estimate: {
    estimate_number: string;
    workshop_order_id: string;
    site_id: string;
    workshop_order: {
      customer_id: string | null;
      order_number: string;
    };
  };
};

export function compareEstimateVersionsDesc(
  left: EstimateVersionFixture,
  right: EstimateVersionFixture,
) {
  if (left.sent_at === null && right.sent_at !== null) {
    return 1;
  }
  if (right.sent_at === null && left.sent_at !== null) {
    return -1;
  }
  const leftMs = left.sent_at?.getTime() ?? 0;
  const rightMs = right.sent_at?.getTime() ?? 0;
  if (leftMs !== rightMs) {
    return rightMs - leftMs;
  }
  return left.id.localeCompare(right.id);
}
