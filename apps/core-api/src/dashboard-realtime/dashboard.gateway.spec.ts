import type { Socket, Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { AuthService } from '../auth/auth.service';
import {
  AUTH_CLAIMS_UPDATED_EVENT,
  DASHBOARD_ENTITY_UPDATED_EVENT,
  type AuthClaimsUpdatedPayload,
  type DashboardEntityUpdatedPayload,
} from './dashboard-events.types';
import {
  DashboardGateway,
  resolveCorsOrigins,
  resolveRedisUrl,
} from './dashboard.gateway';

const mockPubQuit = jest.fn().mockResolvedValue('OK');
const mockPubConnect = jest.fn().mockResolvedValue('OK');
const mockSubQuit = jest.fn().mockResolvedValue('OK');
const mockSubConnect = jest.fn().mockResolvedValue('OK');
const mockPubOn = jest.fn();
const mockSubOn = jest.fn();

jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn(() => 'mock-redis-adapter'),
}));

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    duplicate: jest.fn().mockReturnValue({
      on: mockSubOn,
      connect: mockSubConnect,
      quit: mockSubQuit,
    }),
    on: mockPubOn,
    connect: mockPubConnect,
    quit: mockPubQuit,
  }));
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

type MockSocket = {
  id: string;
  handshake: { auth?: Record<string, unknown> };
  join: jest.Mock<Promise<void>, [string]>;
  disconnect: jest.Mock<void, [boolean?]>;
  data: Record<string, unknown>;
};

function createClient(token?: string): MockSocket {
  return {
    id: 'socket-1',
    handshake: token ? { auth: { token } } : { auth: {} },
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    data: {},
  };
}

describe('DashboardGateway', () => {
  let authService: jest.Mocked<Pick<AuthService, 'authenticateBearerToken'>>;
  let gateway: DashboardGateway;
  let middleware: (socket: any, next: (err?: Error) => void) => void;

  beforeEach(async () => {
    authService = {
      authenticateBearerToken: jest.fn(),
    };
    gateway = new DashboardGateway(authService);

    const mockServer = {
      use: jest.fn((fn) => {
        middleware = fn;
      }),
    };
    await gateway.afterInit(mockServer as unknown as Server);
  });

  describe('middleware authentication', () => {
    it('rejects connection when socket auth token is missing', async () => {
      const client = createClient();
      const next = jest.fn();

      await new Promise<void>((resolve) => {
        middleware(client, (...args: any[]) => {
          next(...args);
          resolve();
        });
      });

      expect(authService.authenticateBearerToken).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe('Unauthorized');
    });

    it('rejects connection when socket auth token is invalid', async () => {
      const client = createClient('bad-token');
      const next = jest.fn();
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
      expect(next.mock.calls[0][0].message).toBe('Unauthorized');
    });

    it('authenticates and attaches user data to socket from jwt tenantId', async () => {
      const client = createClient('jwt-token');
      const next = jest.fn();
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

      await gateway.handleConnection(client as unknown as Socket);

      expect(client.join).toHaveBeenCalledWith('tenant_tenant-a');
      expect(client.join).toHaveBeenCalledWith('user_user-1');

      const logCalls = loggerDebugSpy.mock.calls.map((call) => JSON.parse(call[0]));
      expect(logCalls).toContainEqual(
        expect.objectContaining({
          type: 'ws_connect',
          socketId: 'socket-1',
          tenantId: 'tenant-a',
          userId: 'user-1',
        }),
      );
    });
  });

  describe('handleDisconnect', () => {
    it('logs structured ws_disconnect event with socket metadata', () => {
      const client = createClient();
      client.data = { tenantId: 'tenant-a', userId: 'user-1' };
      const loggerDebugSpy = jest.spyOn((gateway as any).logger, 'debug');

      gateway.handleDisconnect(client as unknown as Socket);

      const logCalls = loggerDebugSpy.mock.calls.map((call) => JSON.parse(call[0]));
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
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as unknown as DashboardGateway['server'];

    const payload: DashboardEntityUpdatedPayload = {
      type: 'CUSTOMER',
      action: 'UPDATED',
      entityId: 'cust-1',
      timestamp: new Date().toISOString(),
    };

    gateway.emitEntityUpdated('tenant-a', payload);

    expect(to).toHaveBeenCalledWith('tenant_tenant-a');
    expect(emit).toHaveBeenCalledWith(DASHBOARD_ENTITY_UPDATED_EVENT, payload);
    const emittedPayload = emit.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(emittedPayload.tenantId).toBeUndefined();
  });

  it('emits claims refresh events only to the affected user room', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as unknown as DashboardGateway['server'];

    const payload: AuthClaimsUpdatedPayload = {
      reason: 'membership-updated',
      timestamp: new Date().toISOString(),
    };

    gateway.emitClaimsUpdated('user-1', payload);

    expect(to).toHaveBeenCalledWith('user_user-1');
    expect(emit).toHaveBeenCalledWith(AUTH_CLAIMS_UPDATED_EVENT, payload);
  });

  describe('Redis adapter initialization', () => {
    it('attaches Redis adapter when REDIS_URL is provided and connect succeeds', async () => {
      jest.clearAllMocks();
      const gatewayWithRedis = new DashboardGateway(authService);
      const mockServer = {
        use: jest.fn(),
        adapter: jest.fn(),
      };

      await gatewayWithRedis.afterInit(
        mockServer as unknown as Server,
        'redis://10.0.0.3:6379',
      );

      expect(Redis).toHaveBeenCalledWith('redis://10.0.0.3:6379', {
        lazyConnect: true,
      });
      expect(mockPubConnect).toHaveBeenCalled();
      expect(mockSubConnect).toHaveBeenCalled();
      expect(createAdapter).toHaveBeenCalled();
      expect(mockServer.adapter).toHaveBeenCalledWith('mock-redis-adapter');
    });

    it('does not attach adapter or log success when connect fails outside production', async () => {
      jest.clearAllMocks();
      mockPubConnect.mockRejectedValueOnce(new Error('Connection refused'));

      const gatewayWithRedis = new DashboardGateway(authService);
      const mockServer = {
        use: jest.fn(),
        adapter: jest.fn(),
      };

      await gatewayWithRedis.afterInit(
        mockServer as unknown as Server,
        'redis://10.0.0.3:6379',
      );

      expect(createAdapter).not.toHaveBeenCalled();
      expect(mockServer.adapter).not.toHaveBeenCalled();
    });

    it('throws critical error when connect fails in production', async () => {
      jest.clearAllMocks();
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      mockPubConnect.mockRejectedValueOnce(new Error('Connection refused'));

      const gatewayWithRedis = new DashboardGateway(authService);
      const mockServer = {
        use: jest.fn(),
        adapter: jest.fn(),
      };

      try {
        await expect(
          gatewayWithRedis.afterInit(
            mockServer as unknown as Server,
            'redis://10.0.0.3:6379',
          ),
        ).rejects.toThrow(/CRITICAL: Failed to connect to Redis at redis:\/\/10.0.0.3:6379/);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }

      expect(createAdapter).not.toHaveBeenCalled();
      expect(mockServer.adapter).not.toHaveBeenCalled();
    });

    it('keeps default in-memory adapter when REDIS_URL is unset', async () => {
      jest.clearAllMocks();
      const gatewayWithoutRedis = new DashboardGateway(authService);
      const mockServer = {
        use: jest.fn(),
        adapter: jest.fn(),
      };

      await gatewayWithoutRedis.afterInit(
        mockServer as unknown as Server,
        undefined,
      );

      expect(createAdapter).not.toHaveBeenCalled();
      expect(mockServer.adapter).not.toHaveBeenCalled();
    });

    it('cleans up Redis clients on module destroy', async () => {
      jest.clearAllMocks();
      const gatewayWithRedis = new DashboardGateway(authService);
      const mockServer = {
        use: jest.fn(),
        adapter: jest.fn(),
      };

      await gatewayWithRedis.afterInit(
        mockServer as unknown as Server,
        'redis://10.0.0.3:6379',
      );
      await gatewayWithRedis.onModuleDestroy();

      expect(mockPubQuit).toHaveBeenCalled();
      expect(mockSubQuit).toHaveBeenCalled();
    });
  });
});
