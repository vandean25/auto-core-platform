import { Inject, Logger, forwardRef } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from '../auth/auth.service';
import {
  DASHBOARD_ENTITY_UPDATED_EVENT,
  DashboardEntityUpdatedPayload,
} from './dashboard-events.types';
import type { IncomingHttpHeaders } from 'node:http';

const setupLogger = new Logger('DashboardGatewaySetup');

function resolveCorsOrigins(): string[] {
  const configuredOrigins = process.env.FRONTEND_URL?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!configuredOrigins || configuredOrigins.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CRITICAL: Starting the server without FRONTEND_URL is a critical misconfiguration. It must contain the allowed frontend origin(s) for the dashboard-realtime gateway.',
      );
    }
    setupLogger.warn(
      'WARNING: CORS origins are empty because FRONTEND_URL is not set. No browser origins will be allowed to connect via WebSocket.',
    );
    return [];
  }

  return configuredOrigins;
}

const allowedOrigins = resolveCorsOrigins();

@Public()
@WebSocketGateway({
  namespace: '/dashboard-realtime',
  path: '/api/socket.io',
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  allowRequest: (
    req: { headers: IncomingHttpHeaders },
    callback: (err: string | null, success: boolean) => void,
  ) => {
    // If the server is severely misconfigured and has no allowed origins,
    // we must fail completely closed, regardless of the client type.
    if (allowedOrigins.length === 0) {
      return callback(null, false);
    }

    const originHeader = (req.headers as Record<string, unknown>).origin;
    const origin =
      typeof originHeader === 'string'
        ? originHeader
        : Array.isArray(originHeader) && typeof originHeader[0] === 'string'
          ? originHeader[0]
          : undefined;

    // As this is a @Public() gateway, permitting connections without an Origin header
    // provides a bypass for custom Socket.IO clients. We must enforce the Origin header.
    if (!origin) {
      return callback(null, false);
    }

    // Check if the origin is in our allowed list
    const isAllowed = allowedOrigins.includes(origin);
    callback(null, isAllowed);
  },
})
export class DashboardGateway implements OnGatewayConnection {
  private readonly logger = new Logger(DashboardGateway.name);

  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  @WebSocketServer()
  server!: Server;

  async handleConnection(client: Socket) {
    try {
      const auth = client.handshake.auth as Record<string, unknown> | undefined;
      const token = auth?.token;
      if (typeof token !== 'string' || token.trim().length === 0) {
        this.logger.debug(
          `Unauthorized: No token provided (Socket ID: ${client.id})`,
        );
        client.disconnect();
        return;
      }

      const normalizedToken = token.trim();

      // Prepend 'Bearer ' if not present to satisfy authenticateBearerToken
      const authHeader = normalizedToken.startsWith('Bearer ')
        ? normalizedToken
        : `Bearer ${normalizedToken}`;
      const user = await this.authService.authenticateBearerToken(authHeader);

      await client.join(user.tenantId);
      this.logger.debug(
        `Client authenticated and joined room: ${user.tenantId} (Socket ID: ${client.id})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `Unauthorized: Invalid token (Socket ID: ${client.id}): ${message}`,
      );
      client.disconnect();
    }
  }

  emitEntityUpdated(payload: DashboardEntityUpdatedPayload): void {
    if (!this.server) {
      this.logger.debug(
        `Skipped emitting ${DASHBOARD_ENTITY_UPDATED_EVENT}: ${payload.type}/${payload.action} (No server connected)`.trim(),
      );
      return;
    }
    // Emit only to the specific tenant's room
    this.server
      .to(payload.tenantId)
      .emit(DASHBOARD_ENTITY_UPDATED_EVENT, payload);
    this.logger.debug(
      `Emitted ${DASHBOARD_ENTITY_UPDATED_EVENT} to room ${payload.tenantId}: ${payload.type}/${payload.action} ${payload.entityId ?? ''}`.trim(),
    );
  }
}
