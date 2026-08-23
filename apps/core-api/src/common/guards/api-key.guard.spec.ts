import { ApiKeyGuard } from './api-key.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as crypto from 'crypto';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };

    guard = new ApiKeyGuard(reflector);

    process.env.API_KEY = 'test-api-key';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockContext = (headers: Record<string, string | string[]>) => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          headers,
          ip: '127.0.0.1',
          originalUrl: '/test-route',
        }),
      }),
    } as unknown as ExecutionContext;
  };

  it('should allow access if route is public', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = createMockContext({});

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw UnauthorizedException if API_KEY env variable is not set', () => {
    delete process.env.API_KEY;
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = createMockContext({ 'x-api-key': 'some-key' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if x-api-key header is missing', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = createMockContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if x-api-key is invalid', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = createMockContext({ 'x-api-key': 'invalid-key' });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should allow access if x-api-key is valid', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = createMockContext({ 'x-api-key': 'test-api-key' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access if x-api-key is an array containing the valid key', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const context = createMockContext({
      'x-api-key': ['test-api-key', 'other'],
    });

    expect(guard.canActivate(context)).toBe(true);
  });
});
