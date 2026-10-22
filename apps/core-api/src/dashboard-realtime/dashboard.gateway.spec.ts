import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { Socket, Server } from 'socket.io';
import { jest } from '@jest/globals';
import type { AuthService } from '../auth/auth.service.js';
import type { SiteContextService } from '../site/site-context.service.js';
import type { TenantAuthenticatedUser } from '../auth/types/authenticated-user.js';
import { asFake } from '../invoices/invoice-fixtures.spec.support.js';
import {
  AUTH_CLAIMS_UPDATED_EVENT,
  DASHBOARD_ENTITY_UPDATED_EVENT,
  SITE_ACCESS_SCOPE_UPDATED_EVENT,
  SITE_CONTEXT_UPDATED_EVENT,
  STOCK_TRANSFER_UPDATED_EVENT,
  type AuthClaimsUpdatedPayload,
  type DashboardEntityUpdatedPayload,
  type SiteAccessScopeUpdatedPayload,
  type SiteContextUpdatedPayload,
} from './dashboard-events.types.js';
const mockCreateAdapter = jest.fn(() => 'mock-redis-adapter');

const mockPubQuit = jest.fn<() => Promise<string>>().mockResolvedValue('OK');
const mockPubConnect = jest.fn<() => Promise<string>>().mockResolvedValue('OK');
const mockSubQuit = jest.fn<() => Promise<string>>().mockResolvedValue('OK');
const mockSubConnect = jest.fn<() => Promise<string>>().mockResolvedValue('OK');
const mockPubOn = jest.fn();
const mockSubOn = jest.fn();

jest.unstable_mockModule('@socket.io/redis-adapter', () => ({
  createAdapter: mockCreateAdapter,
}));

const mockRedis = jest.fn().mockImplementation(() => ({
  duplicate: jest.fn().mockReturnValue({
    on: mockSubOn,
    connect: mockSubConnect,
    quit: mockSubQuit,
  }),
  on: mockPubOn,
  connect: mockPubConnect,
  quit: mockPubQuit,
}));
jest.unstable_mockModule('ioredis', () => ({ Redis: mockRedis }));

const { createAdapter } = await import('@socket.io/redis-adapter');
const { Redis } = await import('ioredis');
const {
  DashboardGateway,
  attachEngineConnectionErrorLogging,
  buildStockTransferPayload,
  describeEngineConnectionError,
  extractBearerToken,
  formatAuthHeader,
} = await import('./dashboard.gateway.js');
const {
  REDIS_CONNECT_TIMEOUT_MS,
  connectRedisClients,
  resolveRedisUrl,
  reassignSocketSiteRoom,
  redactTransferForSockets,
} = await import('./dashboard-redis.adapter.js');
const { resolveCorsOrigins } = await import('../common/http/cors-origins.js');

describe('engine.io connection error logging', () => {
  it('describes a session-id mismatch without exposing the session id', () => {
    const description = describeEngineConnectionError({
      code: 1,
      message: 'Session ID unknown',
      context: { sid: 'session-secret' },
      req: {
        url: '/api/socket.io/?EIO=4&transport=polling&sid=session-secret',
        headers: {},
      },
    });

    expect(description).toEqual({
      type: 'ws_engine_connection_error',
      code: 1,
      message: 'Session ID unknown',
      reason: null,
      transport: 'polling',
      hasSid: true,
      upgradeHeader: false,
    });
    expect(JSON.stringify(description)).not.toContain('session-secret');
  });

  it('reports the requested transport and whether an upgrade was attempted', () => {
    const description = describeEngineConnectionError({
      code: 3,
      message: 'Bad request',
      context: { name: 'TRANSPORT_HANDSHAKE_ERROR' },
      req: {
        url: '/api/socket.io/?EIO=4&transport=websocket',
        headers: { upgrade: 'websocket' },
      },
    });

    expect(description).toMatchObject({
      code: 3,
      reason: 'TRANSPORT_HANDSHAKE_ERROR',
      transport: 'websocket',
      hasSid: false,
      upgradeHeader: true,
    });
  });

  it('logs one structured warning for each engine.io connection error on the root server', () => {
    const engine = new EventEmitter();
    const root = { adapter: jest.fn(), engine } as unknown as Server;
    const logger = { warn: jest.fn() } as unknown as Logger;

    attachEngineConnectionErrorLogging(root, logger);
    engine.emit('connection_error', {
      code: 1,
      message: 'Session ID unknown',
      context: { sid: 'session-secret' },
      req: {
        url: '/api/socket.io/?EIO=4&transport=websocket&sid=session-secret',
        headers: { upgrade: 'websocket' },
      },
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('"type":"ws_engine_connection_error"'),
    );
  });

  it('reaches the root engine when Nest passes a namespace, which has no engine of its own', () => {
    const engine = new EventEmitter();
    const root = { adapter: jest.fn(), engine } as unknown as Server;
    const namespace = { server: root, adapter: {} } as unknown as Server;
    const logger = { warn: jest.fn() } as unknown as Logger;

    attachEngineConnectionErrorLogging(namespace, logger);
    engine.emit('connection_error', {
      code: 1,
      message: 'Session ID unknown',
      context: { sid: 'session-secret' },
      req: {
        url: '/api/socket.io/?EIO=4&transport=polling&sid=session-secret',
        headers: {},
      },
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('wires engine connection errors into the gateway logger when afterInit receives a namespace', () => {
    const engine = new EventEmitter();
    const root = { adapter: jest.fn(), engine } as unknown as Server;
    const namespace = {
      server: root,
      adapter: {},
      use: jest.fn(),
    } as unknown as Server;
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const authService = { authenticateBearerToken: jest.fn() };
    const namespaceGateway = new DashboardGateway(
      authService as unknown as AuthService,
    );

    try {
      namespaceGateway.afterInit(namespace, '');
      engine.emit('connection_error', {
        code: 3,
        message: 'Bad request',
        context: { name: 'TRANSPORT_HANDSHAKE_ERROR' },
        req: { url: '/api/socket.io/?EIO=4&transport=websocket', headers: {} },
      });

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('"reason":"TRANSPORT_HANDSHAKE_ERROR"'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('ignores servers that expose no root engine', () => {
    const logger = { warn: jest.fn() } as unknown as Logger;

    expect(() =>
      attachEngineConnectionErrorLogging({} as unknown as Server, logger),
    ).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('resolveRedisUrl', () => {
  it('returns undefined when REDIS_URL is undefined or empty', () => {
    expect(resolveRedisUrl(undefined)).toBeUndefined();
    expect(resolveRedisUrl('')).toBeUndefined();
    expect(resolveRedisUrl('   ')).toBeUndefined();
  });

  it('returns trimmed URL when REDIS_URL is provided', () => {
    expect(resolveRedisUrl('  redis://10.0.0.3:6379  ')).toBe(
      'redis://10.0.0.3:6379',
    );
  });
});

describe('resolveCorsOrigins', () => {
  it('falls back to localhost dev origins when FRONTEND_URL is unset outside production', () => {
    expect(resolveCorsOrigins(undefined, 'development')).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
  });

  it('uses configured origins when FRONTEND_URL is provided', () => {
    expect(
      resolveCorsOrigins(
        'http://localhost:5173,https://app.example.com',
        'development',
      ),
    ).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });
});

describe('extractBearerToken and formatAuthHeader', () => {
  it('extracts token and trims whitespace', () => {
    expect(extractBearerToken('  abc  ')).toBe('abc');
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('   ')).toBeNull();
    expect(extractBearerToken(123)).toBeNull();
  });

  it('formats bearer authorization header properly', () => {
    expect(formatAuthHeader('abc')).toBe('Bearer abc');
    expect(formatAuthHeader('Bearer xyz')).toBe('Bearer xyz');
  });
});

describe('reassignSocketSiteRoom', () => {
  it('leaves existing site rooms and joins the new site room', () => {
    const mockSocket = {
      rooms: new Set(['tenant_t1', 'user_u1', 'site_old']),
      leave: jest.fn(),
      join: jest.fn(),
      data: {} as Record<string, unknown>,
    };

    reassignSocketSiteRoom(mockSocket as any, 'new_site');

    expect(mockSocket.leave).toHaveBeenCalledWith('site_old');
    expect(mockSocket.join).toHaveBeenCalledWith('site_new_site');
    expect(mockSocket.data.activeSiteId).toBe('new_site');
  });

  it('leaves existing site room without joining when new site is null', () => {
    const mockSocket = {
      rooms: new Set(['site_old']),
      leave: jest.fn(),
      join: jest.fn(),
      data: {} as Record<string, unknown>,
    };

    reassignSocketSiteRoom(mockSocket as any, null);

    expect(mockSocket.leave).toHaveBeenCalledWith('site_old');
    expect(mockSocket.join).not.toHaveBeenCalled();
    expect(mockSocket.data.activeSiteId).toBeNull();
  });
});

describe('redactTransferForSockets and buildStockTransferPayload', () => {
  it('nullifies sourceLocationId on lines when redacting transfer', () => {
    const transfer = {
      id: 'tx-1',
      lines: [
        { id: 'l-1', sourceLocationId: 'loc-1', qty: 5 },
        { id: 'l-2', sourceLocationId: 'loc-2', qty: 10 },
      ],
    };
    const redacted = redactTransferForSockets(transfer);
    expect(redacted.lines).toEqual([
      { id: 'l-1', sourceLocationId: null, qty: 5 },
      { id: 'l-2', sourceLocationId: null, qty: 10 },
    ]);
  });

  it('builds stock transfer payload with or without source bin', () => {
    const input = {
      fromSiteId: 'site-a',
      toSiteId: 'site-b',
      action: 'UPDATED' as const,
      transfer: { id: 'tx-1', lines: [{ sourceLocationId: 'loc-1' }] },
      recipients: [],
    };
    const full = buildStockTransferPayload(input, true);
    expect((full.transfer as any).lines[0].sourceLocationId).toBe('loc-1');

    const redacted = buildStockTransferPayload(input, false);
    expect((redacted.transfer as any).lines[0].sourceLocationId).toBeNull();
  });
});

type RemoteSocketFake = Awaited<
  ReturnType<ReturnType<Server['in']>['fetchSockets']>
>[number];

function createClient(token?: string): Socket {
  return asFake<Socket>({
    id: 'socket-1',
    handshake: {
      headers: {},
      time: '',
      address: '',
      xdomain: false,
      secure: false,
      issued: 0,
      url: '',
      query: {},
      auth: token ? { token } : {},
    },
    join: jest
      .fn<(room: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    disconnect: jest.fn<(close?: boolean) => Socket>(),
    data: {},
  });
}

describe('DashboardGateway', () => {
  let authService: {
    authenticateBearerToken: jest.Mock<
      (authorizationHeader?: string) => Promise<TenantAuthenticatedUser>
    >;
  };
  let siteContext: jest.Mocked<Pick<SiteContextService, 'resolveSiteId'>>;
  let gateway: InstanceType<typeof DashboardGateway>;
  const createGateway = () =>
    new DashboardGateway(
      asFake<AuthService>(authService),
      asFake<SiteContextService>(siteContext),
    );
  let middleware: (socket: any, next: (err?: Error) => void) => void;

  beforeEach(() => {
    authService = {
      authenticateBearerToken: jest.fn<
        (authorizationHeader?: string) => Promise<TenantAuthenticatedUser>
      >(),
    };
    siteContext = {
      resolveSiteId: jest
        .fn<SiteContextService['resolveSiteId']>()
        .mockResolvedValue(null),
    };
    gateway = createGateway();

    const mockServer = asFake<Server>({
      use: jest.fn<(fn: typeof middleware) => Server>(function (
        this: Server,
        fn,
      ) {
        middleware = fn;
        return this;
      }),
    });
    gateway.afterInit(mockServer);
  });

  describe('middleware authentication', () => {
    it('rejects connection when socket auth token is missing', async () => {
      const client = createClient();
      const next = jest.fn<(...args: unknown[]) => void>();

      await new Promise<void>((resolve) => {
        middleware(client, (...args: any[]) => {
          next(...args);
          resolve();
        });
      });

      expect(authService.authenticateBearerToken).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect((next.mock.calls[0][0] as Error).message).toBe('Unauthorized');
    });

    it('rejects connection when socket auth token is invalid', async () => {
      const client = createClient('bad-token');
      const next = jest.fn<(...args: unknown[]) => void>();
      authService.authenticateBearerToken.mockRejectedValue(
        new Error('invalid token'),
      );

      await new Promise<void>((resolve) => {
        middleware(client, (...args: any[]) => {
          next(...args);
          resolve();
        });
      });

      expect(authService.authenticateBearerToken).toHaveBeenCalledWith(
        'Bearer bad-token',
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect((next.mock.calls[0][0] as Error).message).toBe('Unauthorized');
    });

    it('authenticates and attaches user data to socket from jwt tenantId', async () => {
      const client = createClient('jwt-token');
      const next = jest.fn<(...args: unknown[]) => void>();
      authService.authenticateBearerToken.mockResolvedValue({
        userId: 'user-1',
        email: 'user@example.com',
        tenantId: 'tenant-a',
        role: 'ADMIN',
      });

      await new Promise<void>((resolve) => {
        middleware(client, (...args: any[]) => {
          next(...args);
          resolve();
        });
      });

      expect(authService.authenticateBearerToken).toHaveBeenCalledWith(
        'Bearer jwt-token',
      );
      expect(client.data.tenantId).toBe('tenant-a');
      expect(client.data.userId).toBe('user-1');
      expect(next).toHaveBeenCalledWith(); // Called with no args on success
    });
  });

  describe('handleConnection', () => {
    it('joins tenant-prefixed room based on socket.data and logs structured event', async () => {
      const client = createClient();
      client.data = { tenantId: 'tenant-a', userId: 'user-1' };
      const loggerDebugSpy = jest.spyOn((gateway as any).logger, 'debug');

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('tenant_tenant-a');
      expect(client.join).toHaveBeenCalledWith('user_user-1');

      const logCalls = loggerDebugSpy.mock.calls.map((call) =>
        JSON.parse(call[0] as string),
      );
      expect(logCalls).toContainEqual(
        expect.objectContaining({
          type: 'ws_connect',
          socketId: 'socket-1',
          tenantId: 'tenant-a',
          userId: 'user-1',
        }),
      );
    });

    it('joins the active site room when the user has a validated active site', async () => {
      const client = createClient();
      client.data = { tenantId: 'tenant-a', userId: 'user-1' };
      siteContext.resolveSiteId.mockResolvedValue('site-1');

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('tenant_tenant-a');
      expect(client.join).toHaveBeenCalledWith('user_user-1');
      expect(client.join).toHaveBeenCalledWith('site_site-1');
      expect(client.data.activeSiteId).toBe('site-1');
    });

    it('stays in tenant + user rooms only when no active site resolves', async () => {
      const client = createClient();
      client.data = { tenantId: 'tenant-a', userId: 'user-1' };
      siteContext.resolveSiteId.mockResolvedValue(null);

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('tenant_tenant-a');
      expect(client.join).toHaveBeenCalledWith('user_user-1');
      expect(client.join).not.toHaveBeenCalledWith(
        expect.stringMatching(/^site_/),
      );
    });
  });

  describe('handleDisconnect', () => {
    it('logs structured ws_disconnect event with socket metadata', () => {
      const client = createClient();
      client.data = { tenantId: 'tenant-a', userId: 'user-1' };
      const loggerDebugSpy = jest.spyOn((gateway as any).logger, 'debug');

      gateway.handleDisconnect(client);

      const logCalls = loggerDebugSpy.mock.calls.map((call) =>
        JSON.parse(call[0] as string),
      );
      expect(logCalls).toContainEqual(
        expect.objectContaining({
          type: 'ws_disconnect',
          socketId: 'socket-1',
          tenantId: 'tenant-a',
          userId: 'user-1',
        }),
      );
    });
  });

  it('emits realtime updates only to tenant-prefixed room without tenantId in payload', () => {
    const emit = jest.fn<(event: string, payload: Record<string, unknown>) => boolean>();
    const to = jest
      .fn<Server['to']>()
      .mockReturnValue(asFake<ReturnType<Server['to']>>({ emit }));
    gateway.server = asFake<Server>({ to });

    const payload: DashboardEntityUpdatedPayload = {
      type: 'CUSTOMER',
      action: 'UPDATED',
      entityId: 'cust-1',
      timestamp: new Date().toISOString(),
    };

    gateway.emitEntityUpdated('tenant-a', payload);

    expect(to).toHaveBeenCalledWith('tenant_tenant-a');
    expect(emit).toHaveBeenCalledWith(DASHBOARD_ENTITY_UPDATED_EVENT, payload);
    const emittedPayload = emit.mock.calls[0]?.[1];
    expect(emittedPayload.tenantId).toBeUndefined();
  });

  it('emits claims refresh events only to the affected user room', () => {
    const emit = jest.fn<(event: string, payload: Record<string, unknown>) => boolean>();
    const to = jest
      .fn<Server['to']>()
      .mockReturnValue(asFake<ReturnType<Server['to']>>({ emit }));
    gateway.server = asFake<Server>({ to });

    const payload: AuthClaimsUpdatedPayload = {
      reason: 'membership-updated',
      timestamp: new Date().toISOString(),
    };

    gateway.emitClaimsUpdated('user-1', payload);

    expect(to).toHaveBeenCalledWith('user_user-1');
    expect(emit).toHaveBeenCalledWith(AUTH_CLAIMS_UPDATED_EVENT, payload);
  });

  it('emits site access scope events only to the affected user room', () => {
    const emit = jest.fn<(event: string, payload: Record<string, unknown>) => boolean>();
    const to = jest
      .fn<Server['to']>()
      .mockReturnValue(asFake<ReturnType<Server['to']>>({ emit }));
    gateway.server = asFake<Server>({ to });

    const payload: SiteAccessScopeUpdatedPayload = {
      timestamp: new Date().toISOString(),
    };

    gateway.emitSiteAccessScopeUpdated('user-1', payload);

    expect(to).toHaveBeenCalledWith('user_user-1');
    expect(emit).toHaveBeenCalledWith(SITE_ACCESS_SCOPE_UPDATED_EVENT, payload);
  });

  it('redacts source locations per transfer recipient', () => {
    const emit = jest.fn<(event: string, payload: Record<string, unknown>) => boolean>();
    const to = jest
      .fn<Server['to']>()
      .mockReturnValue(asFake<ReturnType<Server['to']>>({ emit }));
    gateway.server = asFake<Server>({ to });

    gateway.emitStockTransferUpdated('tenant-a', {
      action: 'UPDATED',
      fromSiteId: 'site-from',
      toSiteId: 'site-to',
      transfer: {
        id: 'transfer-1',
        lines: [{ id: 'line-1', sourceLocationId: 'bin-from' }],
      },
      recipients: [
        { firebaseUid: 'from-user', includeSourceBin: true },
        { firebaseUid: 'to-user', includeSourceBin: false },
      ],
    });

    expect(to).toHaveBeenNthCalledWith(1, 'site_site-from');
    expect(to).toHaveBeenNthCalledWith(2, 'site_site-to');
    expect(to).toHaveBeenNthCalledWith(3, 'user_from-user');
    expect(to).toHaveBeenNthCalledWith(4, 'user_to-user');
    expect(
      emit.mock.calls.map(([, eventPayload]) => eventPayload.transfer),
    ).toEqual([
      {
        id: 'transfer-1',
        lines: [{ id: 'line-1', sourceLocationId: 'bin-from' }],
      },
      {
        id: 'transfer-1',
        lines: [{ id: 'line-1', sourceLocationId: null }],
      },
      {
        id: 'transfer-1',
        lines: [{ id: 'line-1', sourceLocationId: 'bin-from' }],
      },
      {
        id: 'transfer-1',
        lines: [{ id: 'line-1', sourceLocationId: null }],
      },
    ]);
    expect(
      emit.mock.calls.every(([eventName]) => eventName === STOCK_TRANSFER_UPDATED_EVENT),
    ).toBe(true);
  });

  it('moves every user-room socket to the new site room then emits site context updated', async () => {
    const emit = jest.fn<(event: string, payload: Record<string, unknown>) => boolean>();
    const to = jest
      .fn<Server['to']>()
      .mockReturnValue(asFake<ReturnType<Server['to']>>({ emit }));
    const leave = jest.fn();
    const join = jest.fn();
    const socketData = { activeSiteId: 'site-old' };
    const fetchSockets = jest
      .fn<ReturnType<Server['in']>['fetchSockets']>()
      .mockResolvedValue([
        asFake<RemoteSocketFake>({
          data: socketData,
          rooms: new Set(['socket-1', 'user_user-1', 'site_site-old']),
          leave,
          join,
        }),
      ]);
    const inRoom = jest
      .fn<Server['in']>()
      .mockReturnValue(asFake<ReturnType<Server['in']>>({ fetchSockets }));
    gateway.server = asFake<Server>({
      to,
      in: inRoom,
    });

    const payload: SiteContextUpdatedPayload = {
      siteId: 'site-new',
      timestamp: new Date().toISOString(),
    };

    await gateway.emitSiteContextUpdated('user-1', payload);

    expect(inRoom).toHaveBeenCalledWith('user_user-1');
    expect(leave).toHaveBeenCalledWith('site_site-old');
    expect(join).toHaveBeenCalledWith('site_site-new');
    expect(socketData.activeSiteId).toBe('site-new');
    expect(to).toHaveBeenCalledWith('user_user-1');
    expect(emit).toHaveBeenCalledWith(SITE_CONTEXT_UPDATED_EVENT, payload);
  });

  it('clears the site room when site context updates with null', async () => {
    const emit = jest.fn<(event: string, payload: Record<string, unknown>) => boolean>();
    const to = jest
      .fn<Server['to']>()
      .mockReturnValue(asFake<ReturnType<Server['to']>>({ emit }));
    const leave = jest.fn();
    const join = jest.fn();
    const socketData = { activeSiteId: 'site-old' };
    const fetchSockets = jest
      .fn<ReturnType<Server['in']>['fetchSockets']>()
      .mockResolvedValue([
        asFake<RemoteSocketFake>({
          data: socketData,
          rooms: new Set(['socket-1', 'user_user-1', 'site_site-old']),
          leave,
          join,
        }),
      ]);
    gateway.server = asFake<Server>({
      to,
      in: jest
        .fn<Server['in']>()
        .mockReturnValue(asFake<ReturnType<Server['in']>>({ fetchSockets })),
    });

    const payload: SiteContextUpdatedPayload = {
      siteId: null,
      timestamp: new Date().toISOString(),
    };

    await gateway.emitSiteContextUpdated('user-1', payload);

    expect(leave).toHaveBeenCalledWith('site_site-old');
    expect(join).not.toHaveBeenCalled();
    expect(socketData.activeSiteId).toBeNull();
  });

  it('uses the remote socket room set when moving a socket repeatedly', async () => {
    const leave = jest.fn();
    const join = jest.fn();
    const emit = jest.fn<(event: string, payload: Record<string, unknown>) => boolean>();
    const remoteSocket = (activeSiteId: string, siteRoom: string) =>
      asFake<RemoteSocketFake>({
        data: { activeSiteId },
        rooms: new Set(['socket-1', 'user_user-1', siteRoom]),
        leave,
        join,
      });
    const fetchSockets = jest
      .fn<ReturnType<Server['in']>['fetchSockets']>()
      .mockResolvedValueOnce([remoteSocket('site-old', 'site_site-old')])
      .mockResolvedValueOnce([remoteSocket('site-old', 'site_site-new')]);
    gateway.server = asFake<Server>({
      to: jest
        .fn<Server['to']>()
        .mockReturnValue(asFake<ReturnType<Server['to']>>({ emit })),
      in: jest
        .fn<Server['in']>()
        .mockReturnValue(asFake<ReturnType<Server['in']>>({ fetchSockets })),
    });

    await gateway.emitSiteContextUpdated('user-1', {
      siteId: 'site-new',
      timestamp: new Date().toISOString(),
    });
    await gateway.emitSiteContextUpdated('user-1', {
      siteId: 'site-third',
      timestamp: new Date().toISOString(),
    });

    expect(leave).toHaveBeenNthCalledWith(1, 'site_site-old');
    expect(leave).toHaveBeenNthCalledWith(2, 'site_site-new');
    expect(join).toHaveBeenNthCalledWith(1, 'site_site-new');
    expect(join).toHaveBeenNthCalledWith(2, 'site_site-third');
  });

  describe('connectRedisClients', () => {
    it('rejects when connect does not finish before the timeout', async () => {
      await expect(
        connectRedisClients(() => new Promise(() => {}), 20),
      ).rejects.toThrow(/Redis connect timed out after 20ms/);
    });

    it('resolves when connect finishes before the timeout', async () => {
      await expect(
        connectRedisClients(() => Promise.resolve(), 200),
      ).resolves.toBeUndefined();
    });
  });

  describe('Redis adapter initialization', () => {
    afterEach(() => {
      mockPubConnect.mockReset();
      mockPubConnect.mockResolvedValue('OK');
      mockSubConnect.mockReset();
      mockSubConnect.mockResolvedValue('OK');
    });

    it('attaches Redis adapter when REDIS_URL is provided and connect succeeds', async () => {
      jest.clearAllMocks();
      const gatewayWithRedis = createGateway();
      const mockServer = {
        use: jest.fn(),
        adapter: jest.fn(),
      };

      gatewayWithRedis.afterInit(
        mockServer as unknown as Server,
        'redis://10.0.0.3:6379',
      );
      await gatewayWithRedis.onApplicationBootstrap();

      expect(Redis).toHaveBeenCalledWith('redis://10.0.0.3:6379', {
        lazyConnect: true,
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      });
      expect(mockPubConnect).toHaveBeenCalled();
      expect(mockSubConnect).toHaveBeenCalled();
      expect(createAdapter).toHaveBeenCalled();
      expect(mockServer.adapter).toHaveBeenCalledWith('mock-redis-adapter');
    });

    it('attaches Redis adapter to root server when afterInit receives a Namespace object', async () => {
      jest.clearAllMocks();
      const gatewayWithRedis = createGateway();
      const rootServer = {
        adapter: jest.fn(),
      };
      const mockNamespace = {
        name: '/dashboard-realtime',
        adapter: { rooms: new Map(), sids: new Map() }, // Namespace.adapter is an Adapter instance, not a function
        server: rootServer,
        use: jest.fn(),
      };

      gatewayWithRedis.afterInit(
        mockNamespace as unknown as Server,
        'redis://10.0.0.3:6379',
      );
      await gatewayWithRedis.onApplicationBootstrap();

      expect(createAdapter).toHaveBeenCalled();
      expect(rootServer.adapter).toHaveBeenCalledWith('mock-redis-adapter');
    });

    it('does not attach adapter or log success when connect fails outside production', async () => {
      jest.clearAllMocks();
      mockPubConnect.mockRejectedValueOnce(new Error('Connection refused'));

      const gatewayWithRedis = createGateway();
      const mockServer = {
        use: jest.fn(),
        adapter: jest.fn(),
      };

      gatewayWithRedis.afterInit(
        mockServer as unknown as Server,
        'redis://10.0.0.3:6379',
      );
      await gatewayWithRedis.onApplicationBootstrap();

      expect(createAdapter).not.toHaveBeenCalled();
      expect(mockServer.adapter).not.toHaveBeenCalled();
    });

    it('registers handshake auth before Redis connect completes', async () => {
      jest.clearAllMocks();
      let releaseConnect: (() => void) | undefined;
      mockPubConnect.mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseConnect = () => resolve('OK');
          }),
      );

      const gatewayWithRedis = createGateway();
      const mockServer = {
        use: jest.fn(),
        adapter: jest.fn(),
      };

      gatewayWithRedis.afterInit(
        mockServer as unknown as Server,
        'redis://10.0.0.3:6379',
      );

      expect(mockServer.use).toHaveBeenCalled();
      expect(createAdapter).not.toHaveBeenCalled();

      releaseConnect?.();
      await gatewayWithRedis.onApplicationBootstrap();
      expect(createAdapter).toHaveBeenCalled();
    });

    it('fails closed from onApplicationBootstrap when Redis connect fails in production', async () => {
      jest.clearAllMocks();
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      mockPubConnect.mockRejectedValueOnce(new Error('Connection refused'));

      const gatewayWithRedis = createGateway();
      const mockServer = {
        use: jest.fn(),
        adapter: jest.fn(),
      };

      try {
        gatewayWithRedis.afterInit(
          mockServer as unknown as Server,
          'redis://10.0.0.3:6379',
        );
        await expect(gatewayWithRedis.onApplicationBootstrap()).rejects.toThrow(
          /CRITICAL: Failed to connect to Redis at redis:\/\/10.0.0.3:6379/,
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }

      expect(createAdapter).not.toHaveBeenCalled();
      expect(mockServer.adapter).not.toHaveBeenCalled();
    });

    it('keeps default in-memory adapter when REDIS_URL is unset', () => {
      jest.clearAllMocks();
      const gatewayWithoutRedis = createGateway();
      const mockServer = {
        use: jest.fn(),
        adapter: jest.fn(),
      };

      gatewayWithoutRedis.afterInit(mockServer as unknown as Server, undefined);

      expect(createAdapter).not.toHaveBeenCalled();
      expect(mockServer.adapter).not.toHaveBeenCalled();
    });

    it('cleans up Redis clients on module destroy', async () => {
      jest.clearAllMocks();
      const gatewayWithRedis = createGateway();
      const mockServer = {
        use: jest.fn(),
        adapter: jest.fn(),
      };

      gatewayWithRedis.afterInit(
        mockServer as unknown as Server,
        'redis://10.0.0.3:6379',
      );
      await gatewayWithRedis.onApplicationBootstrap();
      await gatewayWithRedis.onModuleDestroy();

      expect(mockPubQuit).toHaveBeenCalled();
      expect(mockSubQuit).toHaveBeenCalled();
    });
  });
});
