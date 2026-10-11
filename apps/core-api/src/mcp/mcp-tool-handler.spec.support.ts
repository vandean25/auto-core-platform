import type { McpToolCallContext } from './mcp-tool-handler.service.js';

/** The caller context the handler read specs share. */
export const HANDLER_SPEC_CONTEXT: McpToolCallContext = {
  agentId: 'mcp:cursor',
  onBehalfOfUserId: '00000000-0000-4000-8000-0000000000b1',
};

/** An empty list page in the shape every list read returns. */
export const HANDLER_SPEC_EMPTY_PAGE = {
  data: [],
  meta: { page_size: 10, next_cursor: null },
  truncated: false,
};

/** An action-log stub that runs the logged work and returns its result, as the real service does. */
export function handlerSpecActionLog(): { record: jest.Mock } {
  return {
    record: jest.fn(async (_input: unknown, work: () => Promise<unknown>) => ({
      id: 'log-1',
      traceId: '6f1c2b7e-3d4a-4b8e-9c2d-1a2b3c4d5e6f',
      workResult: await work(),
    })),
  };
}

/** Asserts the AUTO agent action row that a read tool writes for one call. */
export function expectAutoReadRecorded(
  actionLog: { record: jest.Mock },
  toolName: string,
  args: unknown,
): void {
  expect(actionLog.record).toHaveBeenCalledWith(
    expect.objectContaining({
      actorType: 'AGENT',
      agentId: HANDLER_SPEC_CONTEXT.agentId,
      onBehalfOfUserId: HANDLER_SPEC_CONTEXT.onBehalfOfUserId,
      actionType: `mcp.${toolName}`,
      tier: 'AUTO',
      status: 'EXECUTED',
      inputSummary: { tool: toolName, args },
    }),
    expect.any(Function),
  );
}
