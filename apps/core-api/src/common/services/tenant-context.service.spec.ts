import { InternalServerErrorException } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantContextStorage } from './tenant-context.storage';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  describe('setTenantIdForWorker()', () => {
    it('sets user to cloud-tasks-worker with the given tenantId', () => {
      TenantContextStorage.run(() => {
        service.setTenantIdForWorker('tenant-worker-1');

        const user = service.getAuthenticatedUser();
        expect(user?.userId).toBe('cloud-tasks-worker');
        expect(user?.tenantId).toBe('tenant-worker-1');
        expect(user?.role).toBe('worker');
      });
    });

    it('stamps source as JOB in the request meta', () => {
      TenantContextStorage.run(() => {
        service.setTenantIdForWorker('tenant-worker-2');

        const meta = TenantContextStorage.getRequestMeta();
        expect(meta?.source).toBe('JOB');
      });
    });

    it('preserves an existing requestId set by the middleware', () => {
      TenantContextStorage.run(() => {
        TenantContextStorage.setRequestMeta({
          requestId: 'middleware-req-id',
          source: 'API',
          ip: '1.2.3.4',
          userAgent: 'CloudTasks/1.0',
        });

        service.setTenantIdForWorker('tenant-worker-3');

        const meta = TenantContextStorage.getRequestMeta();
        expect(meta?.requestId).toBe('middleware-req-id');
        expect(meta?.source).toBe('JOB');
        expect(meta?.ip).toBe('1.2.3.4');
        expect(meta?.userAgent).toBe('CloudTasks/1.0');
      });
    });

    it('generates a requestId when no middleware context exists', () => {
      TenantContextStorage.run(() => {
        service.setTenantIdForWorker('tenant-worker-4');

        const meta = TenantContextStorage.getRequestMeta();
        expect(meta?.requestId).toMatch(UUID_REGEX);
        expect(meta?.source).toBe('JOB');
      });
    });
  });
});
