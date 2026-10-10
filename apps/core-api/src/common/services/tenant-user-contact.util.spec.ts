import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  formatPersonName,
  loadTenantUserContacts,
} from './tenant-user-contact.util.js';

describe('tenant-user-contact.util', () => {
  describe('formatPersonName', () => {
    it('joins the trimmed first and last name', () => {
      expect(formatPersonName(' Sam ', 'Supervisor ')).toBe('Sam Supervisor');
    });

    it('returns the part that is set when only one is present', () => {
      expect(formatPersonName(null, 'Supervisor')).toBe('Supervisor');
    });

    it('returns null when neither part has a value', () => {
      expect(formatPersonName(null, null)).toBeNull();
      expect(formatPersonName('  ', '')).toBeNull();
    });
  });

  describe('loadTenantUserContacts', () => {
    it('skips the query when there are no user ids', async () => {
      const prisma = { user: { findMany: jest.fn() } };

      const contacts = await loadTenantUserContacts(
        prisma as unknown as PrismaService,
        'tenant-1',
        [null, undefined],
      );

      expect(contacts.size).toBe(0);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('loads each distinct user once and only users with a membership in the tenant', async () => {
      const prisma = {
        user: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'user-1',
              email: 'sam@example.com',
              firstName: 'Sam',
              lastName: 'Supervisor',
            },
            {
              id: 'user-2',
              email: 'alex@example.com',
              firstName: null,
              lastName: null,
            },
          ]),
        },
      };

      const contacts = await loadTenantUserContacts(
        prisma as unknown as PrismaService,
        'tenant-1',
        ['user-1', 'user-1', 'user-2', null],
      );

      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['user-1', 'user-2'] },
          memberships: { some: { tenant_id: 'tenant-1' } },
        },
        select: { id: true, email: true, firstName: true, lastName: true },
      });
      expect(contacts.get('user-1')).toEqual({
        name: 'Sam Supervisor',
        email: 'sam@example.com',
      });
      expect(contacts.get('user-2')).toEqual({
        name: null,
        email: 'alex@example.com',
      });
    });

    it('leaves out ids that do not resolve inside the tenant', async () => {
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue([]) },
      };

      const contacts = await loadTenantUserContacts(
        prisma as unknown as PrismaService,
        'tenant-1',
        ['user-9'],
      );

      expect(contacts.has('user-9')).toBe(false);
    });
  });
});
