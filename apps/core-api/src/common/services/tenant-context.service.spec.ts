import { InternalServerErrorException } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantContextStorage } from './tenant-context.storage';

const mockPrisma = {
  tenant: {
    findFirst: jest.fn(),
  },
} as unknown as ConstructorParameters<typeof TenantContextService>[0];

describe('TenantContextService', () => {
  let service: TenantContextService;

  beforeEach(() => {
    service = new TenantContextService(mockPrisma);
    jest.clearAllMocks();
  });

  describe('getRequiredTenantId()', () => {
    it('throws InternalServerErrorException when called outside an ALS context', () => {
      // Deliberately NOT wrapping in TenantContextStorage.run()
      expect(() => service.getRequiredTenantId()).toThrow(
        InternalServerErrorException,
      );
    });

    it('throws when inside a context but no user has been set', () => {
      TenantContextStorage.run(() => {
        expect(() => service.getRequiredTenantId()).toThrow(
          InternalServerErrorException,
        );
      });
    });

    it('returns the tenantId when a user is present in context', () => {
      TenantContextStorage.run(() => {
        service.setAuthenticatedUser({
          userId: 'user-1',
          email: 'test@example.com',
          tenantId: 'tenant-abc',
          role: 'ADMIN',
        });

        expect(service.getRequiredTenantId()).toBe('tenant-abc');
      });
    });
  });

  describe('setAuthenticatedUser() / getAuthenticatedUser()', () => {
    it('stores and retrieves the authenticated user within an ALS context', () => {
      TenantContextStorage.run(() => {
        const user = {
          userId: 'u1',
          email: 'a@b.com',
          tenantId: 'tid',
          role: 'ADMIN',
        };
        service.setAuthenticatedUser(user);
        expect(service.getAuthenticatedUser()).toEqual(user);
      });
    });

    it('returns undefined when no user has been set', () => {
      TenantContextStorage.run(() => {
        expect(service.getAuthenticatedUser()).toBeUndefined();
      });
    });

    it('is isolated between separate ALS contexts', () => {
      let resultA: ReturnType<typeof service.getAuthenticatedUser>;
      let resultB: ReturnType<typeof service.getAuthenticatedUser>;

      TenantContextStorage.run(() => {
        service.setAuthenticatedUser({
          userId: 'u-a',
          email: 'a@x.com',
          tenantId: 'tenant-a',
          role: 'ADMIN',
        });
        resultA = service.getAuthenticatedUser();
      });

      TenantContextStorage.run(() => {
        resultB = service.getAuthenticatedUser();
      });

      expect(resultA?.tenantId).toBe('tenant-a');
      expect(resultB).toBeUndefined();
    });
  });
});
