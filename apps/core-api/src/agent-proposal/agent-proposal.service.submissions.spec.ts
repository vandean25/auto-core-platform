import { UnprocessableEntityException } from '@nestjs/common';
import { AgentPolicyTier, AgentProposalStatus, Prisma } from '@prisma/client';
import { AgentProposalService } from './agent-proposal.service.js';
import { createAgentProposalSpecHarness, createMockProposal, proposalId, tenantId } from './agent-proposal.spec.support.js';

describe('AgentProposalService submissions', () => {
  let service: AgentProposalService;
  let mockPrisma: any;
  let mockAgentPolicyService: any;
  let mockDryRun: any;

  beforeEach(() => {
    ({ service, mockPrisma, mockAgentPolicyService, mockDryRun } = createAgentProposalSpecHarness());
  });

  describe('submitPendingAction', () => {
    it('simulates and persists a PROPOSE action without accepting client policy metadata', async () => {
      const payload = {
        order_id: 'wo-1',
        amount_eur: 50,
        description: 'Fabricated brake inspection',
      };
      mockDryRun.executeInRollbackTransaction.mockResolvedValue({
        result: { entityId: 'line-preview' },
        wouldChange: [{ type: 'create', entity: 'WorkshopTaskLineItem' }],
      });
      mockPrisma.agentProposal.create.mockResolvedValue(createMockProposal({
        payload_json: payload,
        preview_json: { result: { entityId: 'line-preview' }, would_change: [] },
      }));

      await service.submitPendingAction({
        action_type: 'workshop_order.add_line',
        payload_json: payload,
      });

      expect(mockAgentPolicyService.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({ action_type: 'workshop_order.add_line' }),
        { skipAdminCheck: true },
      );
      expect(mockDryRun.executeInRollbackTransaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.agentProposal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: tenantId,
          action_type: 'workshop_order.add_line',
          payload_json: payload,
          tier: AgentPolicyTier.PROPOSE,
          status: AgentProposalStatus.PENDING,
          trace_id: expect.any(String),
          preview_json: expect.objectContaining({ provisional: true }),
        }),
      });
    });

    it('does not persist actions that current policy marks HUMAN_ONLY', async () => {
      mockAgentPolicyService.evaluate.mockResolvedValue({
        tier: AgentPolicyTier.HUMAN_ONLY,
        reasons: ['human_only'],
      });

      await expect(service.submitPendingAction({
        action_type: 'workshop_order.add_line',
        payload_json: { order_id: 'wo-1' },
      })).rejects.toThrow(UnprocessableEntityException);

      expect(mockDryRun.executeInRollbackTransaction).not.toHaveBeenCalled();
      expect(mockPrisma.agentProposal.create).not.toHaveBeenCalled();
    });

    it('stores the server-resolved site for workshop-order creation', async () => {
      mockDryRun.executeInRollbackTransaction.mockResolvedValue({
        result: { id: 'order-preview', site_id: 'site-1' },
        wouldChange: [{ type: 'create', entity: 'WorkshopOrder' }],
      });
      mockPrisma.agentProposal.create.mockResolvedValue(
        createMockProposal({
          action_type: 'workshop_order.create',
          preview_json: {
            execution_context: { site_id: 'site-1' },
          },
        }),
      );

      await service.submitPendingAction({
        action_type: 'workshop_order.create',
        payload_json: {
          vehicle_id: '00000000-0000-4000-8000-000000000002',
          status: 'SCHEDULED',
        },
      });

      expect(mockPrisma.agentProposal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          preview_json: expect.objectContaining({
            execution_context: { site_id: 'site-1' },
          }),
        }),
      });
    });
  });

  describe('createProposal', () => {
    it('creates a new proposal in PENDING status', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.create.mockResolvedValue(proposal);

      const result = await service.createProposal({
        action_type: 'workshop_order.add_line',
        payload_json: { amount_eur: 50 },
      });

      expect(mockPrisma.agentProposal.create).toHaveBeenCalledWith({
        data: {
          tenant_id: tenantId,
          trace_id: expect.any(String),
          action_type: 'workshop_order.add_line',
          payload_json: { amount_eur: 50 },
          preview_json: Prisma.JsonNull,
          tier: AgentPolicyTier.PROPOSE,
          status: AgentProposalStatus.PENDING,
        },
      });

      expect(result.id).toBe(proposalId);
    });
  });
});
