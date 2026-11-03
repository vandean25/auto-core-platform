import { ForbiddenException } from '@nestjs/common';
import { HrStaffAvailabilityService } from './hr-staff-availability.service.js';

const TENANT_ID = '00000000-0000-4000-8000-0000000000a1';
const SITE_ID = '00000000-0000-4000-8000-0000000000b1';
const EMPLOYEE_ID = '00000000-0000-4000-8000-0000000000c1';
const AVAILABILITY_DATE = '2026-11-03';

function createService(role: string) {
  const prisma = {
    employee: {
      findMany: jest.fn().mockResolvedValue([
        { id: EMPLOYEE_ID, name: 'Mech Demo', role: 'MECHANIC' },
      ]),
    },
    leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceEvent: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
    getAuthenticatedUser: jest.fn().mockReturnValue({ role }),
  };
  const siteContext = {
    getSiteId: jest.fn().mockResolvedValue(SITE_ID),
    listAuthorizedSiteIds: jest.fn().mockResolvedValue([SITE_ID]),
  };
  const workSchedule = {
    resolveScheduleForDate: jest.fn().mockResolvedValue({ days: [] }),
  };
  const workshopSettings = {
    getSettingsForSite: jest.fn().mockResolvedValue({ timezone: 'Europe/Vienna' }),
  };
  const service = new HrStaffAvailabilityService(
    prisma as never,
    tenantContext as never,
    siteContext as never,
    workSchedule as never,
    workshopSettings as never,
  );
  return { service, prisma };
}

describe('HrStaffAvailabilityService', () => {
  it('returns the day availability to an ADMIN caller', async () => {
    const { service } = createService('ADMIN');

    await expect(
      service.getStaffAvailability({ date: AVAILABILITY_DATE }),
    ).resolves.toEqual({
      date: AVAILABILITY_DATE,
      site_id: SITE_ID,
      employees: [
        {
          employee_id: EMPLOYEE_ID,
          display_name: 'Mech Demo',
          role: 'MECHANIC',
          present_now: false,
          scheduled_hours: '0.00',
          on_leave: false,
        },
      ],
    });
  });

  it('returns MCP not_permitted for non-admin callers', async () => {
    const { service, prisma } = createService('SALES');

    await expect(
      service.getStaffAvailability({ date: AVAILABILITY_DATE }),
    ).rejects.toMatchObject({
      response: {
        code: 'not_permitted',
        message: 'Tenant admin access is required.',
      },
    });
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('refuses a caller whose role is not a tenant role', async () => {
    const { service, prisma } = createService('TECH');

    await expect(
      service.getStaffAvailability({ date: AVAILABILITY_DATE }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
  });
});
