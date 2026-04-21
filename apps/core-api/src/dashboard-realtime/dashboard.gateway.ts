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
  allowRequest: (req, callback) => {
    // If the server is severely misconfigured and has no allowed origins,
    // we must fail completely closed, regardless of the client type.
    if (allowedOrigins.length === 0) {
      return callback(null, false);
    }

    const origin = req.headers.origin;

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
      const token = client.handshake.auth.token;
      if (!token) {
        this.logger.debug(
          `Unauthorized: No token provided (Socket ID: ${client.id})`,
        );
        client.disconnect();
        return;
      }

      // Prepend 'Bearer ' if not present to satisfy authenticateBearerToken
      const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
      const user = await this.authService.authenticateBearerToken(authHeader);

      await client.join(user.tenantId);
      this.logger.debug(
        `Client authenticated and joined room: ${user.tenantId} (Socket ID: ${client.id})`,
      );
    } catch (error) {
      this.logger.debug(
        `Unauthorized: Invalid token (Socket ID: ${client.id}): ${error.message}`,
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
    this.server.to(payload.tenantId).emit(DASHBOARD_ENTITY_UPDATED_EVENT, payload);
    this.logger.debug(
      `Emitted ${DASHBOARD_ENTITY_UPDATED_EVENT} to room ${payload.tenantId}: ${payload.type}/${payload.action} ${payload.entityId ?? ''}`.trim(),
    );
  }
}
