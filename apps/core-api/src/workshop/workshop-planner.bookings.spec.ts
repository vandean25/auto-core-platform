import { WorkshopOrderStatus } from '@prisma/client';
import {
  buildPlannerBookings,
  type PlannerBookableOrder,
} from './workshop-planner.bookings.js';

const todayWindow = {
  start: new Date('2026-08-21T05:30:00.000Z'),
  end: new Date('2026-08-21T15:00:00.000Z'),
};

function bookableOrder(
  overrides: Partial<PlannerBookableOrder> = {},
): PlannerBookableOrder {
  return {
    id: 'wo-1',
    order_number: 'WO-2026-0001',
    status: WorkshopOrderStatus.SCHEDULED,
    bay_id: 'bay-1',
    mechanic_id: null,
    mechanic: null,
    customer: null,
    vehicle: { id: 'v-1', make: 'VW', model: 'Golf', year: 2019, plate: 'W-1' },
    scheduled_start_at: new Date('2026-08-24T08:00:00.000Z'),
    scheduled_end_at: new Date('2026-08-24T09:00:00.000Z'),
    ...overrides,
  };
}

describe('workshop-planner.bookings', () => {
  it('maps a scheduled order to a BOOKING occupancy at its slot', () => {
    const [booking] = buildPlannerBookings(
      [
        bookableOrder({
          mechanic_id: 'employee-1',
          mechanic: { name: 'Ada Lovelace' },
        }),
      ],
      null,
    );

    expect(booking).toEqual({
      orderId: 'wo-1',
      orderNumber: 'WO-2026-0001',
      status: 'SCHEDULED',
      occupancyKind: 'BOOKING',
      bayId: 'bay-1',
      mechanicId: 'employee-1',
      mechanicName: 'Ada Lovelace',
      scheduledStartAt: '2026-08-24T08:00:00.000Z',
      scheduledEndAt: '2026-08-24T09:00:00.000Z',
      customer: null,
      vehicle: {
        id: 'v-1',
        make: 'VW',
        model: 'Golf',
        year: 2019,
        plate: 'W-1',
      },
    });
  });

  it('places an unscheduled order on the floor for the given window', () => {
    const [booking] = buildPlannerBookings(
      [
        bookableOrder({
          status: WorkshopOrderStatus.INTAKE,
          scheduled_start_at: null,
          scheduled_end_at: null,
        }),
      ],
      todayWindow,
    );

    expect(booking).toEqual(
      expect.objectContaining({
        orderId: 'wo-1',
        occupancyKind: 'UNSCHEDULED_ON_FLOOR',
        scheduledStartAt: '2026-08-21T05:30:00.000Z',
        scheduledEndAt: '2026-08-21T15:00:00.000Z',
      }),
    );
  });

  it('drops an unscheduled order when no floor window applies', () => {
    expect(
      buildPlannerBookings(
        [
          bookableOrder({
            status: WorkshopOrderStatus.INTAKE,
            scheduled_start_at: null,
            scheduled_end_at: null,
          }),
        ],
        null,
      ),
    ).toEqual([]);
  });

  it('drops orders that have no bay or no vehicle', () => {
    expect(
      buildPlannerBookings(
        [
          bookableOrder({ bay_id: null }),
          bookableOrder({ id: 'wo-2', vehicle: null }),
        ],
        null,
      ),
    ).toEqual([]);
  });

  it('names the customer by company, falling back to the person name', () => {
    const customer = {
      id: 'c-1',
      first_name: 'Ada',
      last_name: 'Lovelace',
      company_name: '  Garage GmbH  ',
    };

    const [byCompany] = buildPlannerBookings(
      [bookableOrder({ customer })],
      null,
    );
    const [byPerson] = buildPlannerBookings(
      [bookableOrder({ customer: { ...customer, company_name: null } })],
      null,
    );
    const [byBlankCompany] = buildPlannerBookings(
      [bookableOrder({ customer: { ...customer, company_name: '   ' } })],
      null,
    );

    expect(byCompany.customer).toEqual({
      id: 'c-1',
      displayName: 'Garage GmbH',
    });
    expect(byPerson.customer).toEqual({
      id: 'c-1',
      displayName: 'Ada Lovelace',
    });
    expect(byBlankCompany.customer).toEqual({
      id: 'c-1',
      displayName: 'Ada Lovelace',
    });
  });

  it('omits the plate when the vehicle has none', () => {
    const [booking] = buildPlannerBookings(
      [
        bookableOrder({
          vehicle: {
            id: 'v-2',
            make: 'Skoda',
            model: 'Octavia',
            year: 2021,
            plate: null,
          },
        }),
      ],
      null,
    );

    expect(booking.vehicle.plate).toBeUndefined();
  });
});
