import { ZodError } from 'zod';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { McpRecordReadService } from './mcp-record-read.service.js';
import { McpReadToolService } from './mcp-read-tool.service.js';
import {
  HANDLER_SPEC_CONTEXT,
  HANDLER_SPEC_EMPTY_PAGE,
  expectAutoReadRecorded,
  handlerSpecActionLog,
} from './mcp-tool-handler.spec.support.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import type { McpWritePipelineService } from './mcp-write-pipeline.service.js';

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

describe('McpToolHandlerService workshop order reads', () => {
  const context = HANDLER_SPEC_CONTEXT;
  const emptyPage = {
    ...HANDLER_SPEC_EMPTY_PAGE,
    meta: { total: 0, page: 1, pageSize: 10, pageCount: 0 },
  };

  let handler: McpToolHandlerService;
  let agentActionLog: { record: jest.Mock };
  let recordReads: { listWorkshopOrders: jest.Mock };

  beforeEach(() => {
    agentActionLog = handlerSpecActionLog();
    recordReads = {
      listWorkshopOrders: jest.fn().mockResolvedValue(emptyPage),
    };
    const unused = {} as never;

    const readTools = new McpReadToolService(
      unused,
      unused,
      unused,
      recordReads as unknown as McpRecordReadService,
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
      unused,
    );
    handler = new McpToolHandlerService(
      agentActionLog as unknown as AgentActionLogService,
      {} as unknown as McpWritePipelineService,
      unused,
      readTools,
    );
  });

  it('records list_workshop_orders as an AUTO agent action row and returns the read result', async () => {
    const result = await handler.executeTool(
      'list_workshop_orders',
      { estimate_status: 'SENT' },
      context,
    );

    expectAutoReadRecorded(agentActionLog, 'list_workshop_orders', {
      estimate_status: 'SENT',
    });
    expect(recordReads.listWorkshopOrders).toHaveBeenCalledWith({
      estimate_status: 'SENT',
    });
    expect(result).toBeDefined();
  });

  it('passes parsed filters to the read service', async () => {
    await handler.executeTool(
      'list_workshop_orders',
      {
        status: ['IN_PROGRESS'],
        estimate_status: 'SENT',
        sent_from: '2026-10-16',
        sent_to: '2026-10-16',
        scheduled_from: '2026-10-01',
        scheduled_to: '2026-10-31',
        customer_id: CUSTOMER_ID,
        pageSize: 5,
      },
      context,
    );

    expect(recordReads.listWorkshopOrders).toHaveBeenCalledWith({
      status: ['IN_PROGRESS'],
      estimate_status: 'SENT',
      sent_from: '2026-10-16',
      sent_to: '2026-10-16',
      scheduled_from: '2026-10-01',
      scheduled_to: '2026-10-31',
      customer_id: CUSTOMER_ID,
      pageSize: 5,
    });
  });

  it.each([
    ['list_workshop_orders', { pageSize: 26 }],
    ['list_workshop_orders', { status: [] }],
    ['list_workshop_orders', { estimate_status: 'DRAFT' }],
    ['list_workshop_orders', { sent_from: '2026-10-16' }],
    ['list_workshop_orders', { sent_from: '2026-10-20', sent_to: '2026-10-01' }],
    ['list_workshop_orders', { scheduled_from: '2026-10-31' }],
  ] as const)('rejects %s with %j before any read', async (toolName, args) => {
    await expect(handler.executeTool(toolName, args, context)).rejects.toThrow(
      ZodError,
    );
    expect(recordReads.listWorkshopOrders).not.toHaveBeenCalled();
  });
});
