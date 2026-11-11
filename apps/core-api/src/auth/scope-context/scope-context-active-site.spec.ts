import { describe, expect, it, jest } from '@jest/globals';
import {
  findValidatedActiveSiteIdForTenant,
  type ScopeContextSiteReader,
} from './scope-context-active-site.js';

type SiteUserSnapshot = {
  active_tenant_id: string | null;
  active_site_id: string | null;
} | null;

function createSiteReader(
  findFirst: jest.Mock<() => Promise<SiteUserSnapshot>>,
): ScopeContextSiteReader {
  return { user: { findFirst } };
}

describe('findValidatedActiveSiteIdForTenant (AUT-937)', () => {
  it('returns null when active_tenant does not match the session tenant', async () => {
    const findFirst = jest.fn<() => Promise<SiteUserSnapshot>>(async () => ({
      active_tenant_id: 'other-tenant',
      active_site_id: 'site-1',
    }));
    const db = createSiteReader(findFirst);

    await expect(
      findValidatedActiveSiteIdForTenant(db, 'uid', 'tenant-a'),
    ).resolves.toBeNull();
  });

  it('returns null when site membership is inactive', async () => {
    const findFirst = jest.fn<() => Promise<SiteUserSnapshot>>();
    findFirst
      .mockResolvedValueOnce({
        active_tenant_id: 'tenant-a',
        active_site_id: 'site-1',
      })
      .mockResolvedValueOnce(null);
    const db = createSiteReader(findFirst);

    await expect(
      findValidatedActiveSiteIdForTenant(db, 'uid', 'tenant-a'),
    ).resolves.toBeNull();
  });

  it('returns the site when membership and site are active', async () => {
    const findFirst = jest.fn<() => Promise<SiteUserSnapshot>>();
    findFirst
      .mockResolvedValueOnce({
        active_tenant_id: 'tenant-a',
        active_site_id: 'site-1',
      })
      .mockResolvedValueOnce({
        active_tenant_id: 'tenant-a',
        active_site_id: 'site-1',
      });
    const db = createSiteReader(findFirst);

    await expect(
      findValidatedActiveSiteIdForTenant(db, 'uid', 'tenant-a'),
    ).resolves.toBe('site-1');
  });
});
