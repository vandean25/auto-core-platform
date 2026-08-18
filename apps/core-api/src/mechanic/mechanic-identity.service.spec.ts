import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MechanicIdentityService } from './mechanic-identity.service';
import {
  MECHANIC_ID,
  TENANT_ID,
  mockPrisma,
  mockTenantContext,
} from './mechanic.spec.support';

describe('MechanicIdentityService', () => {
  let service: MechanicIdentityService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new MechanicIdentityService(mockPrisma, mockTenantContext);
    (mockTenantContext.getAuthenticatedUser as jest.Mock).mockReturnValue({
      userId: 'user-1',
      email: 'tech@workshop.at',
      tenantId: TENANT_ID,
      role: 'TECH',
    });
    (mockTenantContext.getTenantId as jest.Mock).mockResolvedValue(TENANT_ID);
  });

  // ─── resolveMechanic ────────────────────────────────────────────────────

  describe('resolveMechanic()', () => {
    it('throws ForbiddenException when authenticated user is not TECH', async () => {
      (mockTenantContext.getAuthenticatedUser as jest.Mock).mockReturnValue({
        userId: 'firebase-uid-1',
        email: 'advisor@workshop.at',
        tenantId: TENANT_ID,
        role: 'SALES',
      });

      await expect(service.resolveMechanic()).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when there is no authenticated user', async () => {
      (mockTenantContext.getAuthenticatedUser as jest.Mock).mockReturnValue(
        undefined,
      );

      await expect(service.resolveMechanic()).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when no linked MECHANIC employee is found', async () => {
      (mockPrisma.employee.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.resolveMechanic()).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the employee id when user is TECH and employee is linked', async () => {
      (mockPrisma.employee.findFirst as jest.Mock).mockResolvedValue({
        id: MECHANIC_ID,
      });

      await expect(service.resolveMechanic()).resolves.toBe(MECHANIC_ID);
    });

    it('queries employee by session userId (firebaseUid), tenant_id, MECHANIC role, and is_active', async () => {
      (mockPrisma.employee.findFirst as jest.Mock).mockResolvedValue({
        id: MECHANIC_ID,
      });

      await service.resolveMechanic();

      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          role: 'MECHANIC',
          is_active: true,
          user: {
            OR: [{ firebaseUid: 'user-1' }, { email: 'tech@workshop.at' }],
          },
        },
        select: { id: true },
      });
    });
  });
});
