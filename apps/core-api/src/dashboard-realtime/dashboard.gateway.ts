import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Public } from '../common/decorators/public.decorator';
import {
  DASHBOARD_ENTITY_UPDATED_EVENT,
  DashboardEntityUpdatedPayload,
} from './dashboard-events.types';

function resolveCorsOrigins(): string[] | boolean {
  const configuredOrigins = process.env.FRONTEND_URL?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!configuredOrigins || configuredOrigins.length === 0) {
    const message =
      'No FRONTEND_URL configured for CORS. Falling back to permissive (allow-all) mode.';
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`CRITICAL: ${message} This is prohibited in production.`);
    }
    console.warn(`WARNING: ${message}`);
    return true;
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
