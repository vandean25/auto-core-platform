import { Inject, Logger, forwardRef } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
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
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
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
}
