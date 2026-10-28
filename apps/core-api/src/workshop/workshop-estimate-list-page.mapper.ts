import type { SiteEstimateVersionListRow } from './workshop-estimate-version-site-list.read.js';
import type { WorkshopEstimateListRowDto } from './dto/workshop-estimate-list-page.dto.js';

function customerName(
  customer: SiteEstimateVersionListRow['estimate']['workshop_order']['customer'],
): string | null {
  if (!customer) {
    return null;
  }
  const company = customer.company_name?.trim();
  if (company) {
    return company;
  }
  const person = [customer.first_name, customer.last_name]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  return person || null;
}

/** One row of the estimates list page, from the same read model the MCP tool `list_estimates` maps from. */
export function toEstimateListRowDto(
  row: SiteEstimateVersionListRow,
): WorkshopEstimateListRowDto {
  const order = row.estimate.workshop_order;
  return {
    version_id: row.id,
    estimate_number: row.estimate.estimate_number,
    version: row.version,
    status: row.status,
    order_id: row.estimate.workshop_order_id,
    order_number: order.order_number,
    customer_id: order.customer_id,
    customer_name: customerName(order.customer),
    vehicle_plate: order.vehicle.plate,
    sent_at: row.sent_at ? row.sent_at.toISOString() : null,
    valid_until: row.valid_until ? row.valid_until.toISOString() : null,
    decided_at: row.decided_at ? row.decided_at.toISOString() : null,
    total_gross: row.total_gross ? row.total_gross.toFixed(2) : null,
  };
}
