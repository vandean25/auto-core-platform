import { UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { TenantContextService } from './tenant-context.service';
import { TenantContextStorage } from './tenant-context.storage';
import { SiteContextService } from './site-context.service';
import type { SystemPrismaService } from '../../prisma/system-prisma.service';

const TENANT_ID = 'tenant-1';
const SITE_ID = 'site-1';
const FIREBASE_UID = 'firebase-user-1';

function createContext() {
  const findFirst = jest.fn();
  const systemPrisma = {
    user: { findFirst },
  } as unknown as SystemPrismaService;
  const tenantContext = new TenantContextService();

  return {
    service: new SiteContextService(systemPrisma, tenantContext),
    findFirst,
    tenantContext,
  };
}

function runWithAuthenticatedUser(
  tenantContext: TenantContextService,
  activeSiteId: string | null | undefined,
  callback: () => Promise<void>,
) {
  return TenantContextStorage.run(async () => {
    tenantContext.setAuthenticatedUser({
      userId: FIREBASE_UID,
      email: 'user@example.com',
      tenantId: TENANT_ID,
      role: 'ADMIN',
      activeSiteId,
    });

    await callback();
  });
}

describe('SiteContextService', () => {
  it('returns the session active site after validating current memberships', async () => {
    const { service, findFirst, tenantContext } = createContext();
    findFirst.mockResolvedValue({ active_site_id: SITE_ID });

    await runWithAuthenticatedUser(tenantContext, SITE_ID, async () => {
      await expect(service.getSiteId()).resolves.toBe(SITE_ID);
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        firebaseUid: FIREBASE_UID,
        active_tenant_id: TENANT_ID,
        active_site_id: SITE_ID,
        memberships: {
          some: {
            tenant_id: TENANT_ID,
            is_active: true,
          },
        },
        siteMemberships: {
          some: {
            tenant_id: TENANT_ID,
            site_id: SITE_ID,
            is_active: true,
            site: { is_active: true },
          },
        },
      },
      select: { active_site_id: true },
    });
  });

  it('rejects a missing session active site with the established semantic error', async () => {
    const { service, findFirst, tenantContext } = createContext();

    await runWithAuthenticatedUser(tenantContext, null, async () => {
      const error = await service.getSiteId().catch((caught) => caught);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getStatus()).toBe(422);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        message: 'An active site is required for this operation.',
        error: 'ACTIVE_SITE_REQUIRED',
      });
    });

    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects an inactive site or membership instead of accepting the session id', async () => {
    const { service, findFirst, tenantContext } = createContext();
    findFirst.mockResolvedValue(null);

    await runWithAuthenticatedUser(tenantContext, SITE_ID, async () => {
      await expect(service.getSiteId()).rejects.toMatchObject({
        status: 422,
      });
    });
  });

  it('does not use a default site when the authenticated session has no site', async () => {
    const originalDefaultSiteId = process.env.DEFAULT_SITE_ID;
    process.env.DEFAULT_SITE_ID = 'default-site';

    try {
      const { service, findFirst, tenantContext } = createContext();

      await runWithAuthenticatedUser(tenantContext, undefined, async () => {
        await expect(service.getSiteId()).rejects.toMatchObject({
          status: 422,
        });
      });

      expect(findFirst).not.toHaveBeenCalled();
    } finally {
      if (originalDefaultSiteId === undefined) {
        delete process.env.DEFAULT_SITE_ID;
      } else {
        process.env.DEFAULT_SITE_ID = originalDefaultSiteId;
      }
    }
  });
});
