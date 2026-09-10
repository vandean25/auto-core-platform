import { describe, expect, it, jest } from '@jest/globals';
import type { SystemPrismaService } from '../prisma/system-prisma.service';
import { AuthSessionService } from './auth-session.service';

const ACTIVE_TENANT_ID = 'tenant-1';
const ACTIVE_SITE_ID = 'site-1';

describe('AuthSessionService active-site session projection', () => {
  it('projects User.active_site_id into the authenticated tenant user', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'user-1',
      firebaseUid: 'firebase-user-1',
      email: 'user@example.com',
      active_tenant_id: ACTIVE_TENANT_ID,
      active_site_id: ACTIVE_SITE_ID,
      platformAdmin: null,
      memberships: [
        {
          tenant_id: ACTIVE_TENANT_ID,
          role: 'ADMIN',
          is_active: true,
          tenant: {
            id: ACTIVE_TENANT_ID,
            name: 'Tenant One',
            slug: 'tenant-one',
            is_active: true,
          },
        },
      ],
    });
    const systemPrisma = {
      user: { findFirst },
    } as unknown as SystemPrismaService;

    const service = new AuthSessionService(systemPrisma);
    const authenticatedUser = await service.resolveTenantUser({
      sub: 'firebase-user-1',
      email: 'user@example.com',
    });

    expect(authenticatedUser).toEqual(
      expect.objectContaining({
        tenantId: ACTIVE_TENANT_ID,
        activeSiteId: ACTIVE_SITE_ID,
      }),
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ active_site_id: true }),
      }),
    );
  });
});
