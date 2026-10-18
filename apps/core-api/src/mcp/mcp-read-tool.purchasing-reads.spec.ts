import { ZodError } from 'zod';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { McpPurchasingReadService } from './mcp-purchasing-read.service.js';
import { McpReadToolService } from './mcp-read-tool.service.js';
import {
  HANDLER_SPEC_CONTEXT,
  HANDLER_SPEC_EMPTY_PAGE,
  expectAutoReadRecorded,
  handlerSpecActionLog,
} from './mcp-tool-handler.spec.support.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import type { McpWritePipelineService } from './mcp-write-pipeline.service.js';

const ORDER_ID = '00000000-0000-4000-8000-0000000000e1';
const VENDOR_ID = '00000000-0000-4000-8000-0000000000f1';
const PART_ID = '00000000-0000-4000-8000-0000000000c1';

describe('McpToolHandlerService purchasing reads', () => {
  const context = HANDLER_SPEC_CONTEXT;
  const emptyPage = HANDLER_SPEC_EMPTY_PAGE;

  let handler: McpToolHandlerService;
  let agentActionLog: { record: jest.Mock };
  let purchasingReads: {
    listPurchaseOrders: jest.Mock;
    getPurchaseOrder: jest.Mock;
    listVendors: jest.Mock;
  };

  beforeEach(() => {
    agentActionLog = handlerSpecActionLog();
    purchasingReads = {
      listPurchaseOrders: jest.fn().mockResolvedValue(emptyPage),
      listVendors: jest.fn().mockResolvedValue(emptyPage),
      getPurchaseOrder: jest.fn().mockResolvedValue({ id: ORDER_ID }),
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
      purchasingReads as unknown as McpPurchasingReadService,
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

  it.each([
    ['list_purchase_orders', { status: 'SENT' }, 'listPurchaseOrders'],
    ['get_purchase_order', { id: ORDER_ID }, 'getPurchaseOrder'],
    ['list_vendors', {}, 'listVendors'],
  ] as const)(
    'records %s as an AUTO agent action row and returns the read result',
    async (toolName, args, method) => {
      const result = await handler.executeTool(toolName, args, context);

      expectAutoReadRecorded(agentActionLog, toolName, args);
      expect(purchasingReads[method]).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    },
  );

  it('passes the parsed purchase order filters and cursor to the read service', async () => {
    await handler.executeTool(
      'list_purchase_orders',
      {
        status: 'PARTIAL',
        vendor_id: VENDOR_ID,
        part_id: PART_ID,
        from: '2026-09-01',
        to: '2026-09-30',
        pageSize: 5,
      },
      context,
    );

    expect(purchasingReads.listPurchaseOrders).toHaveBeenCalledWith({
      status: 'PARTIAL',
      vendor_id: VENDOR_ID,
      part_id: PART_ID,
      from: '2026-09-01',
      to: '2026-09-30',
      pageSize: 5,
    });
  });

  it('passes the parsed vendor page size and cursor to the read service', async () => {
    await handler.executeTool('list_vendors', { pageSize: 25 }, context);

    expect(purchasingReads.listVendors).toHaveBeenCalledWith({ pageSize: 25 });
  });

  it.each([
    ['list_purchase_orders', { pageSize: 26 }],
    ['list_purchase_orders', { status: 'CANCELLED' }],
    ['list_purchase_orders', { vendor_id: 'Musterlieferant' }],
    ['list_purchase_orders', { part_id: 'FILTER-DEMO-01' }],
    ['list_purchase_orders', { from: '2026-10-10', to: '2026-10-01' }],
    ['list_purchase_orders', { cursor: 'not-a-cursor' }],
    ['get_purchase_order', { id: 'PO-2026-0007' }],
    ['get_purchase_order', {}],
    ['list_vendors', { pageSize: 26 }],
    ['list_vendors', { pageSize: 0 }],
    ['list_vendors', { cursor: 'not-a-cursor' }],
  ] as const)('rejects %s with %j before any read', async (toolName, args) => {
    await expect(
      handler.executeTool(toolName, args, context),
    ).rejects.toBeInstanceOf(ZodError);
    expect(purchasingReads.listPurchaseOrders).not.toHaveBeenCalled();
    expect(purchasingReads.getPurchaseOrder).not.toHaveBeenCalled();
    expect(purchasingReads.listVendors).not.toHaveBeenCalled();
  });
});
