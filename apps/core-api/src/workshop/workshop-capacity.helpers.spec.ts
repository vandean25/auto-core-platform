import { Prisma } from '@prisma/client';
import {
  buildCapacityBays,
  buildCapacityDays,
  openWindowHours,
  toCapacityOrderRow,
  type CapacityOrderRow,
  type CapacitySourceOrder,
} from './workshop-capacity.helpers.js';
import type { EffectiveHours } from './workshop-planner.hours.js';

const weekdayHours: EffectiveHours = {
  isClosed: false,
  openTime: '07:30',
  closeTime: '17:00',
};
const saturdayHours: EffectiveHours = {
  isClosed: false,
  openTime: '08:00',
  closeTime: '12:00',
};
const closedHours: EffectiveHours = {
  isClosed: true,
  openTime: null,
  closeTime: null,
};

const bays = [
  { id: 'bay-1', name: 'Bay 1', sortOrder: 1 },
  { id: 'bay-2', name: 'Bay 2', sortOrder: 2 },
];
const monday = { date: '2026-10-12', hours: weekdayHours };
const saturday = { date: '2026-10-17', hours: saturdayHours };

function row(
  overrides: Pick<
    CapacityOrderRow,
    'orderId' | 'bayId' | 'localDate' | 'plannedLaborHours'
  > &
    Partial<CapacityOrderRow>,
): CapacityOrderRow {
  return {
    orderNumber: `WO-${overrides.orderId}`,
    status: 'SCHEDULED',
    occupancyKind: 'BOOKING',
    plate: 'W-123AB',
    scheduledStartAt: new Date('2026-10-12T06:00:00.000Z'),
    ...overrides,
  };
}

describe('workshop-capacity.helpers', () => {
  describe('openWindowHours', () => {
    it('returns the length of the open window in hours', () => {
      expect(openWindowHours(weekdayHours).toNumber()).toBe(9.5);
      expect(openWindowHours(saturdayHours).toNumber()).toBe(4);
    });

    it('returns zero for closed days', () => {
      expect(openWindowHours(closedHours).toNumber()).toBe(0);
    });

    it('uses shortened holiday hours', () => {
      expect(
        openWindowHours({
          isClosed: false,
          openTime: '09:00',
          closeTime: '12:30',
          holidayName: 'Short day',
        }).toNumber(),
      ).toBe(3.5);
    });
  });

  describe('buildCapacityDays', () => {
    it('reports open hours and the holiday name for each date', () => {
      expect(
        buildCapacityDays([
          monday,
          {
            date: '2026-10-26',
            hours: {
              isClosed: true,
              openTime: null,
              closeTime: null,
              holidayName: 'Nationalfeiertag',
            },
          },
        ]),
      ).toEqual([
        {
          date: '2026-10-12',
          isClosed: false,
          openTime: '07:30',
          closeTime: '17:00',
          capacityHours: 9.5,
          holidayName: null,
        },
        {
          date: '2026-10-26',
          isClosed: true,
          openTime: null,
          closeTime: null,
          capacityHours: 0,
          holidayName: 'Nationalfeiertag',
        },
      ]);
    });
  });

  describe('buildCapacityBays', () => {
    it('sums planned labor hours per bay and day and reports free hours', () => {
      const [bay1] = buildCapacityBays({
        bays,
        days: [monday, saturday],
        orders: [
          row({
            orderId: 'o-1',
            bayId: 'bay-1',
            localDate: '2026-10-12',
            plannedLaborHours: new Prisma.Decimal('2.5'),
          }),
          row({
            orderId: 'o-2',
            bayId: 'bay-1',
            localDate: '2026-10-12',
            plannedLaborHours: new Prisma.Decimal('4'),
            scheduledStartAt: new Date('2026-10-12T09:00:00.000Z'),
          }),
        ],
      });

      expect(bay1.days[0]).toMatchObject({
        date: '2026-10-12',
        capacityHours: 9.5,
        bookedHours: 6.5,
        freeHours: 3,
        isOverbooked: false,
      });
      expect(bay1.days[0].orders.map((order) => order.orderId)).toEqual([
        'o-1',
        'o-2',
      ]);
    });

    it('flags a cell as overbooked when planned hours exceed the open window', () => {
      const [, bay2] = buildCapacityBays({
        bays,
        days: [monday],
        orders: [
          row({
            orderId: 'o-3',
            bayId: 'bay-2',
            localDate: '2026-10-12',
            plannedLaborHours: new Prisma.Decimal('10'),
          }),
        ],
      });

      expect(bay2.days[0]).toMatchObject({
        bookedHours: 10,
        freeHours: 0,
        isOverbooked: true,
      });
    });

    it('treats a fully booked day as not overbooked', () => {
      const [bay1] = buildCapacityBays({
        bays,
        days: [monday],
        orders: [
          row({
            orderId: 'o-4',
            bayId: 'bay-1',
            localDate: '2026-10-12',
            plannedLaborHours: new Prisma.Decimal('9.5'),
          }),
        ],
      });

      expect(bay1.days[0]).toMatchObject({
        bookedHours: 9.5,
        freeHours: 0,
        isOverbooked: false,
      });
    });

    it('gives closed days zero capacity and flags any work booked on them', () => {
      const sunday = { date: '2026-10-18', hours: closedHours };
      const [empty, withWork] = buildCapacityBays({
        bays,
        days: [sunday],
        orders: [
          row({
            orderId: 'o-5',
            bayId: 'bay-2',
            localDate: '2026-10-18',
            occupancyKind: 'UNSCHEDULED_ON_FLOOR',
            scheduledStartAt: null,
            plannedLaborHours: new Prisma.Decimal('1'),
          }),
        ],
      });

      expect(empty.days[0]).toMatchObject({
        capacityHours: 0,
        bookedHours: 0,
        freeHours: 0,
        isOverbooked: false,
      });
      expect(withWork.days[0]).toMatchObject({
        capacityHours: 0,
        bookedHours: 1,
        isOverbooked: true,
      });
    });

    it('rounds hours to two decimals', () => {
      const [bay1] = buildCapacityBays({
        bays,
        days: [monday],
        orders: [
          row({
            orderId: 'o-6',
            bayId: 'bay-1',
            localDate: '2026-10-12',
            plannedLaborHours: new Prisma.Decimal('1.125'),
          }),
        ],
      });

      expect(bay1.days[0]).toMatchObject({ bookedHours: 1.13, freeHours: 8.38 });
    });

    it('lists unscheduled work first, then by planned start', () => {
      const [bay1] = buildCapacityBays({
        bays,
        days: [monday],
        orders: [
          row({
            orderId: 'late',
            bayId: 'bay-1',
            localDate: '2026-10-12',
            plannedLaborHours: new Prisma.Decimal('1'),
            scheduledStartAt: new Date('2026-10-12T09:00:00.000Z'),
          }),
          row({
            orderId: 'early',
            bayId: 'bay-1',
            localDate: '2026-10-12',
            plannedLaborHours: new Prisma.Decimal('1'),
            scheduledStartAt: new Date('2026-10-12T06:00:00.000Z'),
          }),
          row({
            orderId: 'on-floor',
            bayId: 'bay-1',
            localDate: '2026-10-12',
            occupancyKind: 'UNSCHEDULED_ON_FLOOR',
            scheduledStartAt: null,
            plannedLaborHours: new Prisma.Decimal('1'),
          }),
        ],
      });

      expect(bay1.days[0].orders.map((order) => order.orderId)).toEqual([
        'on-floor',
        'early',
        'late',
      ]);
    });

    it('ignores orders for unknown bays and dates outside the week', () => {
      const [bay1] = buildCapacityBays({
        bays,
        days: [monday],
        orders: [
          row({
            orderId: 'o-7',
            bayId: 'bay-9',
            localDate: '2026-10-12',
            plannedLaborHours: new Prisma.Decimal('2'),
          }),
          row({
            orderId: 'o-8',
            bayId: 'bay-1',
            localDate: '2026-10-11',
            plannedLaborHours: new Prisma.Decimal('2'),
          }),
        ],
      });

      expect(bay1.days[0]).toMatchObject({ bookedHours: 0, freeHours: 9.5 });
      expect(bay1.days[0].orders).toEqual([]);
    });
  });

  describe('toCapacityOrderRow', () => {
    const week = {
      timezone: 'Europe/Vienna',
      today: '2026-10-14',
      dates: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'],
    };

    function source(overrides: Partial<CapacitySourceOrder> = {}): CapacitySourceOrder {
      return {
        id: 'o-src',
        order_number: 'WO-SRC',
        status: 'SCHEDULED',
        bay_id: 'bay-1',
        scheduled_start_at: new Date('2026-10-12T06:00:00.000Z'),
        vehicle: { plate: 'W-SRC' },
        tasks: [
          { line_items: [{ quantity: new Prisma.Decimal('2.5') }] },
          { line_items: [{ quantity: new Prisma.Decimal('1.5') }] },
        ],
        ...overrides,
      };
    }

    it('counts a timed order on its local day in the site timezone and sums every task', () => {
      // 22:30Z on Monday is 00:30 on Tuesday in Vienna (CEST).
      const row = toCapacityOrderRow(
        source({ scheduled_start_at: new Date('2026-10-12T22:30:00.000Z') }),
        week,
      );

      expect(row).toMatchObject({
        orderId: 'o-src',
        orderNumber: 'WO-SRC',
        bayId: 'bay-1',
        localDate: '2026-10-13',
        plate: 'W-SRC',
        occupancyKind: 'BOOKING',
      });
      expect(row?.plannedLaborHours.toNumber()).toBe(4);
    });

    it('counts unscheduled work already on the floor against today', () => {
      const row = toCapacityOrderRow(
        source({ scheduled_start_at: null, status: 'IN_PROGRESS' }),
        week,
      );

      expect(row).toMatchObject({
        localDate: '2026-10-14',
        occupancyKind: 'UNSCHEDULED_ON_FLOOR',
        scheduledStartAt: null,
        status: 'IN_PROGRESS',
      });
    });

    it('drops orders without a bay and orders outside the week', () => {
      expect(toCapacityOrderRow(source({ bay_id: null }), week)).toBeNull();
      expect(
        toCapacityOrderRow(
          source({ scheduled_start_at: new Date('2026-10-18T06:00:00.000Z') }),
          week,
        ),
      ).toBeNull();
    });
  });
});
