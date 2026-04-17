import {
  ExecutionContext,
  InternalServerErrorException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { CloudTasksWorkerGuard } from './cloud-tasks-worker.guard';

describe('CloudTasksWorkerGuard', () => {
  let guard: CloudTasksWorkerGuard;

  beforeEach(() => {
    guard = new CloudTasksWorkerGuard();
    process.env.CLOUD_TASKS_WORKER_SECRET = 'valid-secret';
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.CLOUD_TASKS_WORKER_SECRET;
    jest.restoreAllMocks();
  });

  const createMockContext = (
    headers: Record<string, any>,
    ip: string = '127.0.0.1',
    originalUrl: string = '/path',
  ) => {
    const mockRequest = { headers, ip, originalUrl };
    return {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;
  };

  it('should throw InternalServerErrorException if env secret is missing', () => {
    delete process.env.CLOUD_TASKS_WORKER_SECRET;
    const context = createMockContext({
      'x-cloud-tasks-secret': 'valid-secret',
    });
    expect(() => guard.canActivate(context)).toThrow(
      InternalServerErrorException,
    );
  });

  it('should return true if valid secret is provided as string', () => {
    const context = createMockContext({
      'x-cloud-tasks-secret': 'valid-secret',
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should return true if valid secret is provided as first element of an array', () => {
    const context = createMockContext({
      'x-cloud-tasks-secret': ['valid-secret', 'another-secret'],
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw UnauthorizedException and log warning if secret is invalid', () => {
    const context = createMockContext(
      { 'x-cloud-tasks-secret': 'invalid-secret' },
      '192.168.1.1',
      '/test',
    );
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'Invalid Cloud Tasks worker secret attempt from IP: 192.168.1.1 for route: /test',
    );
  });

  it('should throw UnauthorizedException if header is completely missing', () => {
    const context = createMockContext({});
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });
});
