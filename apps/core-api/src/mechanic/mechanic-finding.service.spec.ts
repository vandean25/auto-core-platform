import { UnprocessableEntityException } from '@nestjs/common';
import { AgentPolicyTier, AgentProposalStatus } from '@prisma/client';
import { MechanicFindingService } from './mechanic-finding.service.js';
import { MECHANIC_FINDING_ACTION_TYPE } from './mechanic-finding.constants.js';
import {
  MECHANIC_ID,
  TASK_ID,
  TENANT_ID,
  mockPrisma,
  mockTenantContext,
} from './mechanic.spec.support.js';

describe('MechanicFindingService', () => {
  const mockSiteContext = {
    getSiteId: jest.fn().mockResolvedValue('site-1'),
  };
  const mockAgentProposals = {
    persistPendingAction: jest.fn(),
  };

  let service: MechanicFindingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MechanicFindingService(
      mockPrisma,
      mockTenantContext,
      mockSiteContext as never,
      mockAgentProposals as never,
    );
  });

  it('rejects submit when mechanic notes are empty', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: TASK_ID,
      status: 'IN_PROGRESS',
      bay_id: null,
      mechanic_id: MECHANIC_ID,
      mechanic_notes: '   ',
      workshop_order_id: 'order-1',
      workshop_order: {
        id: 'order-1',
        site_id: 'site-1',
        status: 'IN_PROGRESS',
        purpose: null,
        mechanic_id: MECHANIC_ID,
        bay_id: null,
      },
    });

    await expect(
      service.submitFinding(MECHANIC_ID, TASK_ID, {}),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('creates a pending agent proposal with finding evidence', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: TASK_ID,
      status: 'IN_PROGRESS',
      bay_id: null,
      mechanic_id: MECHANIC_ID,
      mechanic_notes: 'Oil leak at filter housing',
      workshop_order_id: 'order-1',
      workshop_order: {
        id: 'order-1',
        site_id: 'site-1',
        status: 'IN_PROGRESS',
        purpose: null,
        mechanic_id: MECHANIC_ID,
        bay_id: null,
      },
    });
    mockPrisma.workshopMedia.findMany.mockResolvedValue([]);
    mockAgentProposals.persistPendingAction.mockResolvedValue({
      id: 'proposal-1',
      trace_id: 'trace-1',
      action_type: MECHANIC_FINDING_ACTION_TYPE,
      status: AgentProposalStatus.PENDING,
    });

    const result = await service.submitFinding(MECHANIC_ID, TASK_ID, {
      command_id: '51500000-0000-4000-8000-000000000538',
    });

    expect(result.proposalId).toBe('proposal-1');
    expect(mockAgentProposals.persistPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: MECHANIC_FINDING_ACTION_TYPE,
        tier: AgentPolicyTier.PROPOSE,
        trace_id: '51500000-0000-4000-8000-000000000538',
      }),
    );
  });

  it('replays the same proposal for duplicate command_id', async () => {
    mockPrisma.agentProposal.findFirst.mockResolvedValue({
      id: 'proposal-existing',
      trace_id: '51500000-0000-4000-8000-000000000538',
      action_type: MECHANIC_FINDING_ACTION_TYPE,
      status: AgentProposalStatus.PENDING,
      payload_json: {
        command_id: '51500000-0000-4000-8000-000000000538',
      },
      tenant_id: TENANT_ID,
    });

    const result = await service.submitFinding(MECHANIC_ID, TASK_ID, {
      command_id: '51500000-0000-4000-8000-000000000538',
    });

    expect(result.proposalId).toBe('proposal-existing');
    expect(mockAgentProposals.persistPendingAction).not.toHaveBeenCalled();
  });
});
