import {
  Inject,
  Logger,
  Optional,
  forwardRef,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
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
export class DashboardGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(DashboardGateway.name);
  private static readonly TENANT_ROOM_PREFIX = 'tenant_';
  private static readonly USER_ROOM_PREFIX = 'user_';

  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    @Optional()
    private readonly redisUrl: string | undefined = process.env.REDIS_URL,
  ) {}

  @WebSocketServer()
  server!: Server;

  afterInit(server: Server) {
    if (this.redisUrl && this.redisUrl.trim().length > 0) {
      try {
        const pubClient = new Redis(this.redisUrl.trim());
        const subClient = pubClient.duplicate();

        pubClient.on('error', (err) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Redis pub client error: ${message}`,
            err instanceof Error ? err.stack : undefined,
          );
        });

        subClient.on('error', (err) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Redis sub client error: ${message}`,
            err instanceof Error ? err.stack : undefined,
          );
        });

        server.adapter(createAdapter(pubClient, subClient));
        this.pubClient = pubClient;
        this.subClient = subClient;
        this.logger.log(
          'Attached Redis adapter to Socket.IO for cross-instance fan-out.',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to initialize Socket.IO Redis adapter: ${message}`,
        );
      }
    }

    server.use((socket, next) => {
      void (async () => {
        try {
          const auth = socket.handshake.auth as
            Record<string, unknown> | undefined;
          const token = auth?.token;
          if (typeof token !== 'string' || token.trim().length === 0) {
            this.logger.debug(
              JSON.stringify({
                type: 'ws_auth_failed',
                socketId: socket.id,
                reason: 'No token provided',
              }),
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
            JSON.stringify({
              type: 'ws_auth_failed',
              socketId: socket.id,
              reason: message,
            }),
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
      JSON.stringify({
        type: 'ws_connect',
        socketId: client.id,
        tenantId: data.tenantId,
        userId: data.userId,
      }),
    );
  }

  handleDisconnect(client: Socket) {
    const data = (client.data ?? {}) as Record<string, string | undefined>;
    this.logger.debug(
      JSON.stringify({
        type: 'ws_disconnect',
        socketId: client.id,
        ...(data.tenantId ? { tenantId: data.tenantId } : {}),
        ...(data.userId ? { userId: data.userId } : {}),
      }),
    );
  }

  emitEntityUpdated(
    tenantId: string,
    payload: DashboardEntityUpdatedPayload,
  ): void {
    if (!this.server) {
      this.logger.debug(
        JSON.stringify({
          type: 'ws_emit_skipped',
          event: DASHBOARD_ENTITY_UPDATED_EVENT,
          entityType: payload.type,
          action: payload.action,
          reason: 'No server connected',
        }),
      );
      return;
    }
    const room = `${DashboardGateway.TENANT_ROOM_PREFIX}${tenantId}`;
    // Emit only to the specific tenant's room
    this.server.to(room).emit(DASHBOARD_ENTITY_UPDATED_EVENT, payload);
    this.logger.debug(
      JSON.stringify({
        type: 'ws_emit',
        event: DASHBOARD_ENTITY_UPDATED_EVENT,
        room,
        entityType: payload.type,
        action: payload.action,
        ...(payload.entityId ? { entityId: payload.entityId } : {}),
      }),
    );
  }

  emitClaimsUpdated(
    firebaseUid: string,
    payload: AuthClaimsUpdatedPayload,
  ): void {
    if (!this.server) {
      this.logger.debug(
        JSON.stringify({
          type: 'ws_emit_skipped',
          event: AUTH_CLAIMS_UPDATED_EVENT,
          reason: 'No server connected',
        }),
      );
      return;
    }

    const room = `${DashboardGateway.USER_ROOM_PREFIX}${firebaseUid}`;
    this.server.to(room).emit(AUTH_CLAIMS_UPDATED_EVENT, payload);
    this.logger.debug(
      JSON.stringify({
        type: 'ws_emit',
        event: AUTH_CLAIMS_UPDATED_EVENT,
        room,
        claimReason: payload.reason,
      }),
    );
  }

  async onModuleDestroy() {
    if (this.pubClient) {
      await this.pubClient.quit().catch(() => {});
    }
    if (this.subClient) {
      await this.subClient.quit().catch(() => {});
    }
  }
}
