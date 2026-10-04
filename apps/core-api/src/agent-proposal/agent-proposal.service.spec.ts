import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AgentPolicyTier, AgentProposalStatus, Prisma } from '@prisma/client';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { AgentPolicyService } from '../agent-policy/agent-policy.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AgentProposalService } from './agent-proposal.service.js';

describe('AgentProposalService', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const userId = '00000000-0000-0000-0000-000000000002';
  const proposalId = '11111111-1111-1111-1111-111111111111';
  const traceId = '22222222-2222-2222-2222-222222222222';

  let service: AgentProposalService;
  let mockPrisma: any;
  let mockTenantContext: any;
  let mockAgentPolicyService: any;
  let mockAgentActionLog: any;

  beforeEach(() => {
    mockTenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({
        userId: 'fb-user-1',
        email: 'supervisor@example.com',
        tenantId,
        role: 'ADMIN',
      }),
    };

    mockPrisma = {
      agentProposal: {
        updateMany: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: userId }),
      },
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ id: 'tm-1' }),
      },
    };

    mockAgentPolicyService = {
      evaluate: jest.fn().mockResolvedValue({
        tier: AgentPolicyTier.PROPOSE,
        reasons: ['base_tier_propose'],
        rule_id: 'rule-1',
        rule_version: 1,
      }),
    };

    mockAgentActionLog = {
      record: jest.fn().mockImplementation(async (_input, work) => {
        let workResult;
        if (work) {
          workResult = await work();
        }
        return { id: 'log-1', traceId, workResult };
      }),
    };

    service = new AgentProposalService(
      mockPrisma,
      mockTenantContext,
      mockAgentPolicyService,
      mockAgentActionLog,
    );
  });

  const createMockProposal = (overrides?: Partial<any>) => ({
    id: proposalId,
    tenant_id: tenantId,
    trace_id: traceId,
    action_type: 'workshop_order.add_line',
    payload_json: { amount_eur: 50 },
    preview_json: null,
    tier: AgentPolicyTier.PROPOSE,
    status: AgentProposalStatus.PENDING,
    decided_by: null,
    decided_at: null,
    reason: null,
    expires_at: new Date(Date.now() + 1000 * 60 * 60), // +1 hour
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('listProposals', () => {
    it('lazily expires pending proposals past expiration and returns proposals', () => {
      return (async () => {
        const proposal = createMockProposal();
        mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.agentProposal.findMany.mockResolvedValue([proposal]);

        const result = await service.listProposals({});

        expect(mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith({
          where: {
            tenant_id: tenantId,
            status: AgentProposalStatus.PENDING,
            expires_at: { lt: expect.any(Date) },
          },
          data: { status: AgentProposalStatus.EXPIRED },
        });

        expect(result.data).toHaveLength(1);
        expect(result.data[0].id).toBe(proposalId);
      })();
    });
  });

  describe('rejectProposal', () => {
    it('successfully transitions to REJECTED and records audit log', async () => {
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
        },
        data: {
          status: AgentProposalStatus.REJECTED,
          decided_by: userId,
          decided_at: expect.any(Date),
          reason: 'Too expensive',
        },
      });

      expect(mockAgentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId,
          actorType: 'USER',
          onBehalfOfUserId: userId,
          actionType: 'workshop_order.add_line',
          status: 'REJECTED',
        }),
      );

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

    it('throws ConflictException if already APPROVED or EXECUTED', async () => {
      const proposal = createMockProposal({
        status: AgentProposalStatus.APPROVED,
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.rejectProposal(proposalId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws UnprocessableEntityException if expired', async () => {
      const proposal = createMockProposal({
        expires_at: new Date(Date.now() - 1000), // past
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.rejectProposal(proposalId)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('approveProposal', () => {
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

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenNthCalledWith(
        1,
        {
          where: {
            id: proposalId,
            tenant_id: tenantId,
            status: AgentProposalStatus.PENDING,
          },
          data: {
            status: AgentProposalStatus.APPROVED,
            decided_by: userId,
            decided_at: expect.any(Date),
          },
        },
      );

      expect(mockAgentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId,
          actorType: 'USER',
          onBehalfOfUserId: userId,
          actionType: 'workshop_order.add_line',
          status: 'EXECUTED',
        }),
        expect.any(Function),
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenNthCalledWith(
        2,
        {
          where: { id: proposalId, tenant_id: tenantId },
          data: { status: AgentProposalStatus.EXECUTED },
        },
      );

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
    });

    it('rejects approval if policy re-evaluation results in HUMAN_ONLY', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockAgentPolicyService.evaluate.mockResolvedValue({
        tier: AgentPolicyTier.HUMAN_ONLY,
        reasons: ['rule_disabled_fail_closed'],
        rule_id: 'rule-1',
        rule_version: 2,
      });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        UnprocessableEntityException,
      );

      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
      expect(mockAgentActionLog.record).not.toHaveBeenCalled();
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

    it('marks as FAILED and rethrows if payload execution fails', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockAgentActionLog.record.mockRejectedValue(
        new Error('Dispatch failure'),
      );

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Dispatch failure',
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: { id: proposalId, tenant_id: tenantId },
        data: { status: AgentProposalStatus.FAILED },
      });
    });

    it('throws UnprocessableEntityException if expired', async () => {
      const proposal = createMockProposal({
        expires_at: new Date(Date.now() - 5000),
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        UnprocessableEntityException,
      );
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
