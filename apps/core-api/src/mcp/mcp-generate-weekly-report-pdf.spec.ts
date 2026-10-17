import { ZodError } from 'zod';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { generateWeeklyReportPdfInputSchema } from '../reports/weekly-report/weekly-report-mcp.schema.js';
import {
  HANDLER_SPEC_CONTEXT,
  handlerSpecActionLog,
} from './mcp-tool-handler.spec.support.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import type { McpWritePipelineService } from './mcp-write-pipeline.service.js';

describe('generate_weekly_report_pdf MCP tool', () => {
  const context = HANDLER_SPEC_CONTEXT;
  let handler: McpToolHandlerService;
  let writePipeline: { run: jest.Mock };
  let agentActionLog: { record: jest.Mock };

  beforeEach(() => {
    agentActionLog = handlerSpecActionLog();
    writePipeline = {
      run: jest.fn().mockResolvedValue({
        tool: 'generate_weekly_report_pdf',
        tier: 'AUTO',
        status: 'executed',
        would_change: [],
        result: {
          id: 'report-1',
          url: 'https://storage.example/report.pdf',
          expires_at: '2026-10-17T13:00:00.000Z',
          sha256: 'a'.repeat(64),
          page_count: 2,
          period: {
            from: '2026-10-12',
            to: '2026-10-18',
            timezone: 'Europe/Vienna',
            iso_week: '2026-W42',
          },
        },
        trace_id: 'trace-1',
      }),
    };
    const pendingActionExecutors = {
      resolve: jest.fn(() => ({
        actionType: 'report.generate_weekly_pdf',
        buildPolicyContext: () => Promise.resolve({}),
        execute: jest.fn(),
        buildResultSummary: jest.fn(),
      })),
    };
    handler = new McpToolHandlerService(
      agentActionLog as unknown as AgentActionLogService,
      writePipeline as unknown as McpWritePipelineService,
      pendingActionExecutors as never,
      {} as never,
    );
  });

  it('routes through the write pipeline', async () => {
    const args = { iso_week: '2026-W42' };
    const result = await handler.executeTool(
      'generate_weekly_report_pdf',
      args,
      context,
    );
    expect(writePipeline.run).toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'executed' });
  });

  it('rejects invalid week and conflicting period arguments', () => {
    expect(() =>
      generateWeeklyReportPdfInputSchema.parse({ iso_week: '2026-99' }),
    ).toThrow(ZodError);
    expect(() =>
      generateWeeklyReportPdfInputSchema.parse({
        iso_week: '2026-W42',
        from: '2026-10-12',
        to: '2026-10-18',
      }),
    ).toThrow(ZodError);
  });
});
