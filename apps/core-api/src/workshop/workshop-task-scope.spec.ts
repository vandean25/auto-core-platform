import { ForbiddenException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  assertWorkshopTaskExecutionRole,
  assertWorkshopTaskWriteRole,
  WORKSHOP_TASK_EXECUTION_ROLES,
  WORKSHOP_TASK_WRITE_ROLES,
} from './workshop-task-scope.js';

function mockTenantContextWithRole(role: string | null | undefined): TenantContextService {
  return {
    getAuthenticatedUser: jest.fn().mockReturnValue(
      role !== undefined ? (role !== null ? { role, userId: 'test-user', tenantId: 't-1' } : { role: null }) : undefined,
    ),
  } as unknown as TenantContextService;
}

describe('workshop-task-scope', () => {
  describe('role sets', () => {
    it('defines WORKSHOP_TASK_WRITE_ROLES as OWNER, ADMIN, SALES', () => {
      expect(Array.from(WORKSHOP_TASK_WRITE_ROLES).sort()).toEqual([
        'ADMIN',
        'OWNER',
        'SALES',
      ]);
    });

    it('defines WORKSHOP_TASK_EXECUTION_ROLES as OWNER, ADMIN, SALES, TECH', () => {
      expect(Array.from(WORKSHOP_TASK_EXECUTION_ROLES).sort()).toEqual([
        'ADMIN',
        'OWNER',
        'SALES',
        'TECH',
      ]);
    });
  });

  describe('assertWorkshopTaskWriteRole', () => {
    it.each(['OWNER', 'ADMIN', 'SALES'])('allows write role %s', (role) => {
      const tenantContext = mockTenantContextWithRole(role);
      expect(() =>
        assertWorkshopTaskWriteRole(tenantContext, 'Creating workshop tasks'),
      ).not.toThrow();
    });

    it.each([
      'TECH',
      'ACCOUNTANT',
      'DEMO',
      'SUPER_ADMIN',
      'AUDITOR',
      'VIEWER',
      '',
      null,
      undefined,
    ])('refuses disallowed role %s with WORKSHOP_ROLE_FORBIDDEN', (role) => {
      const tenantContext = mockTenantContextWithRole(role);
      try {
        assertWorkshopTaskWriteRole(tenantContext, 'Creating workshop tasks');
        fail('Expected ForbiddenException to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const forbidden = err as ForbiddenException;
        expect(forbidden.getResponse()).toEqual({
          code: 'WORKSHOP_ROLE_FORBIDDEN',
          message: 'Creating workshop tasks requires the owner, admin or sales role.',
        });
      }
    });
  });

  describe('assertWorkshopTaskExecutionRole', () => {
    it.each(['OWNER', 'ADMIN', 'SALES', 'TECH'])(
      'allows execution role %s',
      (role) => {
        const tenantContext = mockTenantContextWithRole(role);
        expect(() =>
          assertWorkshopTaskExecutionRole(
            tenantContext,
            'Updating workshop tasks',
          ),
        ).not.toThrow();
      },
    );

    it.each([
      'ACCOUNTANT',
      'DEMO',
      'SUPER_ADMIN',
      'AUDITOR',
      'VIEWER',
      '',
      null,
      undefined,
    ])('refuses disallowed role %s with WORKSHOP_ROLE_FORBIDDEN', (role) => {
      const tenantContext = mockTenantContextWithRole(role);
      try {
        assertWorkshopTaskExecutionRole(
          tenantContext,
          'Updating workshop tasks',
        );
        fail('Expected ForbiddenException to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const forbidden = err as ForbiddenException;
        expect(forbidden.getResponse()).toEqual({
          code: 'WORKSHOP_ROLE_FORBIDDEN',
          message:
            'Updating workshop tasks requires the owner, admin, sales or technician role.',
        });
      }
    });
  });
});
