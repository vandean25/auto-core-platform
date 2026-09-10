import { BadRequestException } from '@nestjs/common';
import { LeaveRequestStatus } from '@prisma/client';
import {
  calculateRemainingLeaveMinutes,
  formatUtcDateOnly,
  toLeaveRequestDto,
  toUtcDateOnly,
  validateDateRange,
  validateLeaveTransition,
} from './hr-leave.helpers';

describe('hr-leave.helpers', () => {
  describe('toUtcDateOnly', () => {
    it('parses valid YYYY-MM-DD to UTC Date at midnight', () => {
      const date = toUtcDateOnly('2026-06-15');
      expect(date.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    });

    it('throws BadRequestException on invalid format', () => {
      expect(() => toUtcDateOnly('2026/06/15')).toThrow(BadRequestException);
      expect(() => toUtcDateOnly('invalid-date')).toThrow(BadRequestException);
    });
  });

  describe('formatUtcDateOnly', () => {
    it('formats UTC Date to YYYY-MM-DD string', () => {
      const date = new Date('2026-11-20T00:00:00.000Z');
      expect(formatUtcDateOnly(date)).toBe('2026-11-20');
    });
  });

  describe('validateDateRange', () => {
    it('returns ValidatedDateRange for same-day range', () => {
      const res = validateDateRange('2026-04-10', '2026-04-10');
      expect(res.startOnStr).toBe('2026-04-10');
      expect(res.endOnStr).toBe('2026-04-10');
      expect(res.year).toBe(2026);
      expect(res.startOnDate.toISOString()).toBe('2026-04-10T00:00:00.000Z');
      expect(res.endOnDate.toISOString()).toBe('2026-04-10T00:00:00.000Z');
    });

    it('returns ValidatedDateRange for multi-day range in same year', () => {
      const res = validateDateRange('2026-04-10', '2026-04-15');
      expect(res.year).toBe(2026);
    });

    it('throws BadRequestException if endOn is before startOn', () => {
      expect(() => validateDateRange('2026-04-15', '2026-04-10')).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if range spans two calendar years', () => {
      expect(() => validateDateRange('2026-12-30', '2027-01-02')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('validateLeaveTransition', () => {
    it('allows updating a BOOKED leave request', () => {
      expect(() =>
        validateLeaveTransition(LeaveRequestStatus.BOOKED, 'update'),
      ).not.toThrow();
    });

    it('throws BadRequestException when attempting to edit a CANCELLED leave request', () => {
      expect(() =>
        validateLeaveTransition(LeaveRequestStatus.CANCELLED, 'update'),
      ).toThrow(BadRequestException);
    });

    it('allows cancel action on CANCELLED leave request (idempotent)', () => {
      expect(() =>
        validateLeaveTransition(LeaveRequestStatus.CANCELLED, 'cancel'),
      ).not.toThrow();
    });
  });

  describe('calculateRemainingLeaveMinutes', () => {
    it('calculates remaining minutes correctly', () => {
      const remaining = calculateRemainingLeaveMinutes(12875, 2575, 2850);
      expect(remaining).toBe(12600);
    });
  });

  describe('toLeaveRequestDto', () => {
    it('maps leave request without employee relation', () => {
      const booking = {
        id: 'req-1',
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        start_on: new Date('2026-07-01T00:00:00.000Z'),
        end_on: new Date('2026-07-05T00:00:00.000Z'),
        status: LeaveRequestStatus.BOOKED,
        minutes_charged: 2575,
        note: 'Holiday',
        created_by_user_id: 'user-1',
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
      };

      const dto = toLeaveRequestDto(booking);
      expect(dto.id).toBe('req-1');
      expect(dto.employeeId).toBe('emp-1');
      expect(dto.startOn).toBe('2026-07-01');
      expect(dto.endOn).toBe('2026-07-05');
      expect(dto.status).toBe(LeaveRequestStatus.BOOKED);
      expect(dto.minutesCharged).toBe(2575);
      expect(dto.note).toBe('Holiday');
      expect(dto.createdByUserId).toBe('user-1');
      expect(dto.employee).toBeUndefined();
    });

    it('maps leave request with employee relation', () => {
      const booking = {
        id: 'req-1',
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        start_on: new Date('2026-07-01T00:00:00.000Z'),
        end_on: new Date('2026-07-05T00:00:00.000Z'),
        status: LeaveRequestStatus.BOOKED,
        minutes_charged: 2575,
        note: null,
        created_by_user_id: null,
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        updatedAt: new Date('2026-06-01T10:00:00.000Z'),
        employee: {
          id: 'emp-1',
          name: 'Jane Doe',
          role: 'SALES' as const,
        },
      };

      const dto = toLeaveRequestDto(booking);
      expect(dto.employee).toEqual({
        id: 'emp-1',
        name: 'Jane Doe',
        role: 'SALES',
      });
    });
  });
});
