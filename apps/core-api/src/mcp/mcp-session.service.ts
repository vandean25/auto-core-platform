import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.js';
import { MCP_MAX_OPEN_SESSIONS } from './mcp.constants.js';
import {
  createMcpServer,
  type McpServerSessionContext,
} from './mcp-server.factory.js';
import {
  formatMcpAgentId,
  resolveMcpClientNameFromInitializeBody,
} from './mcp-agent-id.util.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import { respondMcpSessionNotFound } from './mcp-session.util.js';

const MCP_IDLE_SESSION_MS = 30 * 60 * 1000;
const MCP_SESSION_SWEEP_MS = 60_000;

type McpSessionRecord = {
  transport: StreamableHTTPServerTransport;
  context: McpServerSessionContext;
  ownerUserId: string;
  ownerTenantId: string;
  lastActiveMs: number;
};

@Injectable()
export class McpSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpSessionService.name);
  private readonly sessions = new Map<string, McpSessionRecord>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly toolHandler: McpToolHandlerService) {}

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => {
      this.purgeIdleSessions(MCP_IDLE_SESSION_MS);
    }, MCP_SESSION_SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  async handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<void> {
    const tenantId = user.tenantId;
    if (!tenantId) {
      respondMcpSessionNotFound(res);
      return;
    }

    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId =
      typeof sessionIdHeader === 'string' ? sessionIdHeader : undefined;

    const session = sessionId ? this.sessions.get(sessionId) : undefined;

    if (session && !this.sessionOwnedByUser(session, user.userId, tenantId)) {
      respondMcpSessionNotFound(res);
      return;
    }

    if (!session && isInitializeRequest(body)) {
      if (this.sessions.size >= MCP_MAX_OPEN_SESSIONS) {
        throw new ServiceUnavailableException('Too many MCP sessions');
      }

      const clientName =
        resolveMcpClientNameFromInitializeBody(body) ?? 'unknown';
      const context: McpServerSessionContext = {
        agentId: formatMcpAgentId(clientName),
        onBehalfOfUserId: user.userId,
      };

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          this.sessions.set(newSessionId, {
            transport,
            context,
            ownerUserId: user.userId,
            ownerTenantId: tenantId,
            lastActiveMs: Date.now(),
          });
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          this.sessions.delete(sid);
        }
      };

      const server = createMcpServer(this.toolHandler, context);
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (!session) {
      if (!res.headersSent) {
        res.statusCode = sessionId ? 404 : 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: sessionId ? -32001 : -32000,
              message: sessionId
                ? 'Session not found'
                : 'Bad Request: initialize the MCP session first',
            },
            id: null,
          }),
        );
      }
      return;
    }

    session.context.onBehalfOfUserId = user.userId;
    session.lastActiveMs = Date.now();
    await this.recordInvalidWriteArguments(body, session.context);
    await session.transport.handleRequest(req, res, body);
  }

  purgeIdleSessions(maxIdleMs: number): void {
    const cutoff = Date.now() - maxIdleMs;
    for (const [id, record] of this.sessions.entries()) {
      if (record.lastActiveMs < cutoff) {
        record.transport.close().catch((error) => {
          this.logger.warn(`Failed to close idle MCP session ${id}: ${error}`);
        });
        this.sessions.delete(id);
      }
    }
  }

  private sessionOwnedByUser(
    session: McpSessionRecord,
    userId: string,
    tenantId: string,
  ): boolean {
    return session.ownerUserId === userId && session.ownerTenantId === tenantId;
  }

  private async recordInvalidWriteArguments(
    body: unknown,
    context: McpServerSessionContext,
  ): Promise<void> {
    const requests = Array.isArray(body) ? body : [body];
    const invalidWriteArgumentChecks = requests.flatMap((requestBody) => {
      if (!isRecord(requestBody) || requestBody.method !== 'tools/call') {
        return [];
      }
      const params = requestBody.params;
      if (!isRecord(params) || typeof params.name !== 'string') {
        return [];
      }
      return [
        this.toolHandler.recordInvalidWriteArguments(
          params.name,
          params.arguments,
          context,
        ),
      ];
    });
    await Promise.all(invalidWriteArgumentChecks);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
