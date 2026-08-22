import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let mockReflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: jest.fn(),
    } as any;
    guard = new ApiKeyGuard(mockReflector);
    process.env.API_KEY = 'test-secret';
  });

  afterEach(() => {
    delete process.env.API_KEY;
    jest.clearAllMocks();
  });

  const createMockContext = (
    headers: Record<string, any> = {},
  ): ExecutionContext => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as any;
  };

  it('allows public routes', () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);
    const ctx = createMockContext();
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws UnauthorizedException if API_KEY env var is missing', () => {
    delete process.env.API_KEY;
    const ctx = createMockContext({ 'x-api-key': 'test-secret' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('allows access with correct string key', () => {
    const ctx = createMockContext({ 'x-api-key': 'test-secret' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows access with correct array key', () => {
    const ctx = createMockContext({ 'x-api-key': ['test-secret', 'ignored'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws UnauthorizedException with incorrect key', () => {
    const ctx = createMockContext({ 'x-api-key': 'wrong-secret' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when header is missing', () => {
    const ctx = createMockContext({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
