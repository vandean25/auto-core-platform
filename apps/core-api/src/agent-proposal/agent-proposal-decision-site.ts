import { UnprocessableEntityException } from '@nestjs/common';
import type { AgentProposal } from '@prisma/client';
import type { SiteContextService } from '../site/site-context.service.js';
import { readExecutionSiteId } from './agent-proposal-payload.js';
import { isSiteBoundPendingAction } from './site-bound-pending-actions.js';

/** Workshop-order creation only applies in the site where it was simulated. */
export async function assertSiteMatchesSimulation(
  siteContext: SiteContextService,
  proposal: AgentProposal,
): Promise<void> {
  if (!isSiteBoundPendingAction(proposal.action_type)) {
    return;
  }
  const intendedSiteId = readExecutionSiteId(proposal.preview_json);
  if (!intendedSiteId || (await siteContext.getSiteId()) !== intendedSiteId) {
    throw new UnprocessableEntityException(
      'Select the site where this action was simulated before applying it',
    );
  }
}
