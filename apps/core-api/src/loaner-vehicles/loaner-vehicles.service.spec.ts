import { BadRequestException, ConflictException } from '@nestjs/common';
import { LoanerBookingStatus } from '@prisma/client';
import { LOANER_BOOKING_OVERLAP } from './loaner.constants.js';
import { getLoanerNow, setLoanerNowForTests } from './loaner-clock.js';
import { LoanerVehiclesService } from './loaner-vehicles.service.js';

describe('LoanerVehiclesService', () => {
  let service: LoanerVehiclesService;

  beforeEach(() => {
    service = new LoanerVehiclesService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    setLoanerNowForTests(undefined);
  });

  afterEach(() => {
    setLoanerNowForTests(undefined);
  });

  it('rejects invalid planned ranges', () => {
    const from = new Date('2026-10-10T10:00:00.000Z');
    const to = new Date('2026-10-10T09:00:00.000Z');
    expect(() => service.assertPlannedRange(from, to)).toThrow(
      BadRequestException,
    );
  });

  it('detects postgres overlap errors', () => {
    expect(
      service.isLoanerOverlapError(
        new Error('duplicate key violates exclusion constraint loaner_bookings_no_active_overlap'),
      ),
    ).toBe(true);
    expect(service.isLoanerOverlapError(new Error('23P01: exclusion'))).toBe(
      true,
    );
  });

  it('maps overlap errors to conflict response code', () => {
    try {
      service.rethrowOverlapIfNeeded(
        new Error('loaner_bookings_no_active_overlap'),
      );
      fail('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      const response = (error as ConflictException).getResponse() as {
        code?: string;
      };
      expect(response.code).toBe(LOANER_BOOKING_OVERLAP);
    }
  });

  it('lists overdue bookings against injected clock', async () => {
    const fixedNow = new Date('2026-10-05T12:00:00.000Z');
    setLoanerNowForTests(fixedNow);

    const prisma = {
      loanerBooking: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'booking-1',
            loaner_vehicle_id: 'lv-1',
            workshop_order_id: null,
            customer_id: 'cust-1',
            planned_from: new Date('2026-10-01T08:00:00.000Z'),
            planned_to: new Date('2026-10-04T08:00:00.000Z'),
            status: LoanerBookingStatus.RESERVED,
            handed_over_at: null,
            returned_at: null,
            odometer_out: null,
            odometer_in: null,
            fuel_out: null,
            fuel_in: null,
            damage_notes_out: null,
            damage_notes_in: null,
            driver_licence_checked: false,
            licence_checked_by_id: null,
            notes: null,
            createdAt: fixedNow,
            updatedAt: fixedNow,
            customer: {
              id: 'cust-1',
              first_name: 'Pilot',
              last_name: 'Customer',
              company_name: null,
            },
            loaner_vehicle: {
              id: 'lv-1',
              display_name: 'Pool 1',
              site_id: 'site-1',
            },
          },
        ]),
      },
    };

    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    };
    const siteContext = {
      getSiteId: jest.fn().mockResolvedValue('site-1'),
    };
    const authorization = {
      assertReadAccess: jest.fn(),
    };

    const overdueService = new LoanerVehiclesService(
      prisma as never,
      tenantContext as never,
      siteContext as never,
      authorization as never,
    );

    const result = await overdueService.listOverdue();
    expect(result.asOf).toBe(fixedNow.toISOString());
    expect(result.data).toHaveLength(1);
    expect(prisma.loanerBooking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          planned_to: { lt: fixedNow },
          status: { in: ['RESERVED', 'HANDED_OVER'] },
        }),
      }),
    );
    expect(getLoanerNow().toISOString()).toBe(fixedNow.toISOString());
  });

  it('marks vehicles unavailable when an active booking overlaps the window', async () => {
    const from = new Date('2026-10-10T08:00:00.000Z');
    const to = new Date('2026-10-12T08:00:00.000Z');
    const asOf = new Date('2026-10-11T08:00:00.000Z');
    setLoanerNowForTests(asOf);

    const prisma = {
      loanerVehicle: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'lv-1',
            tenant_id: 'tenant-1',
            site_id: 'site-1',
            vehicle_id: 'veh-1',
            display_name: 'Pool 1',
            status: 'AVAILABLE',
            daily_rate_cents: null,
            insurance_note: null,
            active: true,
            createdAt: asOf,
            updatedAt: asOf,
            vehicle: {
              id: 'veh-1',
              make: 'VW',
              model: 'Golf',
              year: 2022,
              plate: 'W-LOAN1',
              vin: 'VINLOAN1',
            },
          },
        ]),
      },
      loanerBooking: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              loaner_vehicle_id: 'lv-1',
            },
          ]),
      },
    };

    const availabilityService = new LoanerVehiclesService(
      prisma as never,
      {
        getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      } as never,
      {
        getSiteId: jest.fn().mockResolvedValue('site-1'),
      } as never,
      { assertReadAccess: jest.fn() } as never,
    );

    const result = await availabilityService.getAvailability({
      from: from.toISOString(),
      to: to.toISOString(),
    });

    expect(result.data[0].available).toBe(false);
  });
});
