import { ZodError } from 'zod';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { McpReportReadService } from './mcp-report-read.service.js';
import type { McpStockReadService } from './mcp-stock-read.service.js';
import { McpReadToolService } from './mcp-read-tool.service.js';
import {
  HANDLER_SPEC_CONTEXT,
  expectAutoReadRecorded,
  handlerSpecActionLog,
} from './mcp-tool-handler.spec.support.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import type { McpWritePipelineService } from './mcp-write-pipeline.service.js';

const VEHICLE_ID = '00000000-0000-4000-8000-0000000000c1';
const SITE_ID = '00000000-0000-4000-8000-0000000000a9';

const EMPTY_RESULT = {
  data: [],
  meta: { total: 0, page_size: 10, next_cursor: null },
};

/** AUT-461 report reads routed through the handler: each is an AUTO read and rejects bad input before any read. */
describe('McpToolHandlerService AUT-461 report reads', () => {
  const context = HANDLER_SPEC_CONTEXT;

  let handler: McpToolHandlerService;
  let agentActionLog: { record: jest.Mock };
  let reportReads: {
    getWorkshopKpiReport: jest.Mock;
    listPickerlDue: jest.Mock;
    getNovaPreview: jest.Mock;
  };
  let stockReads: {
    vehicleStockAgeReport: jest.Mock;
    vehicleStockMarginReport: jest.Mock;
  };

  beforeEach(() => {
    agentActionLog = handlerSpecActionLog();
    reportReads = {
      getWorkshopKpiReport: jest.fn().mockResolvedValue({ site_id: SITE_ID }),
      listPickerlDue: jest.fn().mockResolvedValue(EMPTY_RESULT),
      getNovaPreview: jest.fn().mockResolvedValue({ vehicle_id: VEHICLE_ID }),
    };
    stockReads = {
      vehicleStockAgeReport: jest.fn().mockResolvedValue(EMPTY_RESULT),
      vehicleStockMarginReport: jest.fn().mockResolvedValue(EMPTY_RESULT),
    };
    const unused = {} as never;

    const readTools = new McpReadToolService(
      unused,
      unused,
      unused,
      unused,
      stockReads as unknown as McpStockReadService,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      reportReads as unknown as McpReportReadService,
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
    [
      'get_workshop_kpi_report',
      { from: '2026-10-01', to: '2026-10-31', site_id: SITE_ID },
      'getWorkshopKpiReport',
    ],
    ['list_pickerl_due', { window: 60 }, 'listPickerlDue'],
    [
      'get_nova_preview',
      { vehicle_id: VEHICLE_ID, net_price_eur: '12000.00' },
      'getNovaPreview',
    ],
    [
      'get_vehicle_stock_age_report',
      { from: '2026-07-01', to: '2026-07-31' },
      'vehicleStockAgeReport',
    ],
    [
      'get_vehicle_stock_margin_report',
      { from: '2026-10-01', to: '2026-10-31' },
      'vehicleStockMarginReport',
    ],
  ] as const)(
    'records %s as an AUTO agent action row and returns the read result',
    async (toolName, args, method) => {
      const reads = toolName.startsWith('get_vehicle_stock')
        ? stockReads
        : reportReads;

      const result = await handler.executeTool(toolName, args, context);

      expectAutoReadRecorded(agentActionLog, toolName, args);
      expect(reads[method as keyof typeof reads]).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    },
  );

  it('passes the parsed Pickerl window and page to the read service', async () => {
    await handler.executeTool(
      'list_pickerl_due',
      { window: 90, pageSize: 25 },
      context,
    );

    expect(reportReads.listPickerlDue).toHaveBeenCalledWith({
      window: 90,
      pageSize: 25,
    });
  });

  it('passes the parsed stock-in window, site, and cursor to the stock age report', async () => {
    await handler.executeTool(
      'get_vehicle_stock_age_report',
      {
        from: '2026-07-01',
        to: '2026-07-31',
        site_id: SITE_ID,
        pageSize: 5,
        cursor: 'MjU',
      },
      context,
    );

    expect(stockReads.vehicleStockAgeReport).toHaveBeenCalledWith({
      from: '2026-07-01',
      to: '2026-07-31',
      site_id: SITE_ID,
      pageSize: 5,
      cursor: 'MjU',
    });
  });

  it.each([
    ['list_pickerl_due', { window: 45 }],
    ['list_pickerl_due', { pageSize: 26 }],
    ['list_pickerl_due', { cursor: 'not a cursor!' }],
    [
      'get_nova_preview',
      { vehicle_id: 'vehicle-1', net_price_eur: '12000.00' },
    ],
    ['get_nova_preview', { vehicle_id: VEHICLE_ID, net_price_eur: '12000,00' }],
    ['get_workshop_kpi_report', { from: '2026-10-01' }],
    ['get_workshop_kpi_report', { from: '2026-10-31', to: '2026-10-01' }],
    ['get_vehicle_stock_age_report', { pageSize: 26 }],
    ['get_vehicle_stock_age_report', { from: '2026-07-01' }],
    [
      'get_vehicle_stock_margin_report',
      { from: '2026-10-01', to: '2026-10-31', pageSize: 26 },
    ],
    ['get_vehicle_stock_margin_report', { from: '2026-10-01' }],
  ] as const)('rejects %s with %j before any read', async (toolName, args) => {
    await expect(
      handler.executeTool(toolName, args, context),
    ).rejects.toBeInstanceOf(ZodError);

    expect(reportReads.getWorkshopKpiReport).not.toHaveBeenCalled();
    expect(reportReads.listPickerlDue).not.toHaveBeenCalled();
    expect(reportReads.getNovaPreview).not.toHaveBeenCalled();
    expect(stockReads.vehicleStockAgeReport).not.toHaveBeenCalled();
    expect(stockReads.vehicleStockMarginReport).not.toHaveBeenCalled();
  });
});
