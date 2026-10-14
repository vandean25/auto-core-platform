import type { ListTenantMembersQueryDto } from './dto/tenant-member.dto.js';
import {
  buildTenantMemberListMeta,
  buildTenantMemberWhere,
  resolveTenantMemberPagination,
} from './tenant-member.queries.js';

describe('tenant-member queries', () => {
  describe('resolveTenantMemberPagination', () => {
    it('defaults to the first page with 25 rows', () => {
      expect(resolveTenantMemberPagination({})).toEqual({
        page: 1,
        limit: 25,
        skip: 0,
      });
    });

    it('clamps the page to at least 1 and the limit to the 1..100 range', () => {
      expect(resolveTenantMemberPagination({ page: 0, limit: 500 })).toEqual({
        page: 1,
        limit: 100,
        skip: 0,
      });
      expect(resolveTenantMemberPagination({ page: -3, limit: 0 })).toEqual({
        page: 1,
        limit: 1,
        skip: 0,
      });
    });

    it('derives the skip offset from the page and limit', () => {
      expect(resolveTenantMemberPagination({ page: 3, limit: 10 })).toEqual({
        page: 3,
        limit: 10,
        skip: 20,
      });
    });
  });

  describe('buildTenantMemberWhere', () => {
    it('scopes to the tenant and to active memberships by default', () => {
      expect(buildTenantMemberWhere('tenant-a', {})).toEqual({
        tenant_id: 'tenant-a',
        is_active: true,
      });
    });

    it('drops the active filter when inactive memberships are requested', () => {
      expect(
        buildTenantMemberWhere('tenant-a', { includeInactive: true }),
      ).toEqual({ tenant_id: 'tenant-a' });
    });

    it('matches trimmed search text against email, first name and last name', () => {
      expect(buildTenantMemberWhere('tenant-a', { search: '  ada  ' })).toEqual(
        {
          tenant_id: 'tenant-a',
          is_active: true,
          OR: [
            {
              user: { is: { email: { contains: 'ada', mode: 'insensitive' } } },
            },
            {
              user: {
                is: { firstName: { contains: 'ada', mode: 'insensitive' } },
              },
            },
            {
              user: {
                is: { lastName: { contains: 'ada', mode: 'insensitive' } },
              },
            },
          ],
        },
      );
    });

    it('ignores blank search text', () => {
      const query: ListTenantMembersQueryDto = { search: '   ' };

      expect(buildTenantMemberWhere('tenant-a', query)).toEqual({
        tenant_id: 'tenant-a',
        is_active: true,
      });
    });
  });

  describe('buildTenantMemberListMeta', () => {
    it('computes the page count from the total and the limit', () => {
      expect(buildTenantMemberListMeta(51, 2, 25)).toEqual({
        total: 51,
        page: 2,
        limit: 25,
        totalPages: 3,
      });
    });

    it('reports a single page when there are no rows', () => {
      expect(buildTenantMemberListMeta(0, 1, 25)).toEqual({
        total: 0,
        page: 1,
        limit: 25,
        totalPages: 1,
      });
    });
  });
});
