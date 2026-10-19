import { ForbiddenException } from '@nestjs/common';
import { HrStaffAvailabilityService } from './hr-staff-availability.service.js';

describe('HrStaffAvailabilityService', () => {
  it('requires OWNER/ADMIN', async () => {
    const identity = { assertOwnerAdmin: jest.fn(() => {
      throw new ForbiddenException('Tenant admin access is required.');
    }) };
    const service = new HrStaffAvailabilityService(
      {} as never,
      { getTenantId: jest.fn() } as never,
      {} as never,
      identity as never,
      {} as never,
      {} as never,
    );
    await expect(service.getStaffAvailability({})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
