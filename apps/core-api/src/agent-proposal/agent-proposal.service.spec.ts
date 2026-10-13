import { BadRequestException, ConflictException } from '@nestjs/common';
import { AgentPolicyTier } from '@prisma/client';
import { AgentProposalService } from './agent-proposal.service.js';
import {
  createAgentProposalSpecHarness,
  createMockProposal,
  proposalId,
  traceId,
} from './agent-proposal.spec.support.js';
import { resolveLineItemFinancials } from './agent-proposal-financials.js';
import { resolveLineItemFinancials as resolveLineItemFacadeExport } from './agent-proposal.service.js';

describe('AgentProposalService', () => {
  let service: AgentProposalService;

  beforeEach(() => {
    ({ service } = createAgentProposalSpecHarness());
  });

  describe('batchApplyProposals', () => {
    it('returns independent outcomes when one proposal fails', async () => {
      jest.spyOn(service, 'approveProposal').mockImplementation(async (id) => {
        if (id === 'bad-id') throw new ConflictException('already claimed');
        return createMockProposal({ id }) as any;
      });

      const result = await service.batchApplyProposals({
        ids: ['good-id', 'bad-id'],
      });

      expect(result.results).toEqual([
        expect.objectContaining({ id: 'good-id', status: 'applied' }),
        expect.objectContaining({
          id: 'bad-id',
          status: 'failed',
          error: 'already claimed',
        }),
      ]);
      expect(service.approveProposal).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolveLineItemFinancials', () => {
    it('throws BadRequestException for negative unit_price', () => {
      expect(() =>
        service.resolveLineItemFinancials({ unit_price: -1 }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException for negative amount', () => {
      expect(() =>
        service.resolveLineItemFinancials({ amount_eur: -10 }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException for nonpositive quantity', () => {
      expect(() => service.resolveLineItemFinancials({ quantity: 0 })).toThrow(
        BadRequestException,
      );
      expect(() => service.resolveLineItemFinancials({ quantity: -3 })).toThrow(
        BadRequestException,
      );
    });

    it('correctly calculates total from unit_price and quantity', () => {
      const result = service.resolveLineItemFinancials({
        unit_price: 25,
        quantity: 4,
      });
      expect(result).toEqual({
        unitPrice: 25,
        totalAmount: 100,
        quantity: 4,
      });
    });

    it('correctly calculates unit_price from amount and quantity', () => {
      const result = service.resolveLineItemFinancials({
        amount_eur: 150,
        quantity: 3,
      });
      expect(result).toEqual({
        unitPrice: 50,
        totalAmount: 150,
        quantity: 3,
      });
    });

    it('reconciles matching unit_price and amount', () => {
      const result = service.resolveLineItemFinancials({
        unit_price: 20,
        amount_eur: 40,
        quantity: 2,
      });
      expect(result).toEqual({
        unitPrice: 20,
        totalAmount: 40,
        quantity: 2,
      });
    });

    it('defaults to 0 amount and 1 quantity when empty', () => {
      const result = service.resolveLineItemFinancials({});
      expect(result).toEqual({
        unitPrice: 0,
        totalAmount: 0,
        quantity: 1,
      });
    });
  });

  describe('delegation to collaborators', () => {
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
