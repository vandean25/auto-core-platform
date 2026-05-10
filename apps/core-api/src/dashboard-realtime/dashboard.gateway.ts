import { Inject, Logger, forwardRef } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayInit,
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
})
export class DashboardGateway implements OnGatewayConnection, OnGatewayInit {
  private readonly logger = new Logger(DashboardGateway.name);
  private static readonly TENANT_ROOM_PREFIX = 'tenant_';
  private static readonly USER_ROOM_PREFIX = 'user_';

  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  @WebSocketServer()
  server!: Server;

  afterInit(server: Server) {
    server.use((socket, next) => {
      void (async () => {
        try {
          const auth = socket.handshake.auth as
            | Record<string, unknown>
            | undefined;
          const token = auth?.token;
          if (typeof token !== 'string' || token.trim().length === 0) {
            this.logger.debug(
              `Unauthorized: No token provided (Socket ID: ${socket.id})`,
            );
            return next(new Error('Unauthorized'));
          }

          const normalizedToken = token.trim();

          // Prepend 'Bearer ' if not present to satisfy authenticateBearerToken
          const authHeader = normalizedToken.startsWith('Bearer ')
            ? normalizedToken
            : `Bearer ${normalizedToken}`;
          const user =
            await this.authService.authenticateBearerToken(authHeader);

          (
            socket as { data: { tenantId?: string; userId?: string } }
          ).data.tenantId = user.tenantId;
          (
            socket as { data: { tenantId?: string; userId?: string } }
          ).data.userId = user.userId;
          next();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.debug(
            `Unauthorized: Invalid token (Socket ID: ${socket.id}): ${message}`,
          );
          next(new Error('Unauthorized'));
        }
      })();
    });
  }

  async handleConnection(client: Socket) {
    const data = client.data as Record<string, string | undefined>;
    const tenantRoom = `${DashboardGateway.TENANT_ROOM_PREFIX}${data.tenantId}`;
    const userRoom = `${DashboardGateway.USER_ROOM_PREFIX}${data.userId}`;
    await client.join(tenantRoom);
    await client.join(userRoom);
    this.logger.debug(
      `Client authenticated and joined rooms: ${tenantRoom}, ${userRoom} (Socket ID: ${client.id})`,
    );
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
