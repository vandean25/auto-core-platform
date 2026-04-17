import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Public } from '../common/decorators/public.decorator';
import {
  DASHBOARD_ENTITY_UPDATED_EVENT,
  DashboardEntityUpdatedPayload,
} from './dashboard-events.types';

function resolveCorsOrigins(): string[] {
  const configuredOrigins = process.env.FRONTEND_URL?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!configuredOrigins || configuredOrigins.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'CRITICAL: Starting the server without a defined frontend origin is a critical misconfiguration.',
      );
    }
    console.warn(
      'WARNING: CORS origins are empty, and cross-origin WebSocket connections will be rejected.',
    );
    return [];
  }

  return configuredOrigins;
}

@Public()
@WebSocketGateway({
  namespace: '/dashboard-realtime',
  path: '/api/socket.io',
  cors: {
    origin: resolveCorsOrigins(),
    credentials: true,
  },
})
export class DashboardGateway {
  private readonly logger = new Logger(DashboardGateway.name);

  @WebSocketServer()
  server!: Server;

  emitEntityUpdated(payload: DashboardEntityUpdatedPayload): void {
    if (!this.server) {
      this.logger.debug(
        `Skipped emitting ${DASHBOARD_ENTITY_UPDATED_EVENT}: ${payload.type}/${payload.action} (No server connected)`.trim(),
      );
      return;
    }
    this.server.emit(DASHBOARD_ENTITY_UPDATED_EVENT, payload);
    this.logger.debug(
      `Emitted ${DASHBOARD_ENTITY_UPDATED_EVENT}: ${payload.type}/${payload.action} ${payload.entityId ?? ''}`.trim(),
    );
  }
}
