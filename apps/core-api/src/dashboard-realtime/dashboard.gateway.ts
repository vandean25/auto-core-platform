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
  AUTH_CLAIMS_UPDATED_EVENT,
  AuthClaimsUpdatedPayload,
  DASHBOARD_ENTITY_UPDATED_EVENT,
  DashboardEntityUpdatedPayload,
} from './dashboard-events.types';
import type { IncomingHttpHeaders } from 'node:http';

const setupLogger = new Logger('DashboardGatewaySetup');
const DEVELOPMENT_DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export function resolveCorsOrigins(
  frontendUrl = process.env.FRONTEND_URL,
  nodeEnv = process.env.NODE_ENV,
): string[] {
  const configuredOrigins = frontendUrl
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!configuredOrigins || configuredOrigins.length === 0) {
    if (nodeEnv === 'production') {
      throw new Error(
        'CRITICAL: Starting the server without FRONTEND_URL is a critical misconfiguration. It must contain the allowed frontend origin(s) for the dashboard-realtime gateway.',
      );
    }

    setupLogger.warn(
      `WARNING: CORS origins are empty because FRONTEND_URL is not set. Falling back to development origins: ${DEVELOPMENT_DEFAULT_ORIGINS.join(', ')}`,
    );
    return DEVELOPMENT_DEFAULT_ORIGINS;
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
  private static readonly TENANT_ROOM_PREFIX = 'tenant_';
  private static readonly USER_ROOM_PREFIX = 'user_';

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
        client.disconnect(true);
        return;
      }

      const normalizedToken = token.trim();

      // Prepend 'Bearer ' if not present to satisfy authenticateBearerToken
      const authHeader = normalizedToken.startsWith('Bearer ')
        ? normalizedToken
        : `Bearer ${normalizedToken}`;
      const user = await this.authService.authenticateBearerToken(authHeader);

      const tenantRoom = `${DashboardGateway.TENANT_ROOM_PREFIX}${user.tenantId}`;
      const userRoom = `${DashboardGateway.USER_ROOM_PREFIX}${user.userId}`;
      client.data.tenantId = user.tenantId;
      client.data.userId = user.userId;
      await client.join(tenantRoom);
      await client.join(userRoom);
      this.logger.debug(
        `Client authenticated and joined rooms: ${tenantRoom}, ${userRoom} (Socket ID: ${client.id})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `Unauthorized: Invalid token (Socket ID: ${client.id}): ${message}`,
      );
      client.disconnect(true);
    }
  }

  emitEntityUpdated(
    tenantId: string,
    payload: DashboardEntityUpdatedPayload,
  ): void {
    if (!this.server) {
      this.logger.debug(
        `Skipped emitting ${DASHBOARD_ENTITY_UPDATED_EVENT}: ${payload.type}/${payload.action} (No server connected)`.trim(),
      );
      return;
    }
    const room = `${DashboardGateway.TENANT_ROOM_PREFIX}${tenantId}`;
    // Emit only to the specific tenant's room
    this.server.to(room).emit(DASHBOARD_ENTITY_UPDATED_EVENT, payload);
    this.logger.debug(
      `Emitted ${DASHBOARD_ENTITY_UPDATED_EVENT} to room ${room}: ${payload.type}/${payload.action} ${payload.entityId ?? ''}`.trim(),
    );
  }

  emitClaimsUpdated(
    firebaseUid: string,
    payload: AuthClaimsUpdatedPayload,
  ): void {
    if (!this.server) {
      this.logger.debug(
        `Skipped emitting ${AUTH_CLAIMS_UPDATED_EVENT}: ${payload.reason} (No server connected)`.trim(),
      );
      return;
    }

    const room = `${DashboardGateway.USER_ROOM_PREFIX}${firebaseUid}`;
    this.server.to(room).emit(AUTH_CLAIMS_UPDATED_EVENT, payload);
    this.logger.debug(
      `Emitted ${AUTH_CLAIMS_UPDATED_EVENT} to room ${room}: ${payload.reason}`.trim(),
    );
  }
}
