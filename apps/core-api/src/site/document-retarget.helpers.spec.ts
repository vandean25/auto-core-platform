import { UnprocessableEntityException } from '@nestjs/common';
import {
  assertActiveTargetSiteMembership,
  lockSitesAndAssertActive,
} from './document-retarget.helpers.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('document-retarget.helpers', () => {
  describe('assertActiveTargetSiteMembership', () => {
    let mockPrisma: any;
    let mockTenantContext: Partial<TenantContextService>;

    beforeEach(() => {
      mockPrisma = {
        user: { findUnique: jest.fn() },
        tenantMember: { findFirst: jest.fn() },
        siteMembership: { findFirst: jest.fn() },
      };
      mockTenantContext = {
        getAuthenticatedUser: jest.fn().mockReturnValue({ userId: 'fb-user-1' }),
      };
    });

    it('passes when user has active TenantMember and active SiteMembership', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1' });
      mockPrisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      mockPrisma.siteMembership.findFirst.mockResolvedValue({ id: 'sm-1' });

      await expect(
        assertActiveTargetSiteMembership(
          mockPrisma as PrismaService,
          mockTenantContext as TenantContextService,
          'tenant-1',
          'site-2',
        ),
      ).resolves.toBeUndefined();
    });

    it('throws 422 when user is not authenticated', async () => {
      mockTenantContext.getAuthenticatedUser = jest.fn().mockReturnValue(null);

      await expect(
        assertActiveTargetSiteMembership(
          mockPrisma as PrismaService,
          mockTenantContext as TenantContextService,
          'tenant-1',
          'site-2',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws 422 when user row is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        assertActiveTargetSiteMembership(
          mockPrisma as PrismaService,
          mockTenantContext as TenantContextService,
          'tenant-1',
          'site-2',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws 422 when tenant membership is inactive/missing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1' });
      mockPrisma.tenantMember.findFirst.mockResolvedValue(null);

      await expect(
        assertActiveTargetSiteMembership(
          mockPrisma as PrismaService,
          mockTenantContext as TenantContextService,
          'tenant-1',
          'site-2',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws 422 when site membership on target site is missing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1' });
      mockPrisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      mockPrisma.siteMembership.findFirst.mockResolvedValue(null);

      await expect(
        assertActiveTargetSiteMembership(
          mockPrisma as PrismaService,
          mockTenantContext as TenantContextService,
          'tenant-1',
          'site-2',
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('lockSitesAndAssertActive', () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        $queryRaw: jest.fn(),
      };
    });

    it('locks sites and passes when all are active', async () => {
      mockTx.$queryRaw.mockResolvedValue([
        { id: 'site-1', is_active: true },
        { id: 'site-2', is_active: true },
      ]);

      await expect(
        lockSitesAndAssertActive(mockTx, 'tenant-1', ['site-2', 'site-1']),
      ).resolves.toBeUndefined();

      expect(mockTx.$queryRaw).toHaveBeenCalled();
    });

    it('throws 422 when any requested site is missing', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: 'site-1', is_active: true }]);

      await expect(
        lockSitesAndAssertActive(mockTx, 'tenant-1', ['site-1', 'site-2']),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws 422 when any locked site is inactive', async () => {
      mockTx.$queryRaw.mockResolvedValue([
        { id: 'site-1', is_active: true },
        { id: 'site-2', is_active: false },
      ]);

      await expect(
        lockSitesAndAssertActive(mockTx, 'tenant-1', ['site-1', 'site-2']),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });
});
