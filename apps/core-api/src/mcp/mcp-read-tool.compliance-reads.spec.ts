import { ForbiddenException } from '@nestjs/common';
import { ZodError } from 'zod';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { McpComplianceReadFacade } from './mcp-compliance-read.facade.js';
import {
  HANDLER_SPEC_CONTEXT,
  expectAutoReadRecorded,
  handlerSpecActionLog,
} from './mcp-tool-handler.spec.support.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import { McpToolHandlerComplianceWrapper } from './mcp-tool-handler.compliance-wrapper.js';
import { createMcpReadToolServiceForTest } from './mcp-read-tool.service.spec.support.js';
import type { McpWritePipelineService } from './mcp-write-pipeline.service.js';

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const ORDER_ID = '00000000-0000-4000-8000-0000000000e1';

const EMPTY_PAGE = {
  data: [],
  meta: { total: 0, page_size: 10, next_cursor: null },
};

describe('McpToolHandlerService AUT-605 compliance reads', () => {
  const context = HANDLER_SPEC_CONTEXT;

  let handler: McpToolHandlerComplianceWrapper;
  let agentActionLog: { record: jest.Mock };
  let complianceReads: {
    checkContactPermission: jest.Mock;
    listGewaehrleistungDue: jest.Mock;
    listTyreSets: jest.Mock;
    listWarrantyClaims: jest.Mock;
  };

  beforeEach(() => {
    agentActionLog = handlerSpecActionLog();
    complianceReads = {
      checkContactPermission: jest.fn().mockResolvedValue({
        customer_id: CUSTOMER_ID,
        purpose: 'ORDER_COMMUNICATION',
        channel: 'EMAIL',
        allowed: true,
        reason: 'ALLOWED',
      }),
      listGewaehrleistungDue: jest.fn().mockResolvedValue({
        within_days: 30,
        ...EMPTY_PAGE,
      }),
      listTyreSets: jest.fn().mockResolvedValue(EMPTY_PAGE),
      listWarrantyClaims: jest.fn().mockResolvedValue(EMPTY_PAGE),
    };
    const unused = {} as never;

    const coreHandler = new McpToolHandlerService(
      agentActionLog as unknown as AgentActionLogService,
      {} as unknown as McpWritePipelineService,
      unused,
      createMcpReadToolServiceForTest(),
    );
    handler = new McpToolHandlerComplianceWrapper(
      coreHandler,
      agentActionLog as unknown as AgentActionLogService,
      complianceReads as unknown as McpComplianceReadFacade,
    );
  });

  it.each([
    [
      'check_contact_permission',
      {
        customer_id: CUSTOMER_ID,
        purpose: 'ORDER_COMMUNICATION',
        channel: 'EMAIL',
      },
      'checkContactPermission',
    ],
    ['list_gewaehrleistung_due', { within_days: 60 }, 'listGewaehrleistungDue'],
    ['list_tyre_sets', { due_for_swap: true }, 'listTyreSets'],
    ['list_warranty_claims', { order_id: ORDER_ID }, 'listWarrantyClaims'],
  ] as const)(
    'records %s as an AUTO agent action row and returns the read result',
    async (toolName, args, method) => {
      const result = await handler.executeTool(toolName, args, context);

      expectAutoReadRecorded(agentActionLog, toolName, args);
      expect(complianceReads[method]).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    },
  );

  it('rejects an invalid Gewährleistung window before any read', async () => {
    await expect(
      handler.executeTool('list_gewaehrleistung_due', { within_days: 45 }, context),
    ).rejects.toBeInstanceOf(ZodError);
    expect(complianceReads.listGewaehrleistungDue).not.toHaveBeenCalled();
  });

  it('rejects a page size above 25 before any read', async () => {
    await expect(
      handler.executeTool('list_tyre_sets', { pageSize: 26 }, context),
    ).rejects.toBeInstanceOf(ZodError);
    expect(complianceReads.listTyreSets).not.toHaveBeenCalled();
  });

  it('surfaces RBAC denial from the compliance read service', async () => {
    complianceReads.listWarrantyClaims.mockRejectedValue(
      new ForbiddenException('restricted'),
    );

    await expect(
      handler.executeTool('list_warranty_claims', {}, context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
