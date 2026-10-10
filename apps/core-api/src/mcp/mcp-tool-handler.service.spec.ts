import { ZodError } from 'zod';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { PendingActionExecutorService } from '../pending-action-executor/pending-action-executor.service.js';
import {
  McpToolHandlerService,
  type McpToolCallContext,
} from './mcp-tool-handler.service.js';
import type { McpWritePipelineService } from './mcp-write-pipeline.service.js';

describe('McpToolHandlerService write input validation', () => {
  const context: McpToolCallContext = {
    agentId: 'agent-1',
    onBehalfOfUserId: 'user-1',
  };
  const validDraft = {
    vehicle_id: '00000000-0000-4000-8000-000000000099',
    status: 'SCHEDULED',
    bay_id: '00000000-0000-4000-8000-000000000098',
    scheduled_start_at: '2026-10-12T09:00:00.000Z',
    scheduled_end_at: '2026-10-12T10:00:00.000Z',
  };
  const draftWithDraftStatus = { ...validDraft, status: 'DRAFT' };

  let handler: McpToolHandlerService;
  let agentActionLog: { record: jest.Mock };
  let writePipeline: { run: jest.Mock };

  beforeEach(() => {
    agentActionLog = {
      record: jest.fn().mockResolvedValue({ id: 'log-1', traceId: 'trace-1' }),
    };
    writePipeline = { run: jest.fn() };
    const pendingActionExecutors = {
      resolve: jest.fn().mockReturnValue({
        actionType: 'workshop_order.create',
        buildPolicyContext: jest.fn().mockResolvedValue({}),
        execute: jest.fn(),
        buildResultSummary: jest.fn(),
      }),
    };
    const unused = {} as never;

    handler = new McpToolHandlerService(
      agentActionLog as unknown as AgentActionLogService,
      unused,
      unused,
      unused,
      unused,
      unused,
      writePipeline as unknown as McpWritePipelineService,
      unused,
      unused,
      unused,
      unused,
      pendingActionExecutors as unknown as PendingActionExecutorService,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
    );
  });

  it('logs a schema-invalid draft_workshop_order as FAILED with NOT_EVALUATED, never PROPOSE', async () => {
    await handler.recordInvalidWriteArguments(
      'draft_workshop_order',
      draftWithDraftStatus,
      context,
    );

    expect(agentActionLog.record).toHaveBeenCalledTimes(1);
    expect(agentActionLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'AGENT',
        agentId: 'agent-1',
        onBehalfOfUserId: 'user-1',
        actionType: 'mcp.draft_workshop_order',
        tier: 'NOT_EVALUATED',
        status: 'FAILED',
      }),
    );
    expect(writePipeline.run).not.toHaveBeenCalled();
  });

  it('rejects schema-invalid write input before the policy pipeline and logs it as FAILED NOT_EVALUATED', async () => {
    await expect(
      handler.executeTool('draft_workshop_order', draftWithDraftStatus, context),
    ).rejects.toBeInstanceOf(ZodError);

    expect(agentActionLog.record).toHaveBeenCalledTimes(1);
    expect(agentActionLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'mcp.draft_workshop_order',
        tier: 'NOT_EVALUATED',
        status: 'FAILED',
      }),
    );
    expect(writePipeline.run).not.toHaveBeenCalled();
  });

  it('writes no invalid-input row for schema-valid write input', async () => {
    await handler.recordInvalidWriteArguments(
      'draft_workshop_order',
      validDraft,
      context,
    );

    expect(agentActionLog.record).not.toHaveBeenCalled();
  });

  it('hands schema-valid write input to the policy pipeline and returns the tier it reports', async () => {
    writePipeline.run.mockResolvedValue({
      tool: 'draft_workshop_order',
      tier: 'AUTO',
      status: 'executed',
      would_change: [],
    });

    const result = await handler.executeTool(
      'draft_workshop_order',
      validDraft,
      context,
    );

    expect(writePipeline.run).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'draft_workshop_order',
        policyActionType: 'workshop_order.create',
      }),
      expect.objectContaining({
        vehicle_id: validDraft.vehicle_id,
        status: 'SCHEDULED',
      }),
      context,
    );
    expect(result).toMatchObject({ tier: 'AUTO', status: 'executed' });
    expect(agentActionLog.record).not.toHaveBeenCalled();
  });
});
