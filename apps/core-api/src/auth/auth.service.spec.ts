import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './types/authenticated-user';

const getFirebaseAdminAuth = jest.fn();

jest.mock('./firebase-admin', () => ({
  getFirebaseAdminAuth: () => getFirebaseAdminAuth(),
}));

describe('AuthService Firebase verification', () => {
  const authSessionService = {
    resolveTenantUser: jest.fn<Promise<AuthenticatedUser | null>, [unknown]>(),
    resolvePlatformAdmin: jest.fn<
      Promise<AuthenticatedUser | null>,
      [unknown]
    >(),
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.FIREBASE_PROJECT_ID = 'auto-core-platform';
    getFirebaseAdminAuth.mockReset();
    authSessionService.resolveTenantUser.mockReset();
    authSessionService.resolvePlatformAdmin.mockReset();
    authSessionService.resolvePlatformAdmin.mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.NODE_ENV;
  });

  function createAuthService() {
    return new AuthService(authSessionService as never, new JwtService());
  }

  it('resolves membership from the database for verified Firebase tokens', async () => {
    const firebaseAuth = {
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'firebase-user-id',
        email: 'testauto@auto.core.at',
      }),
    };

    getFirebaseAdminAuth.mockReturnValue(firebaseAuth);

    authSessionService.resolveTenantUser.mockResolvedValue({
      userId: 'firebase-user-id',
      email: 'testauto@auto.core.at',
      tenantId: 'tenant-a',
      role: 'ADMIN',
    });

    const authService = createAuthService();

    await expect(
      authService.authenticateBearerToken('Bearer verified-token'),
    ).resolves.toEqual({
      userId: 'firebase-user-id',
      email: 'testauto@auto.core.at',
      tenantId: 'tenant-a',
      role: 'ADMIN',
    });

    expect(getFirebaseAdminAuth).toHaveBeenCalledTimes(1);
    expect(firebaseAuth.verifyIdToken).toHaveBeenCalledWith('verified-token');
    expect(authSessionService.resolveTenantUser).toHaveBeenCalledWith({
      sub: 'firebase-user-id',
      email: 'testauto@auto.core.at',
      tenantId: undefined,
      role: undefined,
      platformRole: undefined,
      iss: undefined,
    });
  });

  it('rejects a valid token with tenantId and role claims when membership is missing', async () => {
    authSessionService.resolveTenantUser.mockResolvedValue(null);

    const authService = createAuthService();
    const token = authService.createTestToken({
      sub: 'firebase-user-id',
      email: 'missing-member@auto.core.at',
      tenantId: 'tenant-a',
      role: 'ADMIN',
    });

    await expect(
      authService.authenticateBearerToken(`Bearer ${token}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(authSessionService.resolveTenantUser).toHaveBeenCalled();
  });

  it('rejects a deactivated membership even when stale tenantId and role claims remain', async () => {
    authSessionService.resolveTenantUser.mockResolvedValue(null);

    const authService = createAuthService();
    const token = authService.createTestToken({
      sub: 'firebase-user-id',
      email: 'deactivated@auto.core.at',
      tenantId: 'tenant-a',
      role: 'ADMIN',
    });

    await expect(
      authService.authenticateBearerToken(`Bearer ${token}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('authorizes tenant and role from Postgres, ignoring stale token claims', async () => {
    authSessionService.resolveTenantUser.mockResolvedValue({
      userId: 'firebase-user-id',
      email: 'testauto@auto.core.at',
      tenantId: 'tenant-db',
      role: 'ADMIN',
    });

    const authService = createAuthService();
    const token = authService.createTestToken({
      sub: 'firebase-user-id',
      email: 'testauto@auto.core.at',
      tenantId: 'tenant-stale',
      role: 'SALES',
    });

    await expect(
      authService.authenticateBearerToken(`Bearer ${token}`),
    ).resolves.toEqual({
      userId: 'firebase-user-id',
      email: 'testauto@auto.core.at',
      tenantId: 'tenant-db',
      role: 'ADMIN',
    });
  });

  it('rejects platform-admin access when only a platformRole claim is present', async () => {
    authSessionService.resolveTenantUser.mockResolvedValue(null);
    authSessionService.resolvePlatformAdmin.mockResolvedValue(null);

    const authService = createAuthService();
    const token = authService.createTestToken({
      sub: 'platform-user-id',
      email: 'platform@auto.core.at',
      tenantId: undefined,
      role: undefined,
      platformRole: 'SUPER_ADMIN',
    });

    await expect(
      authService.authenticateBearerToken(`Bearer ${token}`, {
        allowPlatformAdmin: true,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(authSessionService.resolvePlatformAdmin).toHaveBeenCalled();
  });

  it('accepts platform-admin access from an active PlatformAdmin row, not the token claim', async () => {
    authSessionService.resolveTenantUser.mockResolvedValue(null);
    authSessionService.resolvePlatformAdmin.mockResolvedValue({
      userId: 'platform-user-id',
      email: 'platform@auto.core.at',
      platformRole: 'SUPER_ADMIN',
    });

    const authService = createAuthService();
    const token = authService.createTestToken({
      sub: 'platform-user-id',
      email: 'claims-email@auto.core.at',
      tenantId: undefined,
      role: undefined,
      platformRole: 'SUPER_ADMIN',
    });

    await expect(
      authService.authenticateBearerToken(`Bearer ${token}`, {
        allowPlatformAdmin: true,
      }),
    ).resolves.toEqual({
      userId: 'platform-user-id',
      email: 'platform@auto.core.at',
      platformRole: 'SUPER_ADMIN',
    });
  });
});
