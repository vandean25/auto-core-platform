import { ZodError } from 'zod';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { McpAvailabilityReadService } from './mcp-availability-read.service.js';
import { McpReadToolService } from './mcp-read-tool.service.js';
import {
  HANDLER_SPEC_CONTEXT,
  expectAutoReadRecorded,
  handlerSpecActionLog,
} from './mcp-tool-handler.spec.support.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import type { McpWritePipelineService } from './mcp-write-pipeline.service.js';

const SITE_ID = '00000000-0000-4000-8000-0000000000a9';

/** AUT-512 availability reads routed through the handler. */
describe('McpToolHandlerService AUT-512 availability reads', () => {
  const context = HANDLER_SPEC_CONTEXT;

  let handler: McpToolHandlerService;
  let agentActionLog: { record: jest.Mock };
  let availabilityReads: {
    listWorkshopSlots: jest.Mock;
    listAvailableLoaners: jest.Mock;
  };

  beforeEach(() => {
    agentActionLog = handlerSpecActionLog();
    availabilityReads = {
      listWorkshopSlots: jest.fn().mockResolvedValue({ site_id: SITE_ID }),
      listAvailableLoaners: jest.fn().mockResolvedValue({ site_id: SITE_ID }),
    };
    const unused = {} as never;

    const readTools = new McpReadToolService(
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      availabilityReads as unknown as McpAvailabilityReadService,
    );
    handler = new McpToolHandlerService(
      agentActionLog as unknown as AgentActionLogService,
      {} as unknown as McpWritePipelineService,
      unused,
      readTools,
    );
  });

  it.each([
    [
      'list_workshop_slots',
      {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
        duration_minutes: 60,
      },
      'listWorkshopSlots',
    ],
    [
      'list_available_loaners',
      {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-02T00:00:00.000Z',
      },
      'listAvailableLoaners',
    ],
  ] as const)(
    'records an AUTO read for %s',
    async (toolName, args, delegate) => {
      await handler.executeTool(toolName, args, context);
      expect(availabilityReads[delegate]).toHaveBeenCalledWith(args);
      expectAutoReadRecorded(agentActionLog, toolName, args);
    },
  );

  it('rejects list_workshop_slots without duration_minutes', async () => {
    await expect(
      handler.executeTool(
        'list_workshop_slots',
        {
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-02T00:00:00.000Z',
        },
        context,
      ),
    ).rejects.toBeInstanceOf(ZodError);
    expect(availabilityReads.listWorkshopSlots).not.toHaveBeenCalled();
  });
});
