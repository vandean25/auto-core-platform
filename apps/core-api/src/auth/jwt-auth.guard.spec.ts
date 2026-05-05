import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { MECHANIC_ACCESSIBLE_KEY } from '../common/decorators/mechanic-accessible.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ALLOW_PLATFORM_ADMIN_KEY } from '../common/decorators/allow-platform-admin.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

const TECH_USER = {
  userId: 'firebase-uid-tech',
  email: 'mechanic@workshop.at',
  tenantId: 'tenant-1',
  role: 'TECH',
};

const ADMIN_USER = {
  userId: 'firebase-uid-admin',
  email: 'admin@workshop.at',
  tenantId: 'tenant-1',
  role: 'ADMIN',
};

function createContext(
  user: object,
  metadata: Record<string, boolean> = {},
): ExecutionContext {
  const mockRequest = {
    headers: { authorization: 'Bearer test-token' },
    user: undefined as unknown,
  };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => mockRequest,
    }),
    // The Reflector reads from handler/class; we stub it externally per test.
    _metadata: metadata,
    _user: user,
  } as unknown as ExecutionContext;
}

function buildGuard(
  user: object,
  handlerMetadata: Record<string, boolean> = {},
): { guard: JwtAuthGuard; context: ExecutionContext } {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key: unknown) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ALLOW_PLATFORM_ADMIN_KEY) return false;
      if (key === MECHANIC_ACCESSIBLE_KEY)
        return handlerMetadata[MECHANIC_ACCESSIBLE_KEY] ?? false;
      return undefined;
    });

  const authService = {
    authenticateBearerToken: jest.fn<() => Promise<object>>().mockResolvedValue(user),
  };

  const tenantContext = {
    setAuthenticatedUser: jest.fn<() => void>(),
  };

  const guard = new JwtAuthGuard(
    reflector,
    authService as never,
    tenantContext as never,
  );

  const mockRequest = {
    headers: { authorization: 'Bearer test-token' },
    user: undefined as unknown,
  };

  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => mockRequest }),
  } as unknown as ExecutionContext;

  return { guard, context };
}

describe('JwtAuthGuard — mechanic-mode restrictions (ADR-0014 §8.2)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('allows TECH user to access an endpoint marked @MechanicAccessible()', async () => {
    const { guard, context } = buildGuard(TECH_USER, {
      [MECHANIC_ACCESSIBLE_KEY]: true,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects TECH user attempting to access a back-office endpoint', async () => {
    const { guard, context } = buildGuard(TECH_USER, {
      [MECHANIC_ACCESSIBLE_KEY]: false,
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects TECH user with a descriptive error message', async () => {
    const { guard, context } = buildGuard(TECH_USER, {
      [MECHANIC_ACCESSIBLE_KEY]: false,
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Mechanic-mode sessions may only access /api/mechanic/* endpoints.',
    );
  });

  it('allows non-TECH (ADMIN) user to access a back-office endpoint', async () => {
    const { guard, context } = buildGuard(ADMIN_USER, {
      [MECHANIC_ACCESSIBLE_KEY]: false,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows non-TECH (SALES) user to access a back-office endpoint', async () => {
    const { guard, context } = buildGuard(
      { ...ADMIN_USER, role: 'SALES' },
      { [MECHANIC_ACCESSIBLE_KEY]: false },
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
