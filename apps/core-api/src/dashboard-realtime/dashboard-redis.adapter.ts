import { Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';

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

export interface RedisAdapterClients {
  pubClient?: Redis;
  subClient?: Redis;
}

export async function setupRedisAdapter(
  server: Server,
  redisUrl: string,
  logger: Logger,
): Promise<RedisAdapterClients> {
  const pubClient = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
  });
  const subClient = pubClient.duplicate();

  pubClient.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      `Redis pub client error: ${message}`,
      err instanceof Error ? err.stack : undefined,
    );
  });

  subClient.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
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
    logger.log(
      'Attached Redis adapter to Socket.IO for cross-instance fan-out.',
    );
    return { pubClient, subClient };
  } catch (err) {
    await pubClient.quit().catch(() => {});
    await subClient.quit().catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      `Failed to initialize Socket.IO Redis adapter: ${message}`,
    );
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `CRITICAL: Failed to connect to Redis at ${redisUrl} in production: ${message}`,
        { cause: err },
      );
    }
    return {};
  }
}

export const SITE_ROOM_PREFIX = 'site_';

export function reassignSocketSiteRoom(
  socket: any,
  newSiteId: string | null | undefined,
): void {
  const targetRoom = newSiteId
    ? `${SITE_ROOM_PREFIX}${newSiteId}`
    : undefined;

  for (const room of socket.rooms) {
    if (room.startsWith(SITE_ROOM_PREFIX) && room !== targetRoom) {
      void socket.leave(room);
    }
  }

  if (targetRoom) {
    void socket.join(targetRoom);
  }

  const data = socket.data as Record<string, unknown>;
  data.activeSiteId = newSiteId ?? null;
}

export interface ReassignUserSocketsInput {
  server: Server;
  userRoom: string;
  siteId: string | null | undefined;
  logger: Logger;
  firebaseUid: string;
}

export async function reassignUserSocketsSiteRoom(
  input: ReassignUserSocketsInput,
): Promise<void> {
  let sockets: any[] = [];
  try {
    sockets = await input.server.in(input.userRoom).fetchSockets();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.logger.warn(
      `Failed to move sockets of ${input.firebaseUid} between site rooms: ${message}`,
    );
    return;
  }

  for (const s of sockets) {
    reassignSocketSiteRoom(s, input.siteId);
  }
}

export function redactTransferForSockets(transfer: {
  lines?: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    ...transfer,
    lines: (transfer.lines ?? []).map((line) => ({
      ...line,
      sourceLocationId: null,
    })),
  };
}

export async function closeRedisClients(clients?: RedisAdapterClients): Promise<void> {
  if (!clients) {
    return;
  }
  if (clients.pubClient) {
    await clients.pubClient.quit().catch(() => {});
  }
  if (clients.subClient) {
    await clients.subClient.quit().catch(() => {});
  }
}

