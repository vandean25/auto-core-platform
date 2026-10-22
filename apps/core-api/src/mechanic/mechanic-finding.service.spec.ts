import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
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

const OPEN_TASK = {
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
};

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
    (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue({
      ...OPEN_TASK,
      mechanic_notes: '   ',
    });

    await expect(
      service.submitFinding(MECHANIC_ID, TASK_ID, {}),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects submit for a completed task', async () => {
    (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue({
      ...OPEN_TASK,
      status: 'DONE',
    });

    await expect(
      service.submitFinding(MECHANIC_ID, TASK_ID, {}),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects submit when the order is at another site', async () => {
    (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue({
      ...OPEN_TASK,
      workshop_order: { ...OPEN_TASK.workshop_order, site_id: 'site-other' },
    });

    await expect(
      service.submitFinding(MECHANIC_ID, TASK_ID, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects submit when the task is not visible in the tenant', async () => {
    (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      service.submitFinding(MECHANIC_ID, TASK_ID, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects foreign media ids for the task', async () => {
    (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(OPEN_TASK);
    (mockPrisma.workshopMedia.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'media-authorized',
        mime_type: 'image/jpeg',
        caption: null,
      },
    ]);

    await expect(
      service.submitFinding(MECHANIC_ID, TASK_ID, {
        media_ids: ['media-foreign'],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('creates a pending agent proposal with finding evidence', async () => {
    (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(OPEN_TASK);
    (mockPrisma.workshopMedia.findMany as jest.Mock).mockResolvedValue([]);
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

  it('includes all authorized task media when no media_ids are sent', async () => {
    (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(OPEN_TASK);
    (mockPrisma.workshopMedia.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'media-1',
        mime_type: 'image/jpeg',
        caption: 'pilot customer hose',
      },
      {
        id: 'media-2',
        mime_type: 'image/png',
        caption: null,
      },
    ]);
    mockAgentProposals.persistPendingAction.mockResolvedValue({
      id: 'proposal-1',
      trace_id: 'trace-1',
      action_type: MECHANIC_FINDING_ACTION_TYPE,
      status: AgentProposalStatus.PENDING,
    });

    await service.submitFinding(MECHANIC_ID, TASK_ID, {
      command_id: '51500000-0000-4000-8000-000000000541',
    });

    expect(mockAgentProposals.persistPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        payload_json: expect.objectContaining({
          finding: expect.objectContaining({
            media: [
              expect.objectContaining({ id: 'media-1' }),
              expect.objectContaining({ id: 'media-2' }),
            ],
          }),
        }),
      }),
    );
  });

  it('replays the same proposal for duplicate command_id', async () => {
    (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(OPEN_TASK);
    (mockPrisma.workshopMedia.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.agentProposal.findFirst as jest.Mock).mockResolvedValue({
      id: 'proposal-existing',
      trace_id: '51500000-0000-4000-8000-000000000538',
      action_type: MECHANIC_FINDING_ACTION_TYPE,
      status: AgentProposalStatus.PENDING,
      payload_json: {
        command_id: '51500000-0000-4000-8000-000000000538',
      },
      preview_json: {},
      tenant_id: TENANT_ID,
    });

    const result = await service.submitFinding(MECHANIC_ID, TASK_ID, {
      command_id: '51500000-0000-4000-8000-000000000538',
    });

    expect(result.proposalId).toBe('proposal-existing');
    expect(mockAgentProposals.persistPendingAction).not.toHaveBeenCalled();
  });

  it('rejects duplicate command_id when the stored fingerprint differs', async () => {
    (mockPrisma.workshopTask.findFirst as jest.Mock).mockResolvedValue(OPEN_TASK);
    (mockPrisma.workshopMedia.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.agentProposal.findFirst as jest.Mock).mockResolvedValue({
      id: 'proposal-existing',
      trace_id: '51500000-0000-4000-8000-000000000538',
      action_type: MECHANIC_FINDING_ACTION_TYPE,
      status: AgentProposalStatus.PENDING,
      payload_json: {
        command_id: '51500000-0000-4000-8000-000000000538',
      },
      preview_json: {
        mcp_command_idempotency: {
          command_id: '51500000-0000-4000-8000-000000000538',
          args_fingerprint: 'different-fingerprint',
        },
      },
      tenant_id: TENANT_ID,
    });

    await expect(
      service.submitFinding(MECHANIC_ID, TASK_ID, {
        command_id: '51500000-0000-4000-8000-000000000538',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
