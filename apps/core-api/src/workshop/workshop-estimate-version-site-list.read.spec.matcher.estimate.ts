import type { Prisma } from '@prisma/client';
import type { EstimateVersionFixture } from './workshop-estimate-version-site-list.read.spec.fixtures.js';

export function matchEstimateVersionEstimateScope(
  row: EstimateVersionFixture,
  estimate: Prisma.WorkshopEstimateWhereInput,
): boolean {
  if (estimate.site_id && row.estimate.site_id !== estimate.site_id) {
    return false;
  }
  if (
    estimate.workshop_order_id &&
    row.estimate.workshop_order_id !== estimate.workshop_order_id
  ) {
    return false;
  }
  const customerId = estimate.workshop_order?.customer_id;
  if (
    typeof customerId === 'string' &&
    row.estimate.workshop_order.customer_id !== customerId
  ) {
    return false;
  }
  return true;
}
