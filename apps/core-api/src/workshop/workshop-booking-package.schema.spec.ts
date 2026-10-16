import { BadRequestException } from '@nestjs/common';
import {
  LOANER_BOOKING_FIELDS_INCOMPLETE,
  normalizeWorkshopBookingPackage,
  proposeWorkshopBookingInputSchema,
} from './workshop-booking-package.schema.js';

const baseIntent = {
  customer_id: '00000000-0000-4000-8000-000000000001',
  vehicle_id: '00000000-0000-4000-8000-000000000002',
  bay_id: '00000000-0000-4000-8000-000000000003',
  schedule: {
    start_at: '2026-10-12T09:00:00.000Z',
    end_at: '2026-10-12T10:00:00.000Z',
  },
};

describe('normalizeWorkshopBookingPackage loaner fields', () => {
  it('rejects a WorkshopIntent loaner block missing planned_to', () => {
    expect(() =>
      normalizeWorkshopBookingPackage({
        ...baseIntent,
        loaner: {
          requested: true,
          loaner_vehicle_id: '00000000-0000-4000-8000-000000000004',
          planned_from: '2026-10-12T09:00:00.000Z',
        },
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects loaner.requested without the three booking fields', () => {
    expect(() =>
      normalizeWorkshopBookingPackage({
        ...baseIntent,
        loaner: { requested: true },
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects loaner_charge without a loaner booking on MCP input', () => {
    const parsed = proposeWorkshopBookingInputSchema.safeParse({
      customer_id: '00000000-0000-4000-8000-000000000001',
      vehicle_id: '00000000-0000-4000-8000-000000000002',
      bay_id: '00000000-0000-4000-8000-000000000003',
      scheduled_start_at: '2026-10-12T09:00:00.000Z',
      scheduled_end_at: '2026-10-12T10:00:00.000Z',
      loaner_charge: { unit_price_cents: 2500 },
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts loaner_charge with a complete loaner booking', () => {
    const parsed = proposeWorkshopBookingInputSchema.safeParse({
      customer_id: '00000000-0000-4000-8000-000000000001',
      vehicle_id: '00000000-0000-4000-8000-000000000002',
      bay_id: '00000000-0000-4000-8000-000000000003',
      scheduled_start_at: '2026-10-12T09:00:00.000Z',
      scheduled_end_at: '2026-10-12T10:00:00.000Z',
      loaner_vehicle_id: '00000000-0000-4000-8000-000000000004',
      planned_from: '2026-10-12T09:00:00.000Z',
      planned_to: '2026-10-12T11:00:00.000Z',
      loaner_charge: { unit_price_cents: 3000, quantity_days: 2 },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a complete loaner block on a WorkshopIntent payload', () => {
    const normalized = normalizeWorkshopBookingPackage({
      ...baseIntent,
      loaner: {
        requested: true,
        loaner_vehicle_id: '00000000-0000-4000-8000-000000000004',
        planned_from: '2026-10-12T09:00:00.000Z',
        planned_to: '2026-10-12T10:00:00.000Z',
      },
    });
    expect(normalized.loaner).toEqual({
      loanerVehicleId: '00000000-0000-4000-8000-000000000004',
      plannedFrom: '2026-10-12T09:00:00.000Z',
      plannedTo: '2026-10-12T10:00:00.000Z',
    });
  });
});
