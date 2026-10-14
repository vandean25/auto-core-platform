import {
  WorkshopOrderStatus,
  type WorkshopHoliday,
  type WorkshopOpeningHour,
} from '@prisma/client';
import {
  buildPlannerGrid,
  expandPlannerHolidays,
} from './workshop-planner.grid.js';
import type { PlannerBookableOrder } from './workshop-planner.bookings.js';

const openings = [
  { weekday: 1, is_closed: false, open_time: '07:30', close_time: '17:00' },
  { weekday: 2, is_closed: false, open_time: '07:30', close_time: '17:00' },
  { weekday: 3, is_closed: false, open_time: '07:30', close_time: '17:00' },
  { weekday: 4, is_closed: false, open_time: '07:30', close_time: '17:00' },
  { weekday: 5, is_closed: false, open_time: '07:30', close_time: '17:00' },
  { weekday: 6, is_closed: false, open_time: '08:00', close_time: '12:00' },
  { weekday: 7, is_closed: true, open_time: '07:30', close_time: '17:00' },
] as WorkshopOpeningHour[];

const nationalHoliday = {
  name: 'Nationalfeiertag',
  observed_on: new Date('2026-10-26T00:00:00.000Z'),
  repeats_annually: false,
  is_closed: true,
  open_time: null,
  close_time: null,
} as WorkshopHoliday;

const settings = {
  timezone: 'Europe/Vienna',
  slot_minutes: 30,
  openingHours: openings,
};
const bays = [{ id: 'bay-1', name: 'Bay 1', sort_order: 0 }];
const leave = {
  id: 'leave-1',
  start_on: new Date('2026-08-24T00:00:00.000Z'),
  end_on: new Date('2026-08-26T00:00:00.000Z'),
  employee: { id: 'employee-1', name: 'Ada Lovelace' },
};
const scheduledOrder: PlannerBookableOrder = {
  id: 'wo-1',
  order_number: 'WO-2026-0001',
  status: WorkshopOrderStatus.SCHEDULED,
  bay_id: 'bay-1',
  mechanic_id: null,
  mechanic: null,
  customer: null,
  vehicle: { id: 'v-1', make: 'VW', model: 'Golf', year: 2019, plate: 'W-1' },
  scheduled_start_at: new Date('2026-08-25T08:00:00.000Z'),
  scheduled_end_at: new Date('2026-08-25T09:00:00.000Z'),
};
const todayWindow = {
  start: new Date('2026-08-30T05:30:00.000Z'),
  end: new Date('2026-08-30T15:00:00.000Z'),
};

describe('workshop-planner.grid', () => {
  describe('expandPlannerHolidays', () => {
    it('returns an entry only for local dates that carry a holiday', () => {
      expect(
        expandPlannerHolidays(
          ['2026-10-25', '2026-10-26'],
          [nationalHoliday],
          openings,
        ),
      ).toEqual([
        {
          date: '2026-10-26',
          name: 'Nationalfeiertag',
          isClosed: true,
          openTime: null,
          closeTime: null,
        },
      ]);
    });
  });

  describe('buildPlannerGrid', () => {
    it('assembles the grid response from the loaded rows', () => {
      const grid = buildPlannerGrid({
        settings,
        range: {
          from: new Date('2026-08-24T00:00:00.000Z'),
          to: new Date('2026-08-26T22:00:00.000Z'),
        },
        bays,
        holidays: [],
        leaveRequests: [leave],
        orders: [scheduledOrder],
        todayWindow,
      });

      expect(grid).toEqual({
        timezone: 'Europe/Vienna',
        slotMinutes: 30,
        range: {
          from: '2026-08-24T00:00:00.000Z',
          to: '2026-08-26T22:00:00.000Z',
        },
        bays: [{ id: 'bay-1', name: 'Bay 1', sortOrder: 0 }],
        openings: expect.any(Array),
        holidays: [],
        employeesAway: [
          {
            employeeId: 'employee-1',
            name: 'Ada Lovelace',
            startOn: '2026-08-24',
            endOn: '2026-08-26',
            leaveId: 'leave-1',
          },
        ],
        bookings: [
          expect.objectContaining({
            orderId: 'wo-1',
            occupancyKind: 'BOOKING',
            scheduledStartAt: '2026-08-25T08:00:00.000Z',
          }),
        ],
      });
      expect(grid.openings).toHaveLength(7);
      expect(grid.openings[5]).toEqual({
        weekday: 6,
        isClosed: false,
        openTime: '08:00',
        closeTime: '12:00',
      });
    });

    it('overlays holidays for the local dates inside the range', () => {
      const grid = buildPlannerGrid({
        settings,
        range: {
          from: new Date('2026-10-25T00:00:00.000Z'),
          to: new Date('2026-10-27T00:00:00.000Z'),
        },
        bays,
        holidays: [nationalHoliday],
        leaveRequests: [],
        orders: [],
        todayWindow,
      });

      expect(grid.holidays).toEqual([
        {
          date: '2026-10-26',
          name: 'Nationalfeiertag',
          isClosed: true,
          openTime: null,
          closeTime: null,
        },
      ]);
    });

    it('shows unscheduled orders on the floor only when today is inside the range', () => {
      const floorOrder: PlannerBookableOrder = {
        ...scheduledOrder,
        id: 'wo-floor',
        status: WorkshopOrderStatus.INTAKE,
        scheduled_start_at: null,
        scheduled_end_at: null,
      };
      const inputFor = (window: typeof todayWindow) => ({
        settings,
        range: {
          from: new Date('2026-08-30T00:00:00.000Z'),
          to: new Date('2026-08-31T00:00:00.000Z'),
        },
        bays,
        holidays: [],
        leaveRequests: [],
        orders: [floorOrder],
        todayWindow: window,
      });

      expect(buildPlannerGrid(inputFor(todayWindow)).bookings).toEqual([
        expect.objectContaining({
          orderId: 'wo-floor',
          occupancyKind: 'UNSCHEDULED_ON_FLOOR',
          scheduledStartAt: '2026-08-30T05:30:00.000Z',
          scheduledEndAt: '2026-08-30T15:00:00.000Z',
        }),
      ]);
      expect(
        buildPlannerGrid(
          inputFor({
            start: new Date('2026-09-01T05:30:00.000Z'),
            end: new Date('2026-09-01T15:00:00.000Z'),
          }),
        ).bookings,
      ).toEqual([]);
    });
  });
});
