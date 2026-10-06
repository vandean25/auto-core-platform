import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AgentPolicyTier,
  AgentProposalStatus,
  Prisma,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
} from '@prisma/client';
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
  let mockSiteContext: any;

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

    mockSiteContext = {
      getSiteId: jest.fn().mockResolvedValue('site-1'),
    };

    mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return callback(mockPrisma);
      }),
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
      site: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      workshopOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'wo-1',
          status: 'IN_PROGRESS',
          purpose: null,
          tasks: [{ id: 'task-1', line_items_version: 0 }],
        }),
      },
      workshopTask: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'task-1', line_items_version: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      workshopTaskLineItem: {
        create: jest.fn().mockResolvedValue({ id: 'line-1' }),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
      recordInTransaction: jest
        .fn()
        .mockImplementation(async (_input, _transaction, work) => ({
          id: 'log-1',
          traceId,
          workResult: work ? await work() : undefined,
        })),
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
      mockSiteContext,
    );
  });

  const createMockProposal = (overrides?: Partial<any>) => ({
    id: proposalId,
    tenant_id: tenantId,
    trace_id: traceId,
    action_type: 'workshop_order.add_line',
    payload_json: {
      agent_id: 'workshop-agent',
      order_id: 'wo-1',
      amount_eur: 50,
    },
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
    it('lazily expires pending proposals past expiration and returns proposals', async () => {
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

      expect(mockPrisma.agentProposal.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 50,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(proposalId);
    });

    it('returns effective target and amount for executor payload forms', async () => {
      mockPrisma.agentProposal.findMany.mockResolvedValue([
        createMockProposal({
          action_type: 'customer.update',
          payload_json: { customer_id: 'customer-123', amount_eur: 125 },
        }),
        createMockProposal({
          id: 'line-proposal',
          payload_json: {
            order_id: 'order-456',
            unit_price: 25,
            quantity: 4,
          },
        }),
      ]);

      const result = await service.listProposals({});

      expect(
        result.data.map(({ effective_summary }) => effective_summary),
      ).toEqual([
        {
          target_type: 'Customer',
          target_id: 'customer-123',
          amount_eur: 125,
        },
        {
          target_type: 'WorkshopOrder',
          target_id: 'order-456',
          amount_eur: 100,
        },
      ]);
    });

    it('filters proposals by status and enforces tenant isolation', async () => {
      const pendingProposal = createMockProposal({
        status: AgentProposalStatus.PENDING,
      });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.agentProposal.findMany.mockResolvedValue([pendingProposal]);

      const result = await service.listProposals({
        status: AgentProposalStatus.PENDING,
        limit: 15,
      });

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: tenantId,
          }),
        }),
      );

      expect(mockPrisma.agentProposal.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 15,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe(AgentProposalStatus.PENDING);
    });
  });

  describe('getProposalById', () => {
    it('returns proposal for the current tenant', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      const result = await service.getProposalById(proposalId);

      expect(mockPrisma.agentProposal.findFirst).toHaveBeenCalledWith({
        where: { id: proposalId, tenant_id: tenantId },
      });
      expect(result.id).toBe(proposalId);
    });

    it('throws NotFoundException when proposal does not exist or belongs to another tenant', async () => {
      mockPrisma.agentProposal.findFirst.mockResolvedValue(null);

      await expect(service.getProposalById(proposalId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lazily marks PENDING proposal as EXPIRED when past expires_at', async () => {
      const expiredProposal = createMockProposal({
        status: AgentProposalStatus.PENDING,
        expires_at: new Date(Date.now() - 1000 * 60),
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(expiredProposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.getProposalById(proposalId);

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: { status: AgentProposalStatus.EXPIRED },
      });
      expect(result.status).toBe(AgentProposalStatus.EXPIRED);
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
        async (_input, _transaction, work) => {
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

    it('returns already EXECUTED proposal idempotently even after expiration without throwing 422', async () => {
      const expiredExecutedProposal = createMockProposal({
        status: AgentProposalStatus.EXECUTED,
        expires_at: new Date(Date.now() - 1000 * 60 * 60), // expired 1 hour ago
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(
        expiredExecutedProposal,
      );

      const result = await service.approveProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
      expect(mockAgentPolicyService.evaluate).not.toHaveBeenCalled();
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
    });

    it('returns already APPROVED proposal idempotently even after expiration without throwing 422', async () => {
      const expiredApprovedProposal = createMockProposal({
        status: AgentProposalStatus.APPROVED,
        expires_at: new Date(Date.now() - 1000 * 60 * 60),
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(
        expiredApprovedProposal,
      );

      const result = await service.approveProposal(proposalId);

      expect(result.status).toBe(AgentProposalStatus.APPROVED);
      expect(mockAgentPolicyService.evaluate).not.toHaveBeenCalled();
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
    });

    it('throws ConflictException if status is REJECTED or FAILED', async () => {
      const proposal = createMockProposal({
        status: AgentProposalStatus.REJECTED,
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('marks as FAILED and rethrows if payload execution fails', async () => {
      const proposal = createMockProposal();
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.workshopOrder.findFirst.mockRejectedValueOnce(
        new Error('Dispatch failure'),
      );

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Dispatch failure',
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: 'Dispatch failure',
        },
      });
    });

    it('throws UnprocessableEntityException if expired while PENDING', async () => {
      const proposal = createMockProposal({
        expires_at: new Date(Date.now() - 5000),
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('normalizes amount_cents and amountCents to amount_eur by dividing by 100 in extractPolicyContext', async () => {
      const proposal = createMockProposal({
        payload_json: { order_id: 'wo-1', amount_cents: 25000 },
      });
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce({
          ...proposal,
          status: AgentProposalStatus.EXECUTED,
          decided_by: userId,
          decided_at: new Date(),
        });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await service.approveProposal(proposalId);

      expect(mockAgentPolicyService.evaluate).toHaveBeenCalledWith(
        {
          action_type: 'workshop_order.add_line',
          context: { amount_eur: 250 },
        },
        { skipAdminCheck: true },
      );
    });

    it('refuses approval when payload amount_cents exceeds policy conditions threshold', async () => {
      const proposal = createMockProposal({
        payload_json: { order_id: 'wo-1', amount_cents: 60000 }, // 600 EUR
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockAgentPolicyService.evaluate.mockResolvedValue({
        tier: AgentPolicyTier.HUMAN_ONLY,
        reasons: ['amount_above_threshold'],
        rule_id: 'rule-cents',
        rule_version: 1,
      });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        new UnprocessableEntityException(
          'Action requires human execution or exceeds policy limits: amount_above_threshold',
        ),
      );

      expect(mockAgentPolicyService.evaluate).toHaveBeenCalledWith(
        {
          action_type: 'workshop_order.add_line',
          context: { amount_eur: 600 },
        },
        { skipAdminCheck: true },
      );
      expect(mockPrisma.agentProposal.updateMany).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when CAS updateMany returns 0 because proposal expired during policy evaluation', async () => {
      const proposal = createMockProposal({
        expires_at: new Date(Date.now() + 1000), // initially valid
      });
      const expiredProposal = createMockProposal({
        expires_at: new Date(Date.now() - 1000), // now expired
      });

      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce(expiredProposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 0 }); // CAS lock returned 0

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        new UnprocessableEntityException('Proposal has expired'),
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: { status: AgentProposalStatus.EXPIRED },
      });
      expect(mockAgentActionLog.recordInTransaction).not.toHaveBeenCalled();
    });

    it('dispatches workshop_order.add_line domain action, creates WorkshopTaskLineItem, and marks EXECUTED', async () => {
      const proposal = createMockProposal({
        payload_json: {
          order_id: 'wo-1',
          task_id: 'task-1',
          type: 'PART',
          item_no: 'OIL-FILTER-01',
          description: 'Engine Oil Filter',
          quantity: 2,
          unit_price: 15.5,
        },
      });
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

      expect(mockPrisma.workshopOrder.findFirst).toHaveBeenCalledWith({
        where: { id: 'wo-1', tenant_id: tenantId, site_id: 'site-1' },
        include: {
          tasks: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      expect(mockPrisma.workshopTaskLineItem.create).toHaveBeenCalledWith({
        data: {
          tenant_id: tenantId,
          workshop_task_id: 'task-1',
          type: 'PART',
          item_no: 'OIL-FILTER-01',
          description: 'Engine Oil Filter',
          quantity: expect.any(Prisma.Decimal),
          unit_price: expect.any(Prisma.Decimal),
        },
      });

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
    });

    it('dispatches customer.update domain action, updates Customer, and marks EXECUTED', async () => {
      const proposal = createMockProposal({
        action_type: 'customer.update',
        payload_json: {
          customer_id: 'cust-1',
          first_name: 'Jane',
          phone: '+49123456789',
        },
      });
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

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-1', tenant_id: tenantId },
      });

      expect(mockPrisma.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'cust-1', tenant_id: tenantId },
        data: {
          first_name: 'Jane',
          phone: '+49123456789',
        },
      });

      expect(result.status).toBe(AgentProposalStatus.EXECUTED);
    });

    it('fails closed with BadRequestException for unsupported action types, marks proposal FAILED and logs failure', async () => {
      const proposal = createMockProposal({
        action_type: 'unsupported.action_type',
        payload_json: { some_param: 123 },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Unsupported action type for automatic execution: unsupported.action_type',
      );

      // Proposal must be marked FAILED with reason, NOT EXECUTED
      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason:
            'Unsupported action type for automatic execution: unsupported.action_type',
        },
      });
    });

    it('marks proposal FAILED with reason when domain execution fails (e.g. order not found)', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: { order_id: 'non-existent-order' },
      });
      mockPrisma.workshopOrder.findFirst.mockResolvedValueOnce(null);
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Workshop order non-existent-order not found',
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: 'Workshop order non-existent-order not found',
        },
      });
    });

    it('rejects workshop_order.add_line when payload site_id does not match caller authorized site', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          site_id: 'other-site-999',
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Action payload site (other-site-999) does not match caller authorized site (site-1)',
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason:
            'Action payload site (other-site-999) does not match caller authorized site (site-1)',
        },
      });
    });

    it('rejects workshop_order.add_line when payload amount contradicts unit_price * quantity', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: 600,
          quantity: 1,
          amount_eur: 50,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Payload amount (50) contradicts unit_price (600) * quantity (1) = 600',
      );
    });

    it('evaluates policy with unit_price * quantity when amount_eur is omitted', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: 300,
          quantity: 2,
        },
      });
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce({
          ...proposal,
          status: AgentProposalStatus.EXECUTED,
          decided_by: userId,
          decided_at: new Date(),
        });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });

      await service.approveProposal(proposalId);

      expect(mockAgentPolicyService.evaluate).toHaveBeenCalledWith(
        {
          action_type: 'workshop_order.add_line',
          context: {
            amount_eur: 600,
          },
        },
        { skipAdminCheck: true },
      );
    });

    it('rejects workshop_order.add_line when unit_price is negative', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: -100,
          quantity: 1,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Line item unit_price cannot be negative',
      );
    });

    it('rejects workshop_order.add_line when amount_eur is negative', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          amount_eur: -50,
          quantity: 1,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Line item amount cannot be negative',
      );
    });

    it('rejects workshop_order.add_line when quantity is zero or negative', async () => {
      const zeroQtyProposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: 50,
          quantity: 0,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(zeroQtyProposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Line item quantity must be a positive number',
      );

      const negativeQtyProposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: 50,
          quantity: -2,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(negativeQtyProposal);

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Line item quantity must be a positive number',
      );
    });

    it('rejects workshop_order.add_line when workshop order is already invoiced', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: 50,
          quantity: 1,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.workshopOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1',
        status: WorkshopOrderStatus.INVOICED,
        purpose: null,
        tasks: [{ id: 'task-1', line_items_version: 0 }],
      });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Workshop order is already invoiced',
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: 'Workshop order is already invoiced',
        },
      });
    });

    it('rejects workshop_order.add_line when stock-prep order is completed', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          unit_price: 50,
          quantity: 1,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.workshopOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1',
        status: WorkshopOrderStatus.COMPLETED,
        purpose: WorkshopOrderPurpose.STOCK_PREP,
        tasks: [{ id: 'task-1', line_items_version: 0 }],
      });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Completed stock-prep orders cannot be edited',
      );

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: 'Completed stock-prep orders cannot be edited',
        },
      });
    });

    it('throws ConflictException when task line_items_version CAS fails', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          task_id: 'task-1',
          expected_line_items_version: 2,
          unit_price: 50,
          quantity: 1,
        },
      });
      mockPrisma.agentProposal.findFirst.mockResolvedValue(proposal);
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.workshopTask.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.approveProposal(proposalId)).rejects.toThrow(
        'Workshop task line items changed; please reload and retry',
      );

      expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'task-1',
          tenant_id: tenantId,
          workshop_order: { site_id: 'site-1' },
          line_items_version: 2,
        },
        data: { line_items_version: { increment: 1 } },
      });

      expect(mockPrisma.agentProposal.updateMany).toHaveBeenLastCalledWith({
        where: {
          id: proposalId,
          tenant_id: tenantId,
          status: AgentProposalStatus.PENDING,
        },
        data: {
          status: AgentProposalStatus.FAILED,
          reason: 'Workshop task line items changed; please reload and retry',
        },
      });
    });

    it('uses targetTask.line_items_version when expected_line_items_version is omitted', async () => {
      const proposal = createMockProposal({
        action_type: 'workshop_order.add_line',
        payload_json: {
          order_id: 'wo-1',
          task_id: 'task-1',
          unit_price: 50,
          quantity: 1,
        },
      });
      mockPrisma.agentProposal.findFirst
        .mockResolvedValueOnce(proposal)
        .mockResolvedValueOnce({
          ...proposal,
          status: AgentProposalStatus.EXECUTED,
          decided_by: userId,
          decided_at: new Date(),
        });
      mockPrisma.agentProposal.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.workshopOrder.findFirst.mockResolvedValueOnce({
        id: 'wo-1',
        status: WorkshopOrderStatus.IN_PROGRESS,
        purpose: null,
        tasks: [{ id: 'task-1', line_items_version: 4 }],
      });

      await service.approveProposal(proposalId);

      expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'task-1',
          tenant_id: tenantId,
          workshop_order: { site_id: 'site-1' },
          line_items_version: 4,
        },
        data: { line_items_version: { increment: 1 } },
      });
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
