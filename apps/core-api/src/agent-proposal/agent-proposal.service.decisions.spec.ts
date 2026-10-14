import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { AgentProposalStatus } from '@prisma/client';
import { AgentProposalService } from './agent-proposal.service.js';
import { createAgentProposalSpecHarness, createMockProposal, proposalId, tenantId, traceId, userId } from './agent-proposal.spec.support.js';

describe('AgentProposalService decisions', () => {
  let service: AgentProposalService;
  let mockPrisma: any;
  let mockAgentActionLog: any;

  beforeEach(() => {
    ({ service, mockPrisma, mockAgentActionLog } = createAgentProposalSpecHarness());
  });

  describe('decided-by display', () => {
    const decider = {
      id: userId,
      email: 'sam@example.com',
      firstName: 'Sam',
      lastName: 'Supervisor',
    };

    it('returns the decider name and email on reject, next to the raw user id', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce({
          ...proposal,
          status: AgentProposalStatus.REJECTED,
          decided_by: userId,
          decided_at: new Date(),
        });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.findMany.mockResolvedValue([decider]);

      const result = await service.rejectProposal(proposalId);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [userId] },
          memberships: { some: { tenant_id: tenantId } },
        },
        select: { id: true, email: true, firstName: true, lastName: true },
      });
      expect(result.decided_by).toBe(userId);
      expect(result.decided_by_name).toBe('Sam Supervisor');
      expect(result.decided_by_email).toBe('sam@example.com');
    });

    it('returns the email with a null name when the decider has no name set', async () => {
      mockPrisma.agentProposal.findFirst.mockResolvedValueOnce(
        createMockProposal({
          status: AgentProposalStatus.REJECTED,
          decided_by: userId,
          decided_at: new Date(),
        }),
      );
      mockPrisma.user.findMany.mockResolvedValue([
        { ...decider, firstName: null, lastName: null },
      ]);

      const result = await service.rejectProposal(proposalId);

      expect(result.decided_by_name).toBeNull();
      expect(result.decided_by_email).toBe('sam@example.com');
    });

    it('returns null names when the decider is not a member of this tenant', async () => {
      mockPrisma.agentProposal.findFirst.mockResolvedValueOnce(
        createMockProposal({
          status: AgentProposalStatus.REJECTED,
          decided_by: 'user-outside-tenant',
          decided_at: new Date(),
        }),
      );
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.rejectProposal(proposalId);

      expect(result.decided_by).toBe('user-outside-tenant');
      expect(result.decided_by_name).toBeNull();
      expect(result.decided_by_email).toBeNull();
    });

    it('fails before any claim when the approver lookup fails, so nothing executes or is marked FAILED', async () => {
      mockPrisma.agentProposal.findFirst.mockResolvedValueOnce(
        createMockProposal(),
      );
      mockPrisma.user.findMany.mockRejectedValueOnce(
        new Error('connection lost'),
      );

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'connection lost',
      );

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
      expect(mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
    });

    it('returns the approver name and email on a successful approve', async () => {
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
      mockPrisma.user.findMany.mockResolvedValue([decider]);

      const result = await service.approveProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
      expect(result.decided_by).toBe(userId);
      expect(result.decided_by_name).toBe('Sam Supervisor');
      expect(result.decided_by_email).toBe('sam@example.com');
    });

    it('resolves decider contacts for a whole list with one tenant-scoped query', async () => {
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.agentProposal.findMany.mockResolvedValue([
        createMockProposal({
          id: 'proposal-a',
          action_type: 'sales_order.apply_discount',
          status: AgentProposalStatus.APPROVED,
          decided_by: 'user-a',
          decided_at: new Date(),
        }),
        createMockProposal({
          id: 'proposal-b',
          action_type: 'sales_order.apply_discount',
          status: AgentProposalStatus.REJECTED,
          decided_by: 'user-b',
          decided_at: new Date(),
        }),
        createMockProposal({
          id: 'proposal-c',
          action_type: 'sales_order.apply_discount',
        }),
      ]);
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'user-a',
          email: 'alex@example.com',
          firstName: 'Alex',
          lastName: 'Approver',
        },
        {
          id: 'user-b',
          email: 'jo@example.com',
          firstName: null,
          lastName: null,
        },
      ]);

      const result = await service.listProposals({});

      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: ['user-a', 'user-b'] },
            memberships: { some: { tenant_id: tenantId } },
          },
        }),
      );
      expect(result.data[0]).toMatchObject({
        decided_by: 'user-a',
        decided_by_name: 'Alex Approver',
        decided_by_email: 'alex@example.com',
      });
      expect(result.data[1]).toMatchObject({
        decided_by: 'user-b',
        decided_by_name: null,
        decided_by_email: 'jo@example.com',
      });
      expect(result.data[2]).toMatchObject({
        decided_by: null,
        decided_by_name: null,
        decided_by_email: null,
      });
    });
  });

  describe('rejectProposal', () => {
    it('saves reason, transitions to REJECTED, logs via AE2, and does NOT dispatch action payload', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce({
          ...proposal,
          status: AgentProposalStatus.REJECTED,
          decided_by: userId,
          decided_at: new Date(),
          reason: 'Too expensive',
        });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.rejectProposal(proposalId, {
        reason: 'Too expensive',
      });

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
          expires_at: { gt: expect.any(Date) },
        },
        data: {
          status: AgentProposalStatus.REJECTED,
          decided_by: userId,
          decided_at: expect.any(Date),
          reason: 'Too expensive',
        },
      });

      expect(mockAgentActionLog.recordInTransaction).toHaveBeenCalledTimes(1);
      expect(mockAgentActionLog.recordInTransaction).toHaveBeenCalledWith(
        {
          traceId,
          actorType: 'USER',
          agentId: 'workshop-agent',
          onBehalfOfUserId: userId,
          actionType: 'workshop_order.add_line',
          tier: 'PROPOSE',
          status: 'REJECTED',
          inputSummary: { proposalId: proposal.id, reason: 'Too expensive' },
          resultSummary: { rejectedBy: userId, reason: 'Too expensive' },
        },
        mockPrisma,
      );

      expect(mockAgentActionLog.record).not.toHaveBeenCalled();

      expect(result.status).toBe(AgentProposalStatus.REJECTED);
      expect(result.reason).toBe('Too expensive');
    });

    it('returns existing proposal idempotently if already REJECTED', async () => {
      const proposal = createMockProposal({
        status: AgentProposalStatus.REJECTED,
        reason: 'Already rejected',
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      const result = await service.rejectProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.REJECTED);
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
    });

    it('returns existing proposal idempotently even after expiration if already REJECTED', async () => {
      const expiredProposal = createMockProposal({
        status: AgentProposalStatus.REJECTED,
        reason: 'Already rejected earlier',
        expires_at: new Date(Date.now() - 1000 * 60 * 60), // expired 1 hour ago
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(expiredProposal);

      const result = await service.rejectProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.REJECTED);
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
      expect(mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException if already APPROVED or EXECUTED', async () => {
      const proposal = createMockProposal({
        status: AgentProposalStatus.APPROVED,
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.rejectProposal(proposalId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException if status is FAILED', async () => {
      const proposal = createMockProposal({
        status: AgentProposalStatus.FAILED,
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.rejectProposal(proposalId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws UnprocessableEntityException if expired while PENDING', async () => {
      const proposal = createMockProposal({
        expires_at: new Date(Date.now() - 1000), // past
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.rejectProposal(proposalId)).rejects.toThrow(
        UnprocessableEntityException,
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: { status: AgentProposalStatus.EXPIRED },
      });
    });

    it('handles concurrent rejection idempotency when reload returns REJECTED', async () => {
      const pendingProposal = createMockProposal({
        status: AgentProposalStatus.PENDING,
      });
      const rejectedProposal = createMockProposal({
        status: AgentProposalStatus.REJECTED,
        reason: 'Concurrent rejection',
      });
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(pendingProposal)
        .mockResolvedValueOnce(rejectedProposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.rejectProposal(proposalId, {
        reason: 'My rejection',
      });

      expect(result.status).toBe(AgentProposalStatus.REJECTED);
      expect(mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
    });
  });
});
