import { JwtService } from '@nestjs/jwt'
import { AuthService } from './auth.service'
import type { AuthenticatedUser } from './types/authenticated-user'

const getFirebaseAdminAuth = jest.fn()

jest.mock('./firebase-admin', () => ({
  getFirebaseAdminAuth: () => getFirebaseAdminAuth(),
}))

describe('AuthService Firebase verification', () => {
  const prisma = {
    tenant: {
      findFirst: jest.fn(),
    },
  }
  const authSessionService = {
    resolveTenantUser: jest.fn<Promise<AuthenticatedUser | null>, [unknown]>(),
  }

  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.FIREBASE_PROJECT_ID = 'auto-core-platform'
    getFirebaseAdminAuth.mockReset()
    prisma.tenant.findFirst.mockReset()
    authSessionService.resolveTenantUser.mockReset()
  })

  afterEach(() => {
    delete process.env.FIREBASE_PROJECT_ID
    delete process.env.NODE_ENV
  })

  it('resolves membership from the database for verified Firebase tokens', async () => {
    const firebaseAuth = {
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'firebase-user-id',
        email: 'testauto@auto.core.at',
      }),
    }

    getFirebaseAdminAuth.mockReturnValue(firebaseAuth)

    authSessionService.resolveTenantUser.mockResolvedValue({
      userId: 'firebase-user-id',
      email: 'testauto@auto.core.at',
      tenantId: 'tenant-a',
      role: 'ADMIN',
    })

    const authService = new AuthService(
      prisma as never,
      authSessionService as never,
      new JwtService(),
    )

    await expect(
      authService.authenticateBearerToken('Bearer verified-token'),
    ).resolves.toEqual({
      userId: 'firebase-user-id',
      email: 'testauto@auto.core.at',
      tenantId: 'tenant-a',
      role: 'ADMIN',
    })

    expect(getFirebaseAdminAuth).toHaveBeenCalledTimes(1)
    expect(firebaseAuth.verifyIdToken).toHaveBeenCalledWith('verified-token')
    expect(authSessionService.resolveTenantUser).toHaveBeenCalledWith({
      sub: 'firebase-user-id',
      email: 'testauto@auto.core.at',
      tenantId: undefined,
      role: undefined,
      platformRole: undefined,
      iss: undefined,
    })
  })
})
