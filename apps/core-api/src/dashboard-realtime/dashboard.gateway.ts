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
import type { Server, Socket } from 'socket.io';
import type { AuthService } from '../auth/auth.service.js';
import { AUTH_SERVICE_TOKEN } from '../auth/auth.tokens.js';
import { Public } from '../common/decorators/public.decorator.js';
import { resolveCorsOrigins } from '../common/http/cors-origins.js';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { SiteContextService } from '../site/site-context.service.js';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';
import {
  AUTH_CLAIMS_UPDATED_EVENT,
  AuthClaimsUpdatedPayload,
  DASHBOARD_ENTITY_UPDATED_EVENT,
  DashboardEntityUpdatedPayload,
  EmitStockTransferUpdatedInput,
  SITE_ACCESS_SCOPE_UPDATED_EVENT,
  SITE_CONTEXT_UPDATED_EVENT,
  SiteAccessScopeUpdatedPayload,
  SiteContextUpdatedPayload,
  STOCK_TRANSFER_UPDATED_EVENT,
  type StockTransferUpdatedPayload,
} from './dashboard-events.types.js';
import {
  resolveRedisUrl,
  setupRedisAdapter,
  closeRedisClients,
  SITE_ROOM_PREFIX,
  reassignUserSocketsSiteRoom,
  redactTransferForSockets,
  type RedisAdapterClients,
} from './dashboard-redis.adapter.js';

export const TENANT_ROOM_PREFIX = 'tenant_';
export const USER_ROOM_PREFIX = 'user_';

export function extractBearerToken(token?: unknown): string | null {
  if (typeof token !== 'string') {
    return null;
  }
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatAuthHeader(token: string): string {
  return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
}

export async function authenticateSocketConnection(
  socket: Socket,
  authService: AuthService,
): Promise<{ tenantId?: string; userId?: string }> {
  const auth = socket.handshake.auth as Record<string, unknown> | undefined;
  const token = extractBearerToken(auth?.token);
  if (!token) {
    throw new Error('No token provided');
  }
  const authHeader = formatAuthHeader(token);
  const user = await authService.authenticateBearerToken(authHeader);
  return { tenantId: user.tenantId, userId: user.userId };
}

export function createSocketAuthMiddleware(
  authService: AuthService,
  logger: Logger,
) {
  return (socket: Socket, next: (err?: Error) => void) => {
    authenticateSocketConnection(socket, authService)
      .then((user) => {
        const data = socket.data as { tenantId?: string; userId?: string };
        data.tenantId = user.tenantId;
        data.userId = user.userId;
        next();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug(
          JSON.stringify({
            type: 'ws_auth_failed',
            socketId: socket.id,
            reason: message,
          }),
        );
        next(new Error('Unauthorized'));
      });
  };
}

export function buildStockTransferPayload(
  input: EmitStockTransferUpdatedInput,
  includeSourceBin: boolean,
  redactedTransfer?: Record<string, unknown>,
  timestamp = new Date().toISOString(),
): StockTransferUpdatedPayload {
  return {
    action: input.action,
    transfer: includeSourceBin
      ? input.transfer
      : (redactedTransfer ?? redactTransferForSockets(input.transfer)),
    timestamp,
  };
}

export async function resolveSocketActiveSiteId(
  client: Socket,
  siteContext?: SiteContextService,
): Promise<string | null> {
  const data = client.data as Record<string, string | undefined>;
  const tenantId = data.tenantId;
  const userId = data.userId;
  if (!tenantId || !userId || !siteContext) {
    return null;
  }

  return TenantContextStorage.run(() => {
    TenantContextStorage.setUser({
      userId,
      email: '',
      tenantId,
      role: 'member',
    });
    return siteContext.resolveSiteId();
  });
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
  private readonly authService: AuthService;
  private readonly siteContext?: SiteContextService;
  private redisClients?: RedisAdapterClients;
  private redisAdapterReady: Promise<void> = Promise.resolve();

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(AUTH_SERVICE_TOKEN)
    authService: AuthService,
    @Optional()
    @Inject(forwardRef(() => SiteContextService))
    siteContext?: SiteContextService,
  ) {
    this.authService = authService;
    this.siteContext = siteContext;
  }

  private isGatewayReady(): boolean {
    return Boolean(this.server && this.authService && this.redisAdapterReady);
  }

  afterInit(server: Server, redisUrl = resolveRedisUrl()) {
    this.server = server;
    server.use(createSocketAuthMiddleware(this.authService, this.logger));
    if (this.siteContext) {
      this.logger.debug('SiteContextService initialized in DashboardGateway');
    }
    if (redisUrl) {
      this.redisAdapterReady = this.attachRedisAdapter(redisUrl);
    }
  }

  async onApplicationBootstrap() {
    await this.redisAdapterReady;
    if (this.authService && this.isGatewayReady()) {
      this.logger.debug('DashboardGateway ready after bootstrap');
    }
  }

  private async attachRedisAdapter(redisUrl: string): Promise<void> {
    this.redisClients = await setupRedisAdapter(
      this.server,
      redisUrl,
      this.logger,
    );
  }

  async handleConnection(client: Socket) {
    if (!this.authService || !this.isGatewayReady()) {
      return;
    }
    const data = client.data as Record<string, string | undefined>;
    const tenantRoom = `${TENANT_ROOM_PREFIX}${data.tenantId}`;
    const userRoom = `${USER_ROOM_PREFIX}${data.userId}`;
    await client.join(tenantRoom);
    await client.join(userRoom);

    // Ruling 37: join `site:{siteId}` for the validated active site (if any).
    const activeSiteId = await resolveSocketActiveSiteId(
      client,
      this.siteContext,
    );
    if (activeSiteId) {
      await client.join(`${SITE_ROOM_PREFIX}${activeSiteId}`);
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

  handleDisconnect(client: Socket) {
    if (!this.authService || !this.isGatewayReady()) {
      return;
    }
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

  private ensureServer(
    event: string,
    extra?: Record<string, unknown>,
  ): boolean {
    if (!this.authService || !this.isGatewayReady()) {
      this.logger.debug(
        JSON.stringify({
          type: 'ws_emit_skipped',
          event,
          reason: 'No server connected',
          ...extra,
        }),
      );
      return false;
    }
    return true;
  }

  private emitToUser(
    firebaseUid: string,
    event: string,
    payload: unknown,
    extraLog?: Record<string, unknown>,
  ): boolean {
    if (!this.ensureServer(event)) {
      return false;
    }
    const room = `${USER_ROOM_PREFIX}${firebaseUid}`;
    this.server.to(room).emit(event, payload);
    this.logger.debug(
      JSON.stringify({
        type: 'ws_emit',
        event,
        room,
        ...extraLog,
      }),
    );
    return true;
  }

  emitEntityUpdated(
    tenantId: string,
    payload: DashboardEntityUpdatedPayload,
  ): void {
    SideEffectGuard.assertAllowed('NOTIFICATION');
    if (
      !this.ensureServer(DASHBOARD_ENTITY_UPDATED_EVENT, {
        entityType: payload.type,
        action: payload.action,
      })
    ) {
      return;
    }
    const room = `${TENANT_ROOM_PREFIX}${tenantId}`;
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
    SideEffectGuard.assertAllowed('NOTIFICATION');
    if (!this.authService) {
      return;
    }
    this.emitToUser(firebaseUid, AUTH_CLAIMS_UPDATED_EVENT, payload, {
      claimReason: payload.reason,
    });
  }

  async emitSiteContextUpdated(
    firebaseUid: string,
    payload: SiteContextUpdatedPayload,
  ): Promise<void> {
    SideEffectGuard.assertAllowed('NOTIFICATION');
    if (!this.ensureServer(SITE_CONTEXT_UPDATED_EVENT)) {
      return;
    }

    const room = `${USER_ROOM_PREFIX}${firebaseUid}`;
    await reassignUserSocketsSiteRoom({
      server: this.server,
      userRoom: room,
      siteId: payload.siteId,
      logger: this.logger,
      firebaseUid,
    });

    this.emitToUser(firebaseUid, SITE_CONTEXT_UPDATED_EVENT, payload, {
      siteId: payload.siteId,
    });
  }

  emitSiteAccessScopeUpdated(
    firebaseUid: string,
    payload: SiteAccessScopeUpdatedPayload,
  ): void {
    SideEffectGuard.assertAllowed('NOTIFICATION');
    if (!this.authService) {
      return;
    }
    this.emitToUser(firebaseUid, SITE_ACCESS_SCOPE_UPDATED_EVENT, payload);
  }

  emitStockTransferUpdated(
    tenantId: string,
    input: EmitStockTransferUpdatedInput,
  ): void {
    SideEffectGuard.assertAllowed('NOTIFICATION');
    if (!this.ensureServer(STOCK_TRANSFER_UPDATED_EVENT)) {
      return;
    }

    const redactedTransfer = redactTransferForSockets(input.transfer);
    const timestamp = new Date().toISOString();

    this.server
      .to(`${SITE_ROOM_PREFIX}${input.fromSiteId}`)
      .emit(
        STOCK_TRANSFER_UPDATED_EVENT,
        buildStockTransferPayload(input, true, redactedTransfer, timestamp),
      );
    this.server
      .to(`${SITE_ROOM_PREFIX}${input.toSiteId}`)
      .emit(
        STOCK_TRANSFER_UPDATED_EVENT,
        buildStockTransferPayload(input, false, redactedTransfer, timestamp),
      );

    for (const recipient of input.recipients) {
      this.server
        .to(`${USER_ROOM_PREFIX}${recipient.firebaseUid}`)
        .emit(
          STOCK_TRANSFER_UPDATED_EVENT,
          buildStockTransferPayload(
            input,
            recipient.includeSourceBin,
            redactedTransfer,
            timestamp,
          ),
        );
    }

    this.logger.debug(
      JSON.stringify({
        type: 'ws_emit',
        event: STOCK_TRANSFER_UPDATED_EVENT,
        tenantId,
        action: input.action,
        recipients: input.recipients.length,
      }),
    );
  }

  async onModuleDestroy() {
    if (this.authService && this.isGatewayReady()) {
      this.logger.debug('Destroying realtime gateway');
    }
    await this.redisAdapterReady.catch(() => {});
    await closeRedisClients(this.redisClients);
  }
}
