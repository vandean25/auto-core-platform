import { ExecutionContext, CallHandler, HttpException, HttpStatus } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { HttpLoggingInterceptor } from './http-logging.interceptor';
import { TenantContextStorage } from '../services/tenant-context.storage';

describe('HttpLoggingInterceptor', () => {
  let interceptor: HttpLoggingInterceptor;
  let mockLoggerLog: jest.SpyInstance;
  let mockLoggerWarn: jest.SpyInstance;
  let mockLoggerError: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new HttpLoggingInterceptor();
    mockLoggerLog = jest.spyOn((interceptor as any).logger, 'log').mockImplementation();
    mockLoggerWarn = jest.spyOn((interceptor as any).logger, 'warn').mockImplementation();
    mockLoggerError = jest.spyOn((interceptor as any).logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createMockExecutionContext(options: {
    method?: string;
    url?: string;
    statusCode?: number;
    headers?: Record<string, string>;
    body?: unknown;
  }): ExecutionContext {
    const request = {
      method: options.method ?? 'GET',
      originalUrl: options.url ?? '/api/customers',
      url: options.url ?? '/api/customers',
      headers: options.headers ?? { 'user-agent': 'JestTestRunner' },
      ip: '127.0.0.1',
      body: options.body ?? { password: 'secret-password-123', name: 'Acme' },
    };

    const response = {
      statusCode: options.statusCode ?? 200,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
      getType: () => 'http',
    } as unknown as ExecutionContext;
  }

  it('logs successful HTTP request completion with structured fields', async () => {
    const context = createMockExecutionContext({
      method: 'POST',
      url: '/api/customers',
      statusCode: 201,
      headers: {
        authorization: 'Bearer secret-jwt-token',
        'x-request-id': 'req-12345',
      },
      body: { name: 'Acme Corp', apiKey: 'secret-key' },
    });

    const callHandler: CallHandler = {
      handle: () => of({ id: 'cust-1', name: 'Acme Corp' }),
    };

    await TenantContextStorage.run(async () => {
      TenantContextStorage.setUser({
        userId: 'user-abc',
        email: 'admin@acme.com',
        role: 'ADMIN',
        tenantId: 'tenant-123',
      });
      TenantContextStorage.setRequestMeta({
        requestId: 'req-12345',
        source: 'API',
        ip: '192.168.1.1',
        userAgent: 'JestClient/1.0',
      });

      const observable = interceptor.intercept(context, callHandler);
      await new Promise<void>((resolve, reject) => {
        observable.subscribe({
          next: () => {},
          complete: resolve,
          error: reject,
        });
      });
    });

    expect(mockLoggerLog).toHaveBeenCalledTimes(1);
    const loggedRaw = mockLoggerLog.mock.calls[0][0];
    const logged = JSON.parse(loggedRaw);

    expect(logged).toEqual(
      expect.objectContaining({
        type: 'http_request',
        requestId: 'req-12345',
        method: 'POST',
        path: '/api/customers',
        statusCode: 201,
        tenantId: 'tenant-123',
        actorId: 'user-abc',
        ip: '192.168.1.1',
      }),
    );
    expect(typeof logged.durationMs).toBe('number');
    expect(logged.durationMs).toBeGreaterThanOrEqual(0);

    // Strict security check: payload or sensitive headers must NEVER be present in the log output
    expect(loggedRaw).not.toContain('secret-jwt-token');
    expect(loggedRaw).not.toContain('secret-password-123');
    expect(loggedRaw).not.toContain('secret-key');
  });

  it('skips logging for unauthenticated health probes', async () => {
    const context = createMockExecutionContext({
      method: 'GET',
      url: '/api/health',
      statusCode: 200,
    });

    const callHandler: CallHandler = {
      handle: () => of({ status: 'ok' }),
    };

    // No TenantContextStorage context
    const observable = interceptor.intercept(context, callHandler);
    await new Promise<void>((resolve, reject) => {
      observable.subscribe({
        next: () => {},
        complete: resolve,
        error: reject,
      });
    });

    expect(mockLoggerLog).not.toHaveBeenCalled();
  });

  it('logs failed request with error status and duration', async () => {
    const context = createMockExecutionContext({
      method: 'GET',
      url: '/api/orders/999',
      statusCode: 404,
    });

    const error = new HttpException('Order not found', HttpStatus.NOT_FOUND);
    const callHandler: CallHandler = {
      handle: () => throwError(() => error),
    };

    await TenantContextStorage.run(async () => {
      TenantContextStorage.setRequestMeta({
        requestId: 'req-err-1',
        source: 'API',
        ip: '127.0.0.1',
      });

      const observable = interceptor.intercept(context, callHandler);
      await expect(
        new Promise<void>((resolve, reject) => {
          observable.subscribe({
            next: () => {},
            complete: resolve,
            error: reject,
          });
        }),
      ).rejects.toThrow(error);
    });

    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(mockLoggerWarn.mock.calls[0][0]);

    expect(logged).toEqual(
      expect.objectContaining({
        type: 'http_request',
        requestId: 'req-err-1',
        method: 'GET',
        path: '/api/orders/999',
        statusCode: 404,
        errorName: 'HttpException',
      }),
    );
    expect(typeof logged.durationMs).toBe('number');
  });

  it('logs 500 server error at error level with duration and request ID', async () => {
    const context = createMockExecutionContext({
      method: 'POST',
      url: '/api/invoices',
    });

    const error = new Error('Database connection reset');
    const callHandler: CallHandler = {
      handle: () => throwError(() => error),
    };

    await TenantContextStorage.run(async () => {
      TenantContextStorage.setRequestMeta({
        requestId: 'req-500',
        source: 'API',
      });

      const observable = interceptor.intercept(context, callHandler);
      await expect(
        new Promise<void>((resolve, reject) => {
          observable.subscribe({
            next: () => {},
            complete: resolve,
            error: reject,
          });
        }),
      ).rejects.toThrow('Database connection reset');
    });

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(mockLoggerError.mock.calls[0][0]);

    expect(logged).toEqual(
      expect.objectContaining({
        type: 'http_request',
        requestId: 'req-500',
        method: 'POST',
        path: '/api/invoices',
        statusCode: 500,
        errorName: 'Error',
      }),
    );
  });
});
