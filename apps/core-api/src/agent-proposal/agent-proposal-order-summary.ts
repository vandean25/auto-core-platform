import { CustomerType } from '@prisma/client';
import type { AgentProposalWorkshopOrderSummaryDto } from './dto/agent-proposal.dto.js';

export interface WorkshopOrderCustomerNameSource {
  type: CustomerType;
  company_name: string | null;
  first_name: string;
  last_name: string;
}

/** Shape of a workshop order row as selected for proposal read context. */
export interface WorkshopOrderSummarySource {
  id: string;
  order_number: string;
  customer: WorkshopOrderCustomerNameSource | null;
  vehicle: {
    plate: string | null;
    year: number;
    make: string;
    model: string;
  };
}

export function toWorkshopOrderSummary(
  order: WorkshopOrderSummarySource,
): AgentProposalWorkshopOrderSummaryDto {
  const vehicleDescription = [
    String(order.vehicle.year),
    order.vehicle.make,
    order.vehicle.model,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  return {
    id: order.id,
    order_number: order.order_number.trim() || null,
    customer_name: formatCustomerName(order.customer),
    vehicle_registration: order.vehicle.plate?.trim() || null,
    vehicle_description: vehicleDescription || null,
  };
}

export function formatCustomerName(
  customer: WorkshopOrderCustomerNameSource | null,
): string | null {
  if (!customer) {
    return null;
  }
  const companyName = customer.company_name?.trim();
  if (customer.type === CustomerType.COMPANY && companyName) {
    return companyName;
  }
  return `${customer.first_name} ${customer.last_name}`.trim() || null;
}
