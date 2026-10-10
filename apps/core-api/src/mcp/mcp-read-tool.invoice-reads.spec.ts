import { ZodError } from 'zod';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { McpInvoiceReadService } from './mcp-invoice-read.service.js';
import { McpReadToolService } from './mcp-read-tool.service.js';
import {
  HANDLER_SPEC_CONTEXT,
  HANDLER_SPEC_EMPTY_PAGE,
  expectAutoReadRecorded,
  handlerSpecActionLog,
} from './mcp-tool-handler.spec.support.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import type { McpWritePipelineService } from './mcp-write-pipeline.service.js';

const INVOICE_ID = '00000000-0000-4000-8000-0000000000f1';

describe('McpToolHandlerService invoice reads', () => {
  const context = HANDLER_SPEC_CONTEXT;
  const emptyPage = HANDLER_SPEC_EMPTY_PAGE;

  let handler: McpToolHandlerService;
  let agentActionLog: { record: jest.Mock };
  let invoiceReads: { listInvoices: jest.Mock; getInvoice: jest.Mock };

  beforeEach(() => {
    agentActionLog = handlerSpecActionLog();
    invoiceReads = {
      listInvoices: jest.fn().mockResolvedValue(emptyPage),
      getInvoice: jest.fn().mockResolvedValue({ id: INVOICE_ID }),
    };
    const unused = {} as never;

    const readTools = new McpReadToolService(unused, unused, invoiceReads as unknown as McpInvoiceReadService, unused, unused, unused, unused);
    handler = new McpToolHandlerService(
      agentActionLog as unknown as AgentActionLogService,
      {} as unknown as McpWritePipelineService,
      unused,
      readTools,
    );
  });

  it.each([
    ['list_invoices', { status: 'PAID' }, 'listInvoices'],
    ['get_invoice', { invoice_id: INVOICE_ID }, 'getInvoice'],
  ] as const)(
    'records %s as an AUTO agent action row and returns the read result',
    async (toolName, args, method) => {
      const result = await handler.executeTool(toolName, args, context);

      expectAutoReadRecorded(agentActionLog, toolName, args);
      expect(invoiceReads[method]).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    },
  );

  it('passes the parsed list filters and cursor to the invoice read service', async () => {
    await handler.executeTool(
      'list_invoices',
      { status: 'FINALIZED', from: '2026-09-01', to: '2026-09-30', pageSize: 5 },
      context,
    );

    expect(invoiceReads.listInvoices).toHaveBeenCalledWith({
      status: 'FINALIZED',
      from: '2026-09-01',
      to: '2026-09-30',
      pageSize: 5,
    });
  });

  it('rejects a page size above 25 before any read', async () => {
    await expect(
      handler.executeTool('list_invoices', { pageSize: 26 }, context),
    ).rejects.toBeInstanceOf(ZodError);
    expect(invoiceReads.listInvoices).not.toHaveBeenCalled();
  });

  it('rejects a reversed issue-date range before any read', async () => {
    await expect(
      handler.executeTool(
        'list_invoices',
        { from: '2026-10-10', to: '2026-10-01' },
        context,
      ),
    ).rejects.toBeInstanceOf(ZodError);
    expect(invoiceReads.listInvoices).not.toHaveBeenCalled();
  });

  it('rejects an unknown invoice status before any read', async () => {
    await expect(
      handler.executeTool('list_invoices', { status: 'VOID' }, context),
    ).rejects.toBeInstanceOf(ZodError);
    expect(invoiceReads.listInvoices).not.toHaveBeenCalled();
  });

  it('rejects a get_invoice call without a UUID before any read', async () => {
    await expect(
      handler.executeTool('get_invoice', { invoice_id: 'RE-2026-0001' }, context),
    ).rejects.toBeInstanceOf(ZodError);
    expect(invoiceReads.getInvoice).not.toHaveBeenCalled();
  });
});
