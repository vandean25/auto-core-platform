import { AgentPolicyTier, AgentProposalStatus } from '@prisma/client';
import { PendingActionExecutorService } from '../pending-action-executor/pending-action-executor.service.js';
import { AgentProposalService } from './agent-proposal.service.js';
import { AgentProposalDecisionService } from './agent-proposal-decision.service.js';
import { AgentProposalPolicyEvaluator } from './agent-proposal-policy-evaluator.service.js';
import { AgentProposalReadService } from './agent-proposal-read.service.js';
import { AgentProposalSubmissionService } from './agent-proposal-submission.service.js';

export const tenantId = '00000000-0000-0000-0000-000000000001';
export const userId = '00000000-0000-0000-0000-000000000002';
export const proposalId = '11111111-1111-1111-1111-111111111111';
export const traceId = '22222222-2222-2222-2222-222222222222';

/**
 * Builds the same mocks and collaborator wiring that the module provides.
 * Specs that exercise the facade use `service`; collaborator specs use the named collaborator.
 */
export function createAgentProposalSpecHarness() {
  const mockTenantContext: any = {
    getTenantId: jest.fn().mockResolvedValue(tenantId),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      userId: 'fb-user-1',
      email: 'supervisor@example.com',
      tenantId,
      role: 'ADMIN',
    }),
  };

  const mockSiteContext: any = {
    getSiteId: jest.fn().mockResolvedValue('site-1'),
    listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
  };
  const mockWorkshopIntake: any = {
    create: jest.fn().mockResolvedValue({ id: 'order-1' }),
  };
  const mockPartsRequisition: any = {
    createOnHandReservation: jest.fn().mockResolvedValue({ id: 'reservation-1' }),
    releaseReservation: jest.fn().mockResolvedValue({ id: 'reservation-1' }),
  };
  const mockDryRun: any = { executeInRollbackTransaction: jest.fn() };

  const mockPrisma: any = {
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
      findMany: jest.fn().mockResolvedValue([]),
    },
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue({ id: 'tm-1' }),
    },
    site: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workshopOrder: {
      findMany: jest.fn().mockResolvedValue([]),
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

  const mockAgentPolicyService: any = {
    evaluate: jest.fn().mockResolvedValue({
      tier: AgentPolicyTier.PROPOSE,
      reasons: ['base_tier_propose'],
      rule_id: 'rule-1',
      rule_version: 1,
    }),
  };

  const mockAgentActionLog: any = {
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

  const mockRegistrationIntakeApply = { apply: jest.fn() };
  const mockWorkshopBookingPackage = {
    applyPackage: jest.fn().mockResolvedValue({
      id: 'order-1',
      entityId: 'order-1',
      workshop_order_id: 'order-1',
    }),
    buildExecutionContext: jest
      .fn()
      .mockResolvedValue({ site_id: 'site-1' }),
    enrichInput: jest.fn(async (input: unknown) => input),
  };
  const mockPurchaseService = {
    applyProposedPurchaseOrderDraft: jest.fn(),
    buildProposedPurchaseOrderExecutionContext: jest
      .fn()
      .mockResolvedValue({ site_id: 'site-1' }),
  };
  const mockWorkshopOrderCompletion = {
    applyCompletion: jest.fn(),
    buildExecutionContext: jest
      .fn()
      .mockResolvedValue({ site_id: 'site-1' }),
    enrichInput: jest.fn(async (input: unknown) => input),
  };
  const mockInvoiceWorkshopDraftPropose = {
    applyDraft: jest.fn(),
    buildExecutionContext: jest
      .fn()
      .mockResolvedValue({ site_id: 'site-1' }),
    buildPolicyContext: jest.fn().mockResolvedValue({ amount_eur: 120 }),
    enrichInput: jest.fn(async (input: unknown) => input),
  };
  const mockWorkshopEstimateSendPropose = {
    applySend: jest.fn(),
    buildExecutionContext: jest
      .fn()
      .mockResolvedValue({ site_id: 'site-1' }),
    buildPolicyContext: jest.fn().mockResolvedValue({ amount_eur: 60 }),
    enrichInput: jest.fn(async (input: unknown) => input),
  };
  const mockWorkshopMediaUploadMcp = {
    createUploadSlot: jest.fn(),
  };
  const mockMechanicFindingPropose = {
    enrichInput: jest.fn(async (input: unknown) => input),
    normalizeSubmitPayload: jest.fn(async (input: unknown) => input),
    buildExecutionContext: jest
      .fn()
      .mockResolvedValue({ site_id: 'site-1' }),
    buildPreview: jest.fn(),
    applyAcknowledgment: jest.fn(),
  };
  const mockPendingActionExecutors = new PendingActionExecutorService(
    mockPrisma,
    mockTenantContext,
    mockSiteContext,
    mockWorkshopIntake,
    mockPartsRequisition,
    mockRegistrationIntakeApply,
    mockWorkshopBookingPackage,
    mockPurchaseService as never,
    mockWorkshopOrderCompletion as never,
    mockInvoiceWorkshopDraftPropose as never,
    mockWorkshopEstimateSendPropose as never,
    mockWorkshopMediaUploadMcp as never,
    mockMechanicFindingPropose as never,
    {} as never,
  );

  const policyEvaluator = new AgentProposalPolicyEvaluator(mockAgentPolicyService);
  const reads = new AgentProposalReadService(
    mockPrisma,
    mockTenantContext,
    mockSiteContext,
  );
  const decisions = new AgentProposalDecisionService(
    mockPrisma,
    mockTenantContext,
    mockAgentActionLog,
    mockSiteContext,
    mockPendingActionExecutors,
    policyEvaluator,
    reads,
  );
  const submitPayloadNormalizer = {
    normalize: jest.fn(async (actionType: string, payload: unknown) => {
      if (actionType === 'workshop_order.mechanic_finding') {
        return mockMechanicFindingPropose.normalizeSubmitPayload(payload);
      }
      return payload;
    }),
  };
  const submissions = new AgentProposalSubmissionService(
    mockPrisma,
    mockTenantContext,
    mockAgentActionLog,
    mockSiteContext,
    mockDryRun,
    mockPendingActionExecutors,
    policyEvaluator,
    submitPayloadNormalizer as never,
  );
  const service = new AgentProposalService(
    mockTenantContext,
    reads,
    decisions,
    submissions,
  );

  return {
    service,
    reads,
    decisions,
    submissions,
    policyEvaluator,
    mockPrisma,
    mockTenantContext,
    mockAgentPolicyService,
    mockAgentActionLog,
    mockSiteContext,
    mockDryRun,
    mockPendingActionExecutors,
    mockWorkshopIntake,
    mockPartsRequisition,
    mockWorkshopBookingPackage,
    mockMechanicFindingPropose,
    mockSubmitPayloadNormalizer: submitPayloadNormalizer,
  };
}

export const createMockProposal = (overrides?: Partial<any>) => ({
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
  created_by_agent: null,
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
