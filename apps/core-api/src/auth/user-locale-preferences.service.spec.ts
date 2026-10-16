import { DisplayLanguage } from '@prisma/client';
import { UserLocalePreferencesService } from './user-locale-preferences.service.js';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';

describe('UserLocalePreferencesService', () => {
  const tenantId = 'tenant-1';
  const firebaseUid = 'firebase-1';
  const userId = 'user-1';

  function createService(
    userRow: {
      locale: DisplayLanguage | null;
      active_tenant_id: string | null;
      memberships: Array<{
        tenant_id: string;
        is_active: boolean;
        demo_access_expires_at: Date | null;
        tenant: {
          default_locale: DisplayLanguage;
          format_locale: string;
          is_active: boolean;
        };
      }>;
    },
  ) {
    const systemPrisma = {
      user: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    systemPrisma.user.findFirst.mockResolvedValue({
      id: userId,
      firebaseUid,
      ...userRow,
    });
    return {
      service: new UserLocalePreferencesService(
        systemPrisma as unknown as SystemPrismaService,
      ),
      systemPrisma,
    };
  }

  it('ignores expired demo tenant when resolving active_tenant_id defaults', async () => {
    const expired = new Date('2020-01-01T00:00:00.000Z');
    const { service } = createService({
      locale: null,
      active_tenant_id: tenantId,
      memberships: [
        {
          tenant_id: tenantId,
          is_active: true,
          demo_access_expires_at: expired,
          tenant: {
            default_locale: 'en',
            format_locale: 'de-AT',
            is_active: true,
          },
        },
      ],
    });

    const result = await service.getForPrincipal({
      userId: firebaseUid,
      email: 'u@example.com',
      tenantId,
      role: 'ADMIN',
    });

    expect(result).toMatchObject({
      defaultLocale: 'de',
      effectiveLocale: 'de',
      formatLocale: 'de-AT',
    });
  });

  it('persists locale after resolving tenant defaults', async () => {
    const { service, systemPrisma } = createService({
      locale: 'de',
      active_tenant_id: tenantId,
      memberships: [
        {
          tenant_id: tenantId,
          is_active: true,
          demo_access_expires_at: null,
          tenant: {
            default_locale: 'en',
            format_locale: 'de-AT',
            is_active: true,
          },
        },
      ],
    });

    const membership = [
      {
        tenant_id: tenantId,
        is_active: true,
        demo_access_expires_at: null,
        tenant: {
          default_locale: 'en' as const,
          format_locale: 'de-AT',
          is_active: true,
        },
      },
    ];
    systemPrisma.user.findFirst
      .mockResolvedValueOnce({
        id: userId,
        firebaseUid,
        locale: 'de',
        active_tenant_id: tenantId,
        memberships: membership,
      })
      .mockResolvedValueOnce({
        id: userId,
        firebaseUid,
        locale: 'en',
        active_tenant_id: tenantId,
        memberships: membership,
      });

    const result = await service.patchForPrincipal(
      {
        userId: firebaseUid,
        email: 'u@example.com',
        tenantId,
        role: 'ADMIN',
      },
      'en',
    );

    expect(systemPrisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { locale: 'en' },
    });
    expect(result.effectiveLocale).toBe('en');
  });
});
