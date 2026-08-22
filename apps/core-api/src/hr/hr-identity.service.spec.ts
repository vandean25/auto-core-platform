import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { HrIdentityService } from './hr-identity.service';

describe('HrIdentityService', () => {
  let service: HrIdentityService;
  let prisma: {
    employee: { findFirst: jest.Mock };
    user: { findFirst: jest.Mock };
  };
  let tenantContext: {
    getAuthenticatedUser: jest.Mock;
    getTenantId: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn() },
      user: { findFirst: jest.fn() },
    };
    tenantContext = {
      getAuthenticatedUser: jest.fn(),
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HrIdentityService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
      ],
    }).compile();

    service = module.get<HrIdentityService>(HrIdentityService);
  });

  describe('resolveMe', () => {
    it('resolves active employee matching session firebaseUid', async () => {
      tenantContext.getAuthenticatedUser.mockReturnValue({
        userId: 'fb-user-123',
        email: 'ada@example.com',
        role: 'TECH',
      });
      prisma.employee.findFirst.mockResolvedValue({
        id: 'emp-1',
        name: 'Ada Lovelace',
        role: 'MECHANIC',
        hired_on: new Date('2024-01-01'),
        annual_leave_days: 25,
      });

      const result = await service.resolveMe();

      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          is_active: true,
          user: {
            OR: [
              { firebaseUid: 'fb-user-123' },
              { email: 'ada@example.com' },
            ],
          },
        },
        select: {
          id: true,
          name: true,
          role: true,
          hired_on: true,
          annual_leave_days: true,
        },
      });
      expect(result.id).toBe('emp-1');
      expect(result.name).toBe('Ada Lovelace');
    });

    it('throws ForbiddenException if no authenticated user is present', async () => {
      tenantContext.getAuthenticatedUser.mockReturnValue(null);

      await expect(service.resolveMe()).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException if employee is not found or inactive', async () => {
      tenantContext.getAuthenticatedUser.mockReturnValue({
        userId: 'fb-user-123',
        email: 'unlinked@example.com',
        role: 'SALES',
      });
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(service.resolveMe()).rejects.toThrow(
        new ForbiddenException('No employee record linked to this account'),
      );
    });
  });

  describe('assertOwnerAdmin', () => {
    it('passes for OWNER role', () => {
      tenantContext.getAuthenticatedUser.mockReturnValue({
        userId: 'owner-1',
        role: 'OWNER',
      });
      expect(() => service.assertOwnerAdmin()).not.toThrow();
    });

    it('passes for ADMIN role', () => {
      tenantContext.getAuthenticatedUser.mockReturnValue({
        userId: 'admin-1',
        role: 'ADMIN',
      });
      expect(() => service.assertOwnerAdmin()).not.toThrow();
    });

    it('throws ForbiddenException for SALES or TECH role', () => {
      tenantContext.getAuthenticatedUser.mockReturnValue({
        userId: 'tech-1',
        role: 'TECH',
      });
      expect(() => service.assertOwnerAdmin()).toThrow(
        new ForbiddenException('Tenant admin access is required.'),
      );
    });
  });
});
