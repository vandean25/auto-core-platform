import { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { SuperAdminGuard } from './super-admin.guard';

describe('SuperAdminGuard', () => {
  it('allows authenticated platform super admins', () => {
    const guard = new SuperAdminGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            userId: 'firebase-admin-uid',
            email: 'founder@autocore.com',
            platformRole: 'SUPER_ADMIN',
          },
        }),
      }),
    } as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });
});