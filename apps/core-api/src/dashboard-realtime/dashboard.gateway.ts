import {
  Inject,
  Logger,
  Optional,
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
import { TenantContextStorage } from '../common/services/tenant-context.storage';
import { AuthService } from '../auth/auth.service';
import { SiteContextService } from '../site/site-context.service';
import {
  AUTH_CLAIMS_UPDATED_EVENT,
  AuthClaimsUpdatedPayload,
  DASHBOARD_ENTITY_UPDATED_EVENT,
  DashboardEntityUpdatedPayload,
  SITE_ACCESS_SCOPE_UPDATED_EVENT,
  SITE_CONTEXT_UPDATED_EVENT,
  SiteAccessScopeUpdatedPayload,
  SiteContextUpdatedPayload,
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

export function getRootSocketServer(server: unknown): Server | undefined {
  if (!server || typeof server !== 'object') {
    return undefined;
  }
  const candidate = server as Record<string, unknown>;
  if (typeof candidate.adapter === 'function') {
    return candidate as unknown as Server;
  }
  if (
    candidate.server &&
    typeof candidate.server === 'object' &&
    typeof (candidate.server as Record<string, unknown>).adapter === 'function'
  ) {
    return candidate.server as Server;
  }
  return undefined;
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
  private static readonly SITE_ROOM_PREFIX = 'site_';

  private pubClient?: Redis;
  private subClient?: Redis;
  private redisAdapterReady: Promise<void> = Promise.resolve();

  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    @Optional()
    @Inject(forwardRef(() => SiteContextService))
    private readonly siteContext?: SiteContextService,
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

      const rootServer = getRootSocketServer(server);
      if (!rootServer) {
        throw new Error(
          'Socket.IO root Server instance could not be resolved from gateway',
        );
      }

      rootServer.adapter(createAdapter(pubClient, subClient));
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

    // Ruling 37: join `site:{siteId}` for the validated active site (if any).
    // The tenant and private user rooms are unchanged.
    const activeSiteId = await this.resolveSocketActiveSiteId(client);
    if (activeSiteId) {
      await client.join(`${DashboardGateway.SITE_ROOM_PREFIX}${activeSiteId}`);
      data.activeSiteId = activeSiteId;
    }

    this.logger.debug(
      JSON.stringify({
        type: 'ws_connect',
        socketId: client.id,
        tenantId: data.tenantId,
        userId: data.userId,
        ...(activeSiteId ? { activeSiteId } : {}),
      }),
    );
  }

  /**
   * Resolves the socket's validated active site id inside a tenant context so
   * SiteContextService can query tenant-scoped rows. Returns `null` when the
   * user has no valid active site (recovery flow); the connection stays in the
   * tenant + user rooms only.
   */
  private async resolveSocketActiveSiteId(
    client: Socket,
  ): Promise<string | null> {
    const data = client.data as Record<string, string | undefined>;
    const tenantId = data.tenantId;
    const userId = data.userId;
    if (!tenantId || !userId || !this.siteContext) {
      return null;
    }

    return TenantContextStorage.run(() => {
      TenantContextStorage.setUser({
        userId,
        email: '',
        tenantId,
        role: 'member',
      });
      return this.siteContext!.resolveSiteId();
    });
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

  /**
   * Ruling 9/11/37: every socket of `user_{firebaseUid}` leaves the previous
   * site room and joins the new one (or no site room), then the event is
   * delivered on the private user room. The initiating tab is not special —
   * all tabs move so the site room stays an isolation boundary.
   */
  async emitSiteContextUpdated(
    firebaseUid: string,
    payload: SiteContextUpdatedPayload,
  ): Promise<void> {
    if (!this.server) {
      this.logger.debug(
        JSON.stringify({
          type: 'ws_emit_skipped',
          event: SITE_CONTEXT_UPDATED_EVENT,
          reason: 'No server connected',
        }),
      );
      return;
    }

    const room = `${DashboardGateway.USER_ROOM_PREFIX}${firebaseUid}`;
    try {
      const sockets = await this.server.in(room).fetchSockets();
      for (const socket of sockets) {
        const data = socket.data as Record<string, unknown>;
        for (const room of socket.rooms) {
          if (
            room.startsWith(DashboardGateway.SITE_ROOM_PREFIX) &&
            room !==
              (payload.siteId
                ? `${DashboardGateway.SITE_ROOM_PREFIX}${payload.siteId}`
                : undefined)
          ) {
            socket.leave(room);
          }
        }
        if (payload.siteId) {
          socket.join(`${DashboardGateway.SITE_ROOM_PREFIX}${payload.siteId}`);
        }
        data.activeSiteId = payload.siteId ?? null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to move sockets of ${firebaseUid} between site rooms: ${message}`,
      );
    }

    this.server.to(room).emit(SITE_CONTEXT_UPDATED_EVENT, payload);
    this.logger.debug(
      JSON.stringify({
        type: 'ws_emit',
        event: SITE_CONTEXT_UPDATED_EVENT,
        room,
        siteId: payload.siteId,
      }),
    );
  }

  /**
   * Ruling 10/37: delivered on `user_{firebaseUid}` so cached transfer lists,
   * the site directory, and `GET /me/sites` results are dropped after any
   * membership grant/revoke/deactivate, including a site that was not the
   * active site.
   */
  emitSiteAccessScopeUpdated(
    firebaseUid: string,
    payload: SiteAccessScopeUpdatedPayload,
  ): void {
    if (!this.server) {
      this.logger.debug(
        JSON.stringify({
          type: 'ws_emit_skipped',
          event: SITE_ACCESS_SCOPE_UPDATED_EVENT,
          reason: 'No server connected',
        }),
      );
      return;
    }

    const room = `${DashboardGateway.USER_ROOM_PREFIX}${firebaseUid}`;
    this.server.to(room).emit(SITE_ACCESS_SCOPE_UPDATED_EVENT, payload);
    this.logger.debug(
      JSON.stringify({
        type: 'ws_emit',
        event: SITE_ACCESS_SCOPE_UPDATED_EVENT,
        room,
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
