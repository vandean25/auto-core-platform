import { BadRequestException } from '@nestjs/common';
import {
  parsePlannerRange,
  plannerLeaveBounds,
  syntheticWindow,
  windowOverlaps,
} from './workshop-planner.window.js';

describe('workshop-planner.window', () => {
  describe('parsePlannerRange', () => {
    it('parses the ISO instant pair into Dates', () => {
      expect(
        parsePlannerRange({
          from: '2026-08-24T00:00:00.000Z',
          to: '2026-08-26T22:00:00.000Z',
        }),
      ).toEqual({
        from: new Date('2026-08-24T00:00:00.000Z'),
        to: new Date('2026-08-26T22:00:00.000Z'),
      });
    });

    it('requires both bounds to be present', () => {
      expect(() =>
        parsePlannerRange({ to: '2026-08-26T00:00:00.000Z' }),
      ).toThrow(new BadRequestException('from is required'));
      expect(() =>
        parsePlannerRange({ from: '2026-08-24T00:00:00.000Z' }),
      ).toThrow(new BadRequestException('to is required'));
    });

    it('rejects bounds that are not ISO instants', () => {
      expect(() =>
        parsePlannerRange({
          from: '2026-08-24T00:00:00.000Z',
          to: 'not-a-date',
        }),
      ).toThrow('to must be an ISO instant');
    });

    it('rejects a window that does not move forward', () => {
      expect(() =>
        parsePlannerRange({
          from: '2026-08-24T00:00:00.000Z',
          to: '2026-08-24T00:00:00.000Z',
        }),
      ).toThrow(BadRequestException);
      expect(() =>
        parsePlannerRange({
          from: '2026-08-24T00:00:00.000Z',
          to: '2026-08-23T00:00:00.000Z',
        }),
      ).toThrow('to must be after from');
    });

    it('caps the window at exactly 8 days', () => {
      expect(
        parsePlannerRange({
          from: '2026-08-01T00:00:00.000Z',
          to: '2026-08-09T00:00:00.000Z',
        }).to,
      ).toEqual(new Date('2026-08-09T00:00:00.000Z'));
      expect(() =>
        parsePlannerRange({
          from: '2026-08-01T00:00:00.000Z',
          to: '2026-08-10T00:00:00.000Z',
        }),
      ).toThrow('Planner range cannot exceed 8 days');
    });
  });

  describe('plannerLeaveBounds', () => {
    it('uses the local calendar day at each window edge', () => {
      expect(
        plannerLeaveBounds(
          {
            from: new Date('2026-08-24T00:00:00.000Z'),
            to: new Date('2026-08-26T22:00:00.000Z'),
          },
          'America/Los_Angeles',
        ),
      ).toEqual({
        fromLocalDate: new Date('2026-08-23T00:00:00.000Z'),
        toLocalDate: new Date('2026-08-26T00:00:00.000Z'),
      });
    });

    it('keeps the same calendar days in a positive-offset timezone', () => {
      expect(
        plannerLeaveBounds(
          {
            from: new Date('2026-08-24T12:00:00.000Z'),
            to: new Date('2026-08-26T12:00:00.000Z'),
          },
          'Europe/Vienna',
        ),
      ).toEqual({
        fromLocalDate: new Date('2026-08-24T00:00:00.000Z'),
        toLocalDate: new Date('2026-08-26T00:00:00.000Z'),
      });
    });
  });

  describe('windowOverlaps', () => {
    const range = {
      from: new Date('2026-10-26T00:00:00.000Z'),
      to: new Date('2026-10-27T00:00:00.000Z'),
    };

    it('detects a window that overlaps the range', () => {
      expect(
        windowOverlaps(
          {
            start: new Date('2026-10-26T08:00:00.000Z'),
            end: new Date('2026-10-26T09:00:00.000Z'),
          },
          range,
        ),
      ).toBe(true);
    });

    it('treats windows that only touch the range edges as not overlapping', () => {
      expect(
        windowOverlaps(
          {
            start: new Date('2026-10-27T00:00:00.000Z'),
            end: new Date('2026-10-27T01:00:00.000Z'),
          },
          range,
        ),
      ).toBe(false);
      expect(
        windowOverlaps(
          {
            start: new Date('2026-10-25T23:00:00.000Z'),
            end: new Date('2026-10-26T00:00:00.000Z'),
          },
          range,
        ),
      ).toBe(false);
    });
  });

  describe('syntheticWindow', () => {
    it('spans the opening hours on an open day', () => {
      expect(
        syntheticWindow('Europe/Vienna', '2026-08-24', {
          isClosed: false,
          openTime: '07:30',
          closeTime: '17:00',
        }),
      ).toEqual({
        start: new Date('2026-08-24T05:30:00.000Z'),
        end: new Date('2026-08-24T15:00:00.000Z'),
      });
    });

    it('spans the whole local day when the site is closed', () => {
      expect(
        syntheticWindow('Europe/Vienna', '2026-08-24', {
          isClosed: true,
          openTime: null,
          closeTime: null,
        }),
      ).toEqual({
        start: new Date('2026-08-23T22:00:00.000Z'),
        end: new Date('2026-08-24T22:00:00.000Z'),
      });
    });

    it('falls back to the whole local day when an open day has no times', () => {
      expect(
        syntheticWindow('Europe/Vienna', '2026-08-24', {
          isClosed: false,
          openTime: null,
          closeTime: null,
        }),
      ).toEqual({
        start: new Date('2026-08-23T22:00:00.000Z'),
        end: new Date('2026-08-24T22:00:00.000Z'),
      });
    });
  });
});
