import type { WorkshopIntakeService } from '../workshop/workshop-intake.service.js';
import type { WorkshopMechanicFindingService } from '../workshop/workshop-mechanic-finding.service.js';
import type { WorkshopLaborSummary } from '../workshop/workshop-labor-summary.helpers.js';
import { toMcpWorkshopLaborSummary } from './mcp-workshop-order-read.mapper.js';

export function readWorkshopOrderWithMechanicFindings<
  T extends { labor_summary: WorkshopLaborSummary },
>(order: T, mechanicFindings: unknown[]) {
  return {
    ...order,
    labor_summary: toMcpWorkshopLaborSummary(order.labor_summary),
    mechanic_findings: mechanicFindings,
  };
}

export async function loadMcpWorkshopOrderWithMechanicFindings(
  workshopOrderId: string,
  workshopIntake: WorkshopIntakeService,
  mechanicFindings: WorkshopMechanicFindingService,
) {
  const order = await workshopIntake.findOne(workshopOrderId);
  const findings = await mechanicFindings.listForOrder(workshopOrderId);
  return readWorkshopOrderWithMechanicFindings(order, findings.data);
}
