import { AgentPolicyTier } from '@prisma/client';
import { resolveLineItemFinancials } from './agent-proposal-financials.js';
import { resolveLineItemFinancials as resolveLineItemFacadeExport } from './agent-proposal.service.js';
import {
  createAgentProposalSpecHarness,
  proposalId,
  traceId,
} from './agent-proposal.spec.support.js';

describe('AgentProposalService delegation', () => {
  describe('forwards to collaborators', () => {
    it('forwards read calls to the read collaborator', async () => {
      const harness = createAgentProposalSpecHarness();
      const query = { limit: 5 } as any;
      const listSpy = jest
        .spyOn(harness.reads, 'listProposals')
        .mockResolvedValue({ data: [] } as any);
      const detailSpy = jest
        .spyOn(harness.reads, 'getProposalById')
        .mockResolvedValue({ id: proposalId } as any);

      await expect(harness.service.listProposals(query)).resolves.toEqual({
        data: [],
      });
      await expect(
        harness.service.getProposalById(proposalId),
      ).resolves.toEqual({ id: proposalId });

      expect(listSpy).toHaveBeenCalledWith(query);
      expect(detailSpy).toHaveBeenCalledWith(proposalId);
    });

    it('forwards reject and approve to the decision collaborator', async () => {
      const harness = createAgentProposalSpecHarness();
      const rejectSpy = jest
        .spyOn(harness.decisions, 'rejectProposal')
        .mockResolvedValue({ id: proposalId } as any);
      const approveSpy = jest
        .spyOn(harness.decisions, 'approveProposal')
        .mockResolvedValue({ id: proposalId } as any);

      await harness.service.rejectProposal(proposalId, {
        reason: 'duplicate',
      });
      await harness.service.approveProposal(proposalId);

      expect(rejectSpy).toHaveBeenCalledWith(proposalId, {
        reason: 'duplicate',
      });
      expect(approveSpy).toHaveBeenCalledWith(proposalId);
    });

    it('forwards creation and submission to the submission collaborator', async () => {
      const harness = createAgentProposalSpecHarness();
      const dto = { action_type: 'customer.update', payload_json: {} } as any;
      const pending = {
        action_type: 'customer.update',
        payload_json: {},
        preview_json: {},
        tier: AgentPolicyTier.PROPOSE,
        trace_id: traceId,
      };
      const createSpy = jest
        .spyOn(harness.submissions, 'createProposal')
        .mockResolvedValue({ id: proposalId } as any);
      const persistSpy = jest
        .spyOn(harness.submissions, 'persistPendingAction')
        .mockResolvedValue({ id: proposalId } as any);
      const submitSpy = jest
        .spyOn(harness.submissions, 'submitPendingAction')
        .mockResolvedValue({ id: proposalId } as any);

      await harness.service.createProposal(dto);
      await harness.service.persistPendingAction(pending);
      await harness.service.submitPendingAction(dto);

      expect(createSpy).toHaveBeenCalledWith(dto);
      expect(persistSpy).toHaveBeenCalledWith(pending);
      expect(submitSpy).toHaveBeenCalledWith(dto);
    });

    it('keeps the line-item financials export on the module path', () => {
      expect(resolveLineItemFacadeExport).toBe(resolveLineItemFinancials);
    });
  });
});
