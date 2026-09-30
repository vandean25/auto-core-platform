import { jest } from '@jest/globals';
import type { Server } from 'socket.io';
import { Logger } from '@nestjs/common';

const mockCreateAdapter = jest.fn(() => 'mock-redis-adapter');
const mockPubQuit = jest.fn().mockResolvedValue('OK');
const mockPubConnect = jest.fn().mockResolvedValue('OK');
const mockSubQuit = jest.fn().mockResolvedValue('OK');
const mockSubConnect = jest.fn().mockResolvedValue('OK');
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
const {
  resolveRedisUrl,
  connectRedisClients,
  getRootSocketServer,
  setupRedisAdapter,
  REDIS_CONNECT_TIMEOUT_MS,
} = await import('./dashboard-redis.adapter.js');

describe('dashboard-redis.adapter', () => {
  describe('resolveRedisUrl', () => {
    it('returns undefined when redisUrl is undefined, empty, or whitespace', () => {
      expect(resolveRedisUrl(undefined)).toBeUndefined();
      expect(resolveRedisUrl('')).toBeUndefined();
      expect(resolveRedisUrl('   ')).toBeUndefined();
    });

    it('returns trimmed URL when redisUrl is provided', () => {
      expect(resolveRedisUrl('  redis://localhost:6379  ')).toBe(
        'redis://localhost:6379',
      );
    });

    it('falls back to process.env.REDIS_URL when called with no arguments', () => {
      const originalEnv = process.env.REDIS_URL;
      try {
        process.env.REDIS_URL = 'redis://env-host:6379';
        expect(resolveRedisUrl()).toBe('redis://env-host:6379');
      } finally {
        process.env.REDIS_URL = originalEnv;
      }
    });
  });

  describe('connectRedisClients', () => {
    it('resolves when connect completes within timeout', async () => {
      const connect = jest.fn().mockResolvedValue('OK');
      await expect(connectRedisClients(connect, 100)).resolves.toBeUndefined();
      expect(connect).toHaveBeenCalledTimes(1);
    });

    it('rejects when connect exceeds timeout', async () => {
      const connect = () => new Promise((resolve) => setTimeout(resolve, 50));
      await expect(connectRedisClients(connect, 10)).rejects.toThrow(
        'Redis connect timed out after 10ms',
      );
    });
  });

  describe('getRootSocketServer', () => {
    it('returns undefined for non-objects or nullish values', () => {
      expect(getRootSocketServer(undefined)).toBeUndefined();
      expect(getRootSocketServer(null)).toBeUndefined();
      expect(getRootSocketServer('not-an-object')).toBeUndefined();
      expect(getRootSocketServer(123)).toBeUndefined();
    });

    it('returns server if server itself has adapter function', () => {
      const server = { adapter: jest.fn() };
      expect(getRootSocketServer(server)).toBe(server);
    });

    it('returns candidate.server if server is a namespace with nested root server', () => {
      const rootServer = { adapter: jest.fn() };
      const namespace = { server: rootServer };
      expect(getRootSocketServer(namespace)).toBe(rootServer);
    });

    it('returns undefined if neither server nor candidate.server has an adapter function', () => {
      expect(getRootSocketServer({})).toBeUndefined();
      expect(getRootSocketServer({ server: {} })).toBeUndefined();
      expect(getRootSocketServer({ adapter: 'not-a-function' })).toBeUndefined();
    });
  });

  describe('setupRedisAdapter', () => {
    const logger = new Logger('Test');

    beforeEach(() => {
      jest.clearAllMocks();
      mockPubConnect.mockResolvedValue('OK');
      mockSubConnect.mockResolvedValue('OK');
    });

    it('successfully connects clients and configures adapter on root server', async () => {
      const mockServer = {
        adapter: jest.fn(),
      } as unknown as Server;

      const result = await setupRedisAdapter(
        mockServer,
        'redis://localhost:6379',
        logger,
      );

      expect(mockPubConnect).toHaveBeenCalled();
      expect(mockSubConnect).toHaveBeenCalled();
      expect(createAdapter).toHaveBeenCalled();
      expect(mockServer.adapter).toHaveBeenCalledWith('mock-redis-adapter');
      expect(result.pubClient).toBeDefined();
      expect(result.subClient).toBeDefined();
    });

    it('registers error event listeners on both pub and sub clients', async () => {
      const mockServer = {
        adapter: jest.fn(),
      } as unknown as Server;

      await setupRedisAdapter(mockServer, 'redis://localhost:6379', logger);

      expect(mockPubOn).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockSubOn).toHaveBeenCalledWith('error', expect.any(Function));

      // Invoke listener callbacks to verify error formatting
      const pubErrorHandler = mockPubOn.mock.calls.find(
        (call: any[]) => call[0] === 'error',
      )?.[1] as (err: any) => void;
      const subErrorHandler = mockSubOn.mock.calls.find(
        (call: any[]) => call[0] === 'error',
      )?.[1] as (err: any) => void;

      expect(pubErrorHandler).toBeDefined();
      expect(subErrorHandler).toBeDefined();
      expect(() => pubErrorHandler(new Error('Pub failure'))).not.toThrow();
      expect(() => pubErrorHandler('Pub failure string')).not.toThrow();
      expect(() => subErrorHandler(new Error('Sub failure'))).not.toThrow();
      expect(() => subErrorHandler('Sub failure string')).not.toThrow();
    });

    it('handles connection error outside production by quitting clients and returning empty object', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      mockPubConnect.mockRejectedValueOnce(new Error('Connection failed'));

      try {
        const mockServer = {
          adapter: jest.fn(),
        } as unknown as Server;

        const result = await setupRedisAdapter(
          mockServer,
          'redis://localhost:6379',
          logger,
        );

        expect(result).toEqual({});
        expect(mockPubQuit).toHaveBeenCalled();
        expect(mockSubQuit).toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('throws critical error when Redis connection fails in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      mockPubConnect.mockRejectedValueOnce(new Error('Connection refused'));

      try {
        const mockServer = {
          adapter: jest.fn(),
        } as unknown as Server;

        await expect(
          setupRedisAdapter(mockServer, 'redis://prod:6379', logger),
        ).rejects.toThrow(
          /CRITICAL: Failed to connect to Redis at redis:\/\/prod:6379 in production: Connection refused/,
        );

        expect(mockPubQuit).toHaveBeenCalled();
        expect(mockSubQuit).toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('cleans up and rejects if root socket server cannot be resolved', async () => {
      const invalidServer = {} as unknown as Server;

      await expect(
        setupRedisAdapter(invalidServer, 'redis://localhost:6379', logger),
      ).resolves.toEqual({});

      expect(mockPubQuit).toHaveBeenCalled();
      expect(mockSubQuit).toHaveBeenCalled();
    });
  });
});
