import { BadRequestException } from '@nestjs/common';
import {
  LOANER_BOOKING_FIELDS_INCOMPLETE,
  normalizeWorkshopBookingPackage,
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
