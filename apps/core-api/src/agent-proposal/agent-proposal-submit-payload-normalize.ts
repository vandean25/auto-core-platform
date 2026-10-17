import type { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import type { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import type { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import type { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import type { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import { enrichMechanicFindingSubmitPayload } from './agent-proposal-mechanic-finding-enrich.js';

export type AgentProposalSubmitPayloadNormalizeDeps = {
  workshopBookingPackage: WorkshopBookingPackageService;
  workshopOrderCompletion: WorkshopOrderCompletionService;
  invoiceWorkshopDraftPropose: InvoiceWorkshopDraftProposeService;
  workshopEstimateSendPropose: WorkshopEstimateSendProposeService;
  mechanicFindingPropose: MechanicFindingProposeService;
};

export async function normalizeAgentProposalSubmitPayload(
  deps: AgentProposalSubmitPayloadNormalizeDeps,
  actionType: string,
  payload: unknown,
): Promise<unknown> {
  if (actionType === 'workshop.booking_package') {
    return deps.workshopBookingPackage.enrichInput(payload);
  }
  if (actionType === 'workshop_order.complete') {
    return deps.workshopOrderCompletion.enrichInput(payload);
  }
  if (actionType === 'invoice.create_draft_from_workshop_order') {
    return deps.invoiceWorkshopDraftPropose.enrichInput(payload);
  }
  if (actionType === 'workshop_estimate.send') {
    return deps.workshopEstimateSendPropose.enrichInput(payload);
  }
  if (
    actionType === 'workshop_order.propose_mechanic_finding' ||
    actionType === 'workshop_order.mechanic_finding'
  ) {
    return enrichMechanicFindingSubmitPayload(
      deps.mechanicFindingPropose,
      payload,
    );
  }
  return payload;
}
