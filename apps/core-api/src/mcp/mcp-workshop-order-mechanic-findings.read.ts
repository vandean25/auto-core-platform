import type { WorkshopIntakeService } from '../workshop/workshop-intake.service.js';
import type { WorkshopMechanicFindingService } from '../workshop/workshop-mechanic-finding.service.js';

export function readWorkshopOrderWithMechanicFindings<T extends object>(
  order: T,
  mechanicFindings: unknown[],
) {
  return {
    ...order,
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
