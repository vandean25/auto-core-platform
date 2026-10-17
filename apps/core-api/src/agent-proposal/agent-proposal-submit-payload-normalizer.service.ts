import { Injectable } from '@nestjs/common';
import { InvoiceWorkshopDraftProposeService } from '../invoices/invoice-workshop-draft-propose.service.js';
import { WorkshopEstimateSendProposeService } from '../workshop/workshop-estimate-send-propose.service.js';
import { MechanicFindingProposeService } from '../mechanic/mechanic-finding-propose.service.js';
import { WorkshopBookingPackageService } from '../workshop/workshop-booking-package.service.js';
import { WorkshopOrderCompletionService } from '../workshop/workshop-order-completion.service.js';
import { normalizeAgentProposalSubmitPayload } from './agent-proposal-submit-payload-normalize.js';

@Injectable()
export class AgentProposalSubmitPayloadNormalizer {
  constructor(
    private readonly workshopBookingPackage: WorkshopBookingPackageService,
    private readonly workshopOrderCompletion: WorkshopOrderCompletionService,
    private readonly invoiceWorkshopDraftPropose: InvoiceWorkshopDraftProposeService,
    private readonly workshopEstimateSendPropose: WorkshopEstimateSendProposeService,
    private readonly mechanicFindingPropose: MechanicFindingProposeService,
  ) {}

  normalize(actionType: string, payload: unknown): Promise<unknown> {
    return normalizeAgentProposalSubmitPayload(
      {
        workshopBookingPackage: this.workshopBookingPackage,
        workshopOrderCompletion: this.workshopOrderCompletion,
        invoiceWorkshopDraftPropose: this.invoiceWorkshopDraftPropose,
        workshopEstimateSendPropose: this.workshopEstimateSendPropose,
        mechanicFindingPropose: this.mechanicFindingPropose,
      },
      actionType,
      payload,
    );
  }
}
