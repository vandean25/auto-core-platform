import { ZodError } from 'zod';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { PendingActionExecutorService } from '../pending-action-executor/pending-action-executor.service.js';
import type { McpAuditReadService } from './mcp-audit-read.service.js';
import {
  McpToolHandlerService,
  type McpToolCallContext,
} from './mcp-tool-handler.service.js';
import type { McpWritePipelineService } from './mcp-write-pipeline.service.js';

describe('McpToolHandlerService audit and agent action reads', () => {
  const context: McpToolCallContext = {
    agentId: 'mcp:cursor',
    onBehalfOfUserId: '00000000-0000-4000-8000-0000000000b1',
  };
  const emptyPage = {
    data: [],
    meta: { page_size: 10, next_cursor: null },
    truncated: false,
  };

  let handler: McpToolHandlerService;
  let agentActionLog: { record: jest.Mock };
  let auditReads: {
    listAuditEvents: jest.Mock;
    getEntityHistory: jest.Mock;
    getAgentAction: jest.Mock;
    listAgentActions: jest.Mock;
  };

  beforeEach(() => {
    agentActionLog = {
      record: jest.fn(
        async (_input: unknown, work: () => Promise<unknown>) => ({
          id: 'log-1',
          traceId: '6f1c2b7e-3d4a-4b8e-9c2d-1a2b3c4d5e6f',
          workResult: await work(),
        }),
      ),
    };
    auditReads = {
      listAuditEvents: jest.fn().mockResolvedValue(emptyPage),
      getEntityHistory: jest.fn().mockResolvedValue(emptyPage),
      getAgentAction: jest.fn().mockResolvedValue({
        ...emptyPage,
        trace_id: '6f1c2b7e-3d4a-4b8e-9c2d-1a2b3c4d5e6f',
        audit_entries: [],
        audit_truncated: false,
      }),
      listAgentActions: jest.fn().mockResolvedValue(emptyPage),
    };
    const unused = {} as never;
    const pendingActionExecutors = {} as never;

    handler = new McpToolHandlerService(
      agentActionLog as unknown as AgentActionLogService,
      {} as unknown as McpWritePipelineService,
      pendingActionExecutors,
      unused,
      auditReads as unknown as McpAuditReadService,
      unused,
      unused,
      unused,
    );
  });

  it.each([
    ['list_audit_events', { entity_type: 'Customer' }, 'listAuditEvents'],
    [
      'get_entity_history',
      { entity_type: 'Customer', entity_id: 'cust-1' },
      'getEntityHistory',
    ],
    [
      'get_agent_action',
      { trace_id: '6f1c2b7e-3d4a-4b8e-9c2d-1a2b3c4d5e6f' },
      'getAgentAction',
    ],
    ['list_agent_actions', { tier: 'AUTO' }, 'listAgentActions'],
  ] as const)(
    'records %s as an AUTO agent action row and returns the read result',
    async (toolName, args, method) => {
      const result = await handler.executeTool(toolName, args, context);

      const loggedRow = {
        actorType: 'AGENT',
        agentId: 'mcp:cursor',
        onBehalfOfUserId: context.onBehalfOfUserId,
        actionType: `mcp.${toolName}`,
        tier: 'AUTO',
        status: 'EXECUTED',
        inputSummary: { tool: toolName, args },
      };
      expect(agentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining(loggedRow),
        expect.any(Function),
      );
      expect(result).toMatchObject({ truncated: false });
      expect(auditReads[method]).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a reversed time range inside the logged call, before any read', async () => {
    const reversedRange = { from: '2026-10-10', to: '2026-10-01' };
    const error = await handler
      .executeTool('list_audit_events', reversedRange, context)
      .catch((caught: unknown) => caught);

    expect({
      isZodError: error instanceof ZodError,
      reads: auditReads.listAuditEvents.mock.calls.length,
    }).toEqual({ isZodError: true, reads: 0 });
  });

  it('rejects a page size above 25 before any read', async () => {
    await expect(
      handler.executeTool('list_agent_actions', { pageSize: 26 }, context),
    ).rejects.toBeInstanceOf(ZodError);
    expect(auditReads.listAgentActions).not.toHaveBeenCalled();
  });
});
