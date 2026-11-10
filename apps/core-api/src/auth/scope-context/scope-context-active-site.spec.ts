import { describe, expect, it, jest } from '@jest/globals';
import { findValidatedActiveSiteIdForTenant } from './scope-context-active-site.js';

describe('findValidatedActiveSiteIdForTenant (AUT-937)', () => {
  it('returns null when active_tenant does not match the session tenant', async () => {
    const db = {
      user: {
        findFirst: jest.fn(async () => ({
          active_tenant_id: 'other-tenant',
          active_site_id: 'site-1',
        })),
      },
    };

    await expect(
      findValidatedActiveSiteIdForTenant(db, 'uid', 'tenant-a'),
    ).resolves.toBeNull();
  });

  it('returns null when site membership is inactive', async () => {
    const db = {
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            active_tenant_id: 'tenant-a',
            active_site_id: 'site-1',
          })
          .mockResolvedValueOnce(null),
      },
    };

    await expect(
      findValidatedActiveSiteIdForTenant(db, 'uid', 'tenant-a'),
    ).resolves.toBeNull();
  });

  it('returns the site when membership and site are active', async () => {
    const db = {
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            active_tenant_id: 'tenant-a',
            active_site_id: 'site-1',
          })
          .mockResolvedValueOnce({ active_site_id: 'site-1' }),
      },
    };

    await expect(
      findValidatedActiveSiteIdForTenant(db, 'uid', 'tenant-a'),
    ).resolves.toBe('site-1');
  });
});
