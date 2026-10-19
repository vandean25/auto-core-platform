import type { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import type { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import type { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import type { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import type { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import type { McpWriteExecution } from './mcp-write-pipeline.types.js';

export type McpWriteEnrichInputDeps = {
  workshopBookingPackage: WorkshopBookingPackageService;
  workshopOrderCompletion: WorkshopOrderCompletionService;
  invoiceWorkshopDraftPropose: InvoiceWorkshopDraftProposeService;
  workshopEstimateSendPropose: WorkshopEstimateSendProposeService;
  mechanicFindingPropose: MechanicFindingProposeService;
};

export async function enrichMcpWriteInput(
  deps: McpWriteEnrichInputDeps,
  execution: McpWriteExecution,
  input: unknown,
): Promise<unknown> {
  switch (execution.toolName) {
    case 'propose_workshop_booking':
      return deps.workshopBookingPackage.enrichInput(input);
    case 'propose_workshop_order_completion':
      return deps.workshopOrderCompletion.enrichInput(input);
    case 'propose_invoice_draft_from_order':
      return deps.invoiceWorkshopDraftPropose.enrichInput(input);
    case 'propose_estimate_send':
      return deps.workshopEstimateSendPropose.enrichInput(input);
    case 'propose_mechanic_finding':
      return deps.mechanicFindingPropose.enrichInput(input);
    default:
      return input;
  }
}
