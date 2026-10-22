import { WorkshopOrderStatus } from '@prisma/client';
import type { PlannerBookableOrder } from './workshop-planner.bookings.js';
import {
  findWorkshopSlots,
  halfOpenOverlaps,
} from './workshop-planner.slots.js';

const TZ = 'Europe/Vienna';
const OPENINGS = [
  { id: 'oh-1', tenant_id: 'tenant-1', site_id: 'site-1', weekday: 1, is_closed: false, open_time: '07:30', close_time: '17:00' },
  { id: 'oh-2', tenant_id: 'tenant-1', site_id: 'site-1', weekday: 2, is_closed: false, open_time: '07:30', close_time: '17:00' },
  { id: 'oh-3', tenant_id: 'tenant-1', site_id: 'site-1', weekday: 3, is_closed: false, open_time: '07:30', close_time: '17:00' },
  { id: 'oh-4', tenant_id: 'tenant-1', site_id: 'site-1', weekday: 4, is_closed: false, open_time: '07:30', close_time: '17:00' },
  { id: 'oh-5', tenant_id: 'tenant-1', site_id: 'site-1', weekday: 5, is_closed: false, open_time: '07:30', close_time: '17:00' },
  { id: 'oh-6', tenant_id: 'tenant-1', site_id: 'site-1', weekday: 6, is_closed: false, open_time: '08:00', close_time: '12:00' },
  { id: 'oh-7', tenant_id: 'tenant-1', site_id: 'site-1', weekday: 7, is_closed: true, open_time: '07:30', close_time: '17:00' },
] as const;

function order(
  partial: Partial<PlannerBookableOrder> & { id: string; bay_id: string },
): PlannerBookableOrder {
  return {
    order_number: 'WO-1',
    status: WorkshopOrderStatus.SCHEDULED,
    mechanic_id: null,
    mechanic: null,
    customer: null,
    vehicle: {
      id: 'v-1',
      make: 'VW',
      model: 'Golf',
      year: 2020,
      plate: 'W-1',
    },
    scheduled_start_at: null,
    scheduled_end_at: null,
    ...partial,
  };
}

describe('workshop-planner.slots', () => {
  describe('halfOpenOverlaps', () => {
    it('treats adjacent windows as non-overlapping', () => {
      const a = {
        start: new Date('2026-10-10T08:00:00.000Z'),
        end: new Date('2026-10-10T09:00:00.000Z'),
      };
      const b = {
        start: new Date('2026-10-10T09:00:00.000Z'),
        end: new Date('2026-10-10T10:00:00.000Z'),
      };
      expect(halfOpenOverlaps(a, b)).toBe(false);
      expect(halfOpenOverlaps(b, a)).toBe(false);
    });
  });

  describe('findWorkshopSlots', () => {
    it('skips fully closed holidays', () => {
      const slots = findWorkshopSlots({
        timeZone: TZ,
        slotMinutes: 30,
        durationMinutes: 60,
        range: {
          from: new Date('2026-10-26T00:00:00.000Z'),
          to: new Date('2026-10-27T00:00:00.000Z'),
        },
        bays: [{ id: 'bay-1', sort_order: 0 }],
        holidays: [
          {
            name: 'Nationalfeiertag',
            observed_on: new Date('2026-10-26T00:00:00.000Z'),
            repeats_annually: false,
            is_closed: true,
            open_time: null,
            close_time: null,
          } as never,
        ],
        openingHours: [...OPENINGS],
        orders: [],
        now: new Date('2026-10-25T10:00:00.000Z'),
      });
      expect(slots).toEqual([]);
    });

    it('snaps the first cursor to the opening grid at or after from (Vienna Mon 2026-08-24)', () => {
      const rangeFrom = new Date('2026-08-24T06:10:00.000Z');
      const slots = findWorkshopSlots({
        timeZone: TZ,
        slotMinutes: 30,
        durationMinutes: 60,
        range: {
          from: rangeFrom,
          to: new Date('2026-08-25T00:00:00.000Z'),
        },
        bays: [{ id: 'bay-1', sort_order: 0 }],
        holidays: [],
        openingHours: [...OPENINGS],
        orders: [],
        now: new Date('2026-08-23T10:00:00.000Z'),
      });
      expect(slots[0]).toEqual({
        bayId: 'bay-1',
        startAt: new Date('2026-08-24T06:30:00.000Z'),
        endAt: new Date('2026-08-24T07:30:00.000Z'),
      });
      const badStarts = [
        '2026-08-24T06:10:00.000Z',
        '2026-08-24T06:40:00.000Z',
      ];
      for (const iso of badStarts) {
        expect(slots.some((s) => s.startAt.toISOString() === iso)).toBe(false);
      }
    });

    it('offers a slot immediately after an adjacent booking ends', () => {
      const slots = findWorkshopSlots({
        timeZone: TZ,
        slotMinutes: 30,
        durationMinutes: 60,
        range: {
          from: new Date('2026-08-24T00:00:00.000Z'),
          to: new Date('2026-08-25T00:00:00.000Z'),
        },
        bays: [{ id: 'bay-1', sort_order: 0 }],
        holidays: [],
        openingHours: [...OPENINGS],
        orders: [
          order({
            id: 'wo-1',
            bay_id: 'bay-1',
            scheduled_start_at: new Date('2026-08-24T05:30:00.000Z'),
            scheduled_end_at: new Date('2026-08-24T06:30:00.000Z'),
          }),
        ],
        now: new Date('2026-08-23T10:00:00.000Z'),
      });
      expect(slots).toContainEqual({
        bayId: 'bay-1',
        startAt: new Date('2026-08-24T06:30:00.000Z'),
        endAt: new Date('2026-08-24T07:30:00.000Z'),
      });
    });

    it('blocks slots that overlap unscheduled floor occupancy for today', () => {
      const slots = findWorkshopSlots({
        timeZone: TZ,
        slotMinutes: 30,
        durationMinutes: 60,
        range: {
          from: new Date('2026-08-21T00:00:00.000Z'),
          to: new Date('2026-08-22T00:00:00.000Z'),
        },
        bays: [{ id: 'bay-1', sort_order: 0 }],
        holidays: [],
        openingHours: [...OPENINGS],
        orders: [
          order({
            id: 'wo-floor',
            bay_id: 'bay-1',
            status: WorkshopOrderStatus.INTAKE,
          }),
        ],
        now: new Date('2026-08-21T10:00:00.000Z'),
      });
      expect(
        slots.some(
          (slot) =>
            slot.startAt < new Date('2026-08-21T15:00:00.000Z') &&
            slot.endAt > new Date('2026-08-21T05:30:00.000Z'),
        ),
      ).toBe(false);
    });

    it('aligns opening hours across the DST fall-back in Vienna', () => {
      const slots = findWorkshopSlots({
        timeZone: TZ,
        slotMinutes: 30,
        durationMinutes: 60,
        range: {
          from: new Date('2026-10-26T00:00:00.000Z'),
          to: new Date('2026-10-27T00:00:00.000Z'),
        },
        bays: [{ id: 'bay-1', sort_order: 0 }],
        holidays: [],
        openingHours: [...OPENINGS],
        orders: [],
        now: new Date('2026-10-25T10:00:00.000Z'),
      });
      expect(slots[0]).toEqual({
        bayId: 'bay-1',
        startAt: new Date('2026-10-26T06:30:00.000Z'),
        endAt: new Date('2026-10-26T07:30:00.000Z'),
      });
    });

    it('honours shortened holiday opening hours', () => {
      const slots = findWorkshopSlots({
        timeZone: TZ,
        slotMinutes: 30,
        durationMinutes: 60,
        range: {
          from: new Date('2026-12-24T00:00:00.000Z'),
          to: new Date('2026-12-25T00:00:00.000Z'),
        },
        bays: [{ id: 'bay-1', sort_order: 0 }],
        holidays: [
          {
            name: 'Heiligabend',
            observed_on: new Date('2026-12-24T00:00:00.000Z'),
            repeats_annually: false,
            is_closed: false,
            open_time: '08:00',
            close_time: '12:00',
          } as never,
        ],
        openingHours: [...OPENINGS],
        orders: [],
        now: new Date('2026-12-23T10:00:00.000Z'),
      });
      const last = slots.at(-1);
      expect(last?.startAt).toEqual(new Date('2026-12-24T10:00:00.000Z'));
      expect(last?.endAt).toEqual(new Date('2026-12-24T11:00:00.000Z'));
    });
  });
});
