import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { INestApplication } from '@nestjs/common';

export function mcpHttpUrl(app: INestApplication): string {
  const address = app.getHttpServer().address();
  const port =
    typeof address === 'object' && address !== null && 'port' in address
      ? address.port
      : 0;
  return `http://127.0.0.1:${port}/api/mcp`;
}

export async function connectMcpHttpClient(
  app: INestApplication,
  authHeader: string,
  clientName: string,
): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport;
}> {
  const transport = new StreamableHTTPClientTransport(
    new URL(mcpHttpUrl(app)),
    {
      requestInit: { headers: { Authorization: authHeader } },
    },
  );
  const client = new Client(
    { name: clientName, version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);
  return { client, transport };
}

export async function closeMcpHttpClient(
  transport: StreamableHTTPClientTransport,
): Promise<void> {
  try {
    if (transport.sessionId) {
      await transport.terminateSession();
    }
  } finally {
    await transport.close();
  }
}

export function mcpToolPayloadText(result: CallToolResult): string {
  const textPart = result.content?.find(
    (entry) => entry.type === 'text' && 'text' in entry,
  );
  return typeof textPart?.text === 'string' ? textPart.text : '';
}
