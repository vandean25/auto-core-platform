import { ZodError } from 'zod';
import type { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type { McpDocumentReadService } from './mcp-document-read.service.js';
import type { McpOrderHistoryReadService } from './mcp-order-history-read.service.js';
import { McpReadToolService } from './mcp-read-tool.service.js';
import {
  McpToolHandlerService,
  type McpToolCallContext,
} from './mcp-tool-handler.service.js';
import type { McpWritePipelineService } from './mcp-write-pipeline.service.js';

const RECORD_ID = '00000000-0000-4000-8000-0000000000f1';
const DOCUMENT_ID = `invoice:${RECORD_ID}`;
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const VEHICLE_ID = '00000000-0000-4000-8000-0000000000d1';
const SIGNED_URL =
  'https://storage.example.test/bucket/invoice-RE-2026-1001.pdf?X-Goog-Signature=secret-signature';

const PDF_RESULT = {
  id: DOCUMENT_ID,
  type: 'invoice',
  name: 'invoice-RE-2026-1001.pdf',
  created_at: '2026-10-10T09:00:00.000Z',
  entity: { type: 'invoice', id: RECORD_ID },
  content_type: 'application/pdf',
  link: { url: SIGNED_URL, expires_at: '2026-10-10T09:15:00.000Z' },
};

describe('McpToolHandlerService documents and history reads', () => {
  const context: McpToolCallContext = {
    agentId: 'mcp:cursor',
    onBehalfOfUserId: '00000000-0000-4000-8000-0000000000b1',
  };
  const unused = {} as never;

  let handler: McpToolHandlerService;
  let agentActionLog: { record: jest.Mock };
  let orderHistoryReads: {
    getCustomer: jest.Mock;
    getVehicleHistory: jest.Mock;
  };
  let documentReads: { listDocuments: jest.Mock; getDocumentPdf: jest.Mock };

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
    orderHistoryReads = {
      getCustomer: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }),
      getVehicleHistory: jest
        .fn()
        .mockResolvedValue({ vehicle: { id: VEHICLE_ID } }),
    };
    documentReads = {
      listDocuments: jest.fn().mockResolvedValue({
        data: [],
        meta: { page_size: 25, next_cursor: null },
        truncated: false,
      }),
      getDocumentPdf: jest.fn().mockResolvedValue(PDF_RESULT),
    };

    const readTools = new McpReadToolService(
      unused,
      unused,
      unused,
      unused,
      unused,
      orderHistoryReads as unknown as McpOrderHistoryReadService,
      documentReads as unknown as McpDocumentReadService,
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
      'get_customer',
      { customer_id: CUSTOMER_ID },
      'orderHistoryReads',
      'getCustomer',
    ],
    [
      'get_vehicle_history',
      { vehicle_id: VEHICLE_ID, orders_page_size: 5 },
      'orderHistoryReads',
      'getVehicleHistory',
    ],
    [
      'list_documents',
      { entity_type: 'customer', entity_id: CUSTOMER_ID, pageSize: 5 },
      'documentReads',
      'listDocuments',
    ],
    [
      'get_document_pdf',
      { id: DOCUMENT_ID },
      'documentReads',
      'getDocumentPdf',
    ],
  ] as const)(
    'records %s as an AUTO agent action and routes it to its read service',
    async (toolName, args, service, method) => {
      const services = { orderHistoryReads, documentReads };

      await handler.executeTool(toolName, args, context);

      expect(agentActionLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'AGENT',
          agentId: context.agentId,
          onBehalfOfUserId: context.onBehalfOfUserId,
          actionType: `mcp.${toolName}`,
          tier: 'AUTO',
          status: 'EXECUTED',
          inputSummary: { tool: toolName, args },
        }),
        expect.any(Function),
      );
      expect(
        (services[service] as Record<string, jest.Mock>)[method],
      ).toHaveBeenCalledTimes(1);
    },
  );

  it('returns the link to the caller, and logs only the document and its expiry', async () => {
    const result = await handler.executeTool(
      'get_document_pdf',
      { id: DOCUMENT_ID },
      context,
    );

    expect(result).toEqual(PDF_RESULT);
    const input = agentActionLog.record.mock.calls[0][0] as {
      resultSummary: (value: unknown) => unknown;
    };
    const summary = input.resultSummary(PDF_RESULT);
    expect(summary).toEqual({
      document_id: DOCUMENT_ID,
      document_type: 'invoice',
      entity: { type: 'invoice', id: RECORD_ID },
      link_expires_at: '2026-10-10T09:15:00.000Z',
    });
    expect(JSON.stringify(summary)).not.toContain('X-Goog-Signature');
    expect(JSON.stringify(summary)).not.toContain(SIGNED_URL);
  });

  it('keeps the default log summary for the other read tools', async () => {
    await handler.executeTool(
      'list_documents',
      { entity_type: 'customer', entity_id: CUSTOMER_ID },
      context,
    );

    const input = agentActionLog.record.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(input).not.toHaveProperty('resultSummary');
  });

  it('rejects a document ID that is not <type>:<uuid> before any lookup', async () => {
    await expect(
      handler.executeTool('get_document_pdf', { id: 'invoice:123' }, context),
    ).rejects.toBeInstanceOf(ZodError);
    expect(documentReads.getDocumentPdf).not.toHaveBeenCalled();
  });

  it('rejects an entity filter without its ID before any lookup', async () => {
    await expect(
      handler.executeTool(
        'list_documents',
        { entity_type: 'customer' },
        context,
      ),
    ).rejects.toBeInstanceOf(ZodError);
    expect(documentReads.listDocuments).not.toHaveBeenCalled();
  });

  it('rejects a document page larger than 25 rows before any lookup', async () => {
    await expect(
      handler.executeTool('list_documents', { pageSize: 26 }, context),
    ).rejects.toBeInstanceOf(ZodError);
    expect(documentReads.listDocuments).not.toHaveBeenCalled();
  });
});
