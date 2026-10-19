import { ForbiddenException } from '@nestjs/common';
import { HrStaffAvailabilityService } from './hr-staff-availability.service.js';

describe('HrStaffAvailabilityService', () => {
  it('returns MCP not_permitted for non-admin callers', async () => {
    const service = new HrStaffAvailabilityService(
      {} as never,
      {
        getTenantId: jest.fn(),
        getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'SALES' }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    try {
      await service.getStaffAvailability({});
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual({
        code: 'not_permitted',
        message: 'Tenant admin access is required.',
      });
    }
  });
});
