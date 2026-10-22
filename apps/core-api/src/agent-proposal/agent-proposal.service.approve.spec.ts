import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { AgentPolicyTier, AgentProposalStatus } from '@prisma/client';
import { AgentProposalService } from './agent-proposal.service.js';
import { createAgentProposalSpecHarness, createMockProposal, proposalId, tenantId, traceId, userId } from './agent-proposal.spec.support.js';

describe('AgentProposalService approve', () => {
  let service: AgentProposalService;
  let mockPrisma: any;
  let mockAgentPolicyService: any;
  let mockAgentActionLog: any;
  let mockSiteContext: any;
  let mockWorkshopIntake: any;
  let mockWorkshopBookingPackage: any;

  beforeEach(() => {
    ({
      service,
      mockPrisma,
      mockAgentPolicyService,
      mockAgentActionLog,
      mockSiteContext,
      mockWorkshopIntake,
      mockWorkshopBookingPackage,
    } = createAgentProposalSpecHarness());
  });

  describe('approveProposal: policy gates and claim', () => {
    it('refuses workshop-order apply when the active site differs from the simulation site', async () => {
      mockSiteContext.getSiteId.mockResolvedValue('site-2');
      mockPrisma.agentProposal.findFirst.mockResolvedValue(
        createMockProposal({
          action_type: 'workshop_order.create',
          preview_json: {
            execution_context: { site_id: 'site-1' },
          },
        }),
      );

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Select the site where this action was simulated before applying it',
      );
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
      expect(mockWorkshopIntake.create).not.toHaveBeenCalled();
    });

    it('refuses workshop booking package apply when the active site differs from the simulation site', async () => {
      mockSiteContext.getSiteId.mockResolvedValue('site-2');
      mockPrisma.agentProposal.findFirst.mockResolvedValue(
        createMockProposal({
          action_type: 'workshop.booking_package',
          preview_json: {
            execution_context: { site_id: 'site-1' },
          },
        }),
      );

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Select the site where this action was simulated before applying it',
      );
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
    });

    it('re-evaluates policy, atomically locks, executes payload, logs action, and marks EXECUTED', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce({
          ...proposal,
          status: AgentProposalStatus.EXECUTED,
          decided_by: userId,
          decided_at: new Date(),
        });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.approveProposal(proposalId);

      expect(mockAgentPolicyService.evaluate).toHaveBeenCalledWith(
        {
          action_type: 'workshop_order.add_line',
          context: { amount_eur: 50 },
        },
        { skipAdminCheck: true },
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
          expires_at: { gt: expect.any(Date) },
        },
        data: {
          status: AgentProposalStatus.APPROVED,
          decided_by: userId,
          decided_at: expect.any(Date),
        },
      });

      expect(mockAgentActionLog.recordInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId,
          actorType: 'USER',
          agentId: 'workshop-agent',
          onBehalfOfUserId: userId,
          actionType: 'workshop_order.add_line',
          status: 'EXECUTED',
        }),
        mockPrisma,
        expect.any(Function),
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.APPROVED,
        },
        data: { status: AgentProposalStatus.EXECUTED },
      });

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
    });

    it('records the originating agent on approval decisions', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce({
          ...proposal,
          status: AgentProposalStatus.EXECUTED,
        });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await service.approveProposal(proposalId);

      expect(mockAgentActionLog.recordInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'workshop-agent' }),
        mockPrisma,
        expect.any(Function),
      );
    });

    it('rechecks and locks the active site before writing a workshop line', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.site.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        UnprocessableEntityException,
      );

      expect(mockPrisma.site.updateMany).toHaveBeenCalledWith({
        where: { id: 'site-1', tenant_id: tenantId, is_active: true },
        data: { is_active: true },
      });
      expect(mockPrisma.workshopTaskLineItem.create).not.toHaveBeenCalled();
    });

    it('rolls back execution when the action log cannot be persisted', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockAgentActionLog.recordInTransaction.mockImplementation(
        async (
          _input: unknown,
          _transaction: unknown,
          work?: () => Promise<unknown>,
        ) => {
          if (work) await work();
          throw new Error('Audit storage unavailable');
        },
      );

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Audit storage unavailable',
      );

      expect(mockAgentActionLog.recordInTransaction).toHaveBeenCalled();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AgentProposalStatus.EXECUTED,
          }),
        }),
      );
    });

    it('rolls back workshop.booking_package execution when the action log cannot be persisted', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop.booking_package',
        preview_json: { execution_context: { site_id: 'site-1' } },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockAgentActionLog.recordInTransaction.mockImplementation(
        async (
          _input: unknown,
          _transaction: unknown,
          work?: () => Promise<unknown>,
        ) => {
          if (work) await work();
          throw new Error('Audit storage unavailable');
        },
      );

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Audit storage unavailable',
      );

      expect(mockWorkshopBookingPackage.applyPackage).toHaveBeenCalled();
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AgentProposalStatus.EXECUTED,
          }),
        }),
      );
    });

    it('refuses approval when policy re-evaluation returns HUMAN_ONLY with clear message', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockAgentPolicyService.evaluate.mockResolvedValue({
        tier: AgentPolicyTier.HUMAN_ONLY,
        reasons: ['rule_disabled_fail_closed', 'sensitive_operation'],
        rule_id: 'rule-1',
        rule_version: 2,
      });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        new UnprocessableEntityException(
          'Action requires human execution or exceeds policy limits: rule_disabled_fail_closed, sensitive_operation',
        ),
      );

      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
      expect(mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
    });

    it('refuses approval for stored HUMAN_ONLY proposals even if policy now allows them', async () => {
      const proposal = createMockProposal({
        tier: AgentPolicyTier.HUMAN_ONLY,
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        UnprocessableEntityException,
      );

      expect(mockAgentPolicyService.evaluate).not.toHaveBeenCalled();
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
      expect(mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
    });

    it('refuses approval when context amount_eur exceeds updated condition threshold', async () => {
      const proposal = createMockProposal({
        payload_json: { amount_eur: 500 },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockAgentPolicyService.evaluate.mockResolvedValue({
        tier: AgentPolicyTier.HUMAN_ONLY,
        reasons: ['amount_eur_exceeds_threshold'],
        rule_id: 'rule-2',
        rule_version: 1,
      });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        new UnprocessableEntityException(
          'Action requires human execution or exceeds policy limits: amount_eur_exceeds_threshold',
        ),
      );

      expect(mockAgentPolicyService.evaluate).toHaveBeenCalledWith(
        {
          action_type: 'workshop_order.add_line',
          context: { amount_eur: 500 },
        },
        { skipAdminCheck: true },
      );
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
      expect(mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
    });

    it('handles concurrent double-approve race condition idempotently when reload returns EXECUTED (payload dispatched once)', async () => {
      const pendingProposal = createMockProposal({
        status: AgentProposalStatus.PENDING,
      });
      const executedProposal = createMockProposal({
        status: AgentProposalStatus.EXECUTED,
        decided_by: 'concurrent-user',
        decided_at: new Date(),
      });

      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(pendingProposal)
        .mockResolvedValueOnce(executedProposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.approveProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
      // Payload execution and logging were NOT dispatched by the concurrent caller
      expect(mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
    });

    it('handles concurrent double-approve race condition idempotently when reload returns APPROVED', async () => {
      const pendingProposal = createMockProposal({
        status: AgentProposalStatus.PENDING,
      });
      const approvedProposal = createMockProposal({
        status: AgentProposalStatus.APPROVED,
        decided_by: 'concurrent-user',
        decided_at: new Date(),
      });

      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(pendingProposal)
        .mockResolvedValueOnce(approvedProposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.approveProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.APPROVED);
      expect(mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException on concurrent race condition if reload returns unexpected status', async () => {
      const pendingProposal = createMockProposal({
        status: AgentProposalStatus.PENDING,
      });
      const rejectedProposal = createMockProposal({
        status: AgentProposalStatus.REJECTED,
        decided_by: 'concurrent-user',
        decided_at: new Date(),
      });

      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(pendingProposal)
        .mockResolvedValueOnce(rejectedProposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        new ConflictException(
          'Proposal state conflict: current status is REJECTED',
        ),
      );
      expect(mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
    });

    it('returns existing proposal idempotently if already APPROVED or EXECUTED', async () => {
      const proposal = createMockProposal({
        status: AgentProposalStatus.EXECUTED,
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      const result = await service.approveProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
      expect(mockAgentPolicyService.evaluate).not.toHaveBeenCalled();
    });

  });
});
