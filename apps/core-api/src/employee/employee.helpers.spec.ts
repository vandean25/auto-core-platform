import { ConflictException } from '@nestjs/common';
import { EmployeeRole, Prisma } from '@prisma/client';
import {
  buildEmployeeUpdateData,
  handleEmployeeConflict,
  mapEmployee,
  toDateOnly,
} from './employee.helpers';

describe('employee.helpers', () => {
  describe('toDateOnly', () => {
    it('returns null for null or undefined', () => {
      expect(toDateOnly(null)).toBeNull();
      expect(toDateOnly(undefined)).toBeNull();
    });

    it('converts date string to UTC midnight Date', () => {
      const date = toDateOnly('2026-03-15');
      expect(date).toEqual(new Date('2026-03-15T00:00:00.000Z'));
    });
  });

  describe('handleEmployeeConflict', () => {
    it('throws ConflictException on Prisma P2002 error', () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint violation',
        { code: 'P2002', clientVersion: '0' },
      );
      expect(() => handleEmployeeConflict(p2002)).toThrow(ConflictException);
      expect(() => handleEmployeeConflict(p2002)).toThrow(
        'This user account is already linked to another employee in this tenant.',
      );
    });

    it('rethrows unexpected errors untouched', () => {
      const err = new Error('Database error');
      expect(() => handleEmployeeConflict(err)).toThrow(err);
    });
  });

  describe('buildEmployeeUpdateData', () => {
    it('maps only provided fields and trims name', () => {
      const data = buildEmployeeUpdateData({
        name: '  John Doe  ',
        role: EmployeeRole.OFFICE,
        hiredOn: '2025-01-01',
      });
      expect(data).toEqual({
        name: 'John Doe',
        role: EmployeeRole.OFFICE,
        hired_on: new Date('2025-01-01T00:00:00.000Z'),
      });
    });

    it('handles nullable fields explicitly', () => {
      const data = buildEmployeeUpdateData({
        userId: null,
        hiredOn: null,
      });
      expect(data).toEqual({
        user_id: null,
        hired_on: null,
      });
    });
  });

  describe('mapEmployee', () => {
    it('formats raw employee and leave summary into API shape', () => {
      const raw = {
        id: 'emp-1',
        name: 'Alice',
        role: EmployeeRole.MECHANIC,
        is_active: true,
        sort_order: 2,
        user_id: 'user-1',
        mother_language_code: 'en',
        hired_on: new Date('2024-05-10T00:00:00.000Z'),
        annual_leave_minutes: 12000,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      };
      const leaveSummary = {
        remainingLeaveMinutes: 10000,
        carryoverMinutes: 500,
        leaveBalanceYear: 2026,
      };

      const result = mapEmployee(raw, leaveSummary);
      expect(result).toEqual({
        id: 'emp-1',
        name: 'Alice',
        role: EmployeeRole.MECHANIC,
        isActive: true,
        sortOrder: 2,
        userId: 'user-1',
        motherLanguageCode: 'en',
        hiredOn: '2024-05-10',
        annualLeaveMinutes: 12000,
        carryoverMinutes: 500,
        leaveBalanceYear: 2026,
        remainingLeaveMinutes: 10000,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      });
    });
  });
});
