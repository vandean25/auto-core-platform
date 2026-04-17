import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Public } from '../common/decorators/public.decorator';
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
    const origin = req.headers.origin;
    // If there is no origin header, we assume it's a non-browser client (e.g. mobile app, curl, server-to-server).
    // The strict origin check only applies to browser environments that send the Origin header.
    if (!origin) {
      return callback(null, true);
    }

    // Check if the origin is in our allowed list
    const isAllowed = allowedOrigins.includes(origin);
    callback(null, isAllowed);
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
