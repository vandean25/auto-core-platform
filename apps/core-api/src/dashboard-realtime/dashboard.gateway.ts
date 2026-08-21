import {
  Inject,
  Logger,
  forwardRef,
  type OnApplicationBootstrap,
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
import { resolveCorsOrigins } from '../common/http/cors-origins';
import { AuthService } from '../auth/auth.service';
import {
  AUTH_CLAIMS_UPDATED_EVENT,
  AuthClaimsUpdatedPayload,
  DASHBOARD_ENTITY_UPDATED_EVENT,
  DashboardEntityUpdatedPayload,
} from './dashboard-events.types';

export { resolveCorsOrigins } from '../common/http/cors-origins';

export function resolveRedisUrl(
  redisUrl: string | undefined = process.env.REDIS_URL,
): string | undefined {
  const trimmed = redisUrl?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export const REDIS_CONNECT_TIMEOUT_MS = 10_000;

export async function connectRedisClients(
  connect: () => Promise<unknown>,
  timeoutMs = REDIS_CONNECT_TIMEOUT_MS,
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      connect(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Redis connect timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
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
    OnApplicationBootstrap,
    OnModuleDestroy
{
  private readonly logger = new Logger(DashboardGateway.name);
  private static readonly TENANT_ROOM_PREFIX = 'tenant_';
  private static readonly USER_ROOM_PREFIX = 'user_';

  private pubClient?: Redis;
  private subClient?: Redis;
  private redisAdapterReady: Promise<void> = Promise.resolve();

  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  @WebSocketServer()
  server!: Server;

  afterInit(server: Server, redisUrl = resolveRedisUrl()) {
    this.installAuthMiddleware(server);
    if (redisUrl) {
      this.redisAdapterReady = this.attachRedisAdapter(server, redisUrl);
    }
  }

  async onApplicationBootstrap() {
    await this.redisAdapterReady;
  }

  private installAuthMiddleware(server: Server) {
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

  private async attachRedisAdapter(server: Server, redisUrl: string) {
    const pubClient = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    });
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

    try {
      await connectRedisClients(() =>
        Promise.all([pubClient.connect(), subClient.connect()]),
      );

      server.adapter(createAdapter(pubClient, subClient));
      this.pubClient = pubClient;
      this.subClient = subClient;
      this.logger.log(
        'Attached Redis adapter to Socket.IO for cross-instance fan-out.',
      );
    } catch (err) {
      await pubClient.quit().catch(() => {});
      await subClient.quit().catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to initialize Socket.IO Redis adapter: ${message}`,
      );
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          `CRITICAL: Failed to connect to Redis at ${redisUrl} in production: ${message}`,
          { cause: err },
        );
      }
    }
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
