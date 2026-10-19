import { ForbiddenException } from '@nestjs/common';
import { ZodError } from 'zod';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { McpToolHandlerWave2Wrapper } from './mcp-tool-handler.wave2-wrapper.js';
import { McpToolHandlerComplianceWrapper } from './mcp-tool-handler.compliance-wrapper.js';
import type { McpWave2ReadFacade } from './mcp-wave2-read.facade.js';
import {
  HANDLER_SPEC_CONTEXT,
  HANDLER_SPEC_EMPTY_PAGE,
  expectAutoReadRecorded,
  handlerSpecActionLog,
} from './mcp-tool-handler.spec.support.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import { createMcpReadToolServiceForTest } from './mcp-read-tool.service.spec.support.js';
import type { McpWritePipelineService } from './mcp-write-pipeline.service.js';

const ORDER_ID = '00000000-0000-4000-8000-0000000000e1';

describe('McpToolHandlerService AUT-615 wave-2 reads', () => {
  const context = HANDLER_SPEC_CONTEXT;
  const emptyPage = { ...HANDLER_SPEC_EMPTY_PAGE, meta: { page_size: 10, next_cursor: null } };

  let handler: McpToolHandlerWave2Wrapper;
  let agentActionLog: { record: jest.Mock };
  let wave2Reads: {
    listLoanerBookings: jest.Mock;
    listEstimates: jest.Mock;
    listOrderCommunications: jest.Mock;
    getCheckIn: jest.Mock;
    getStaffAvailability: jest.Mock;
  };

  beforeEach(() => {
    agentActionLog = handlerSpecActionLog();
    wave2Reads = {
      listLoanerBookings: jest.fn().mockResolvedValue(emptyPage),
      listEstimates: jest.fn().mockResolvedValue(emptyPage),
      listOrderCommunications: jest.fn().mockResolvedValue(emptyPage),
      getCheckIn: jest.fn().mockResolvedValue({ status: 'DRAFT' }),
      getStaffAvailability: jest.fn().mockResolvedValue({ employees: [] }),
    };
    const unused = {} as never;
    const coreHandler = new McpToolHandlerService(
      agentActionLog as unknown as AgentActionLogService,
      {} as unknown as McpWritePipelineService,
      unused,
      createMcpReadToolServiceForTest(),
    );
    const compliance = new McpToolHandlerComplianceWrapper(
      coreHandler,
      agentActionLog as unknown as AgentActionLogService,
      unused,
    );
    handler = new McpToolHandlerWave2Wrapper(
      compliance,
      agentActionLog as unknown as AgentActionLogService,
      wave2Reads as unknown as McpWave2ReadFacade,
    );
  });

  it.each([
    ['list_loaner_bookings', { overdueOnly: true }, 'listLoanerBookings'],
    ['list_estimates', { customerId: ORDER_ID }, 'listEstimates'],
    ['list_order_communications', { orderId: ORDER_ID }, 'listOrderCommunications'],
    ['get_check_in', { orderId: ORDER_ID }, 'getCheckIn'],
    ['get_staff_availability', {}, 'getStaffAvailability'],
  ] as const)(
    'records %s as an AUTO agent action row',
    async (toolName, args, method) => {
      const result = await handler.executeTool(toolName, args, context);
      expectAutoReadRecorded(agentActionLog, toolName, args);
      expect(wave2Reads[method]).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    },
  );

  it('rejects page size above 25 before any read', async () => {
    await expect(
      handler.executeTool('list_estimates', { pageSize: 26 }, context),
    ).rejects.toBeInstanceOf(ZodError);
    expect(wave2Reads.listEstimates).not.toHaveBeenCalled();
  });

  it('surfaces MCP not_permitted from get_staff_availability', async () => {
    wave2Reads.getStaffAvailability.mockRejectedValue(
      new ForbiddenException({
        code: 'not_permitted',
        message: 'Tenant admin access is required.',
      }),
    );
    await expect(
      handler.executeTool('get_staff_availability', {}, context),
    ).rejects.toMatchObject({
      response: { code: 'not_permitted' },
    });
  });
});
