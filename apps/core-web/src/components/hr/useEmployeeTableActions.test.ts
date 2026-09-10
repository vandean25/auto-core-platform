import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Employee, useCreateEmployee, useDeleteEmployee, useUpdateEmployee } from '@/api/employees'
import type { usePatchLeaveBalance } from '@/api/hr'
import {
  applyCarryoverBalanceUpdate,
  parseAllowanceDays,
  parseAnnualLeaveMinutesFromForm,
  parseCarryoverMinutes,
  useEmployeeTableActions,
  validateAndBuildCreatePayload,
} from './useEmployeeTableActions'

const dummyEmployee: Employee = {
  id: 'emp-1',
  name: 'Ada Lovelace',
  role: 'MECHANIC',
  isActive: true,
  sortOrder: 0,
  motherLanguageCode: 'en-US',
  hiredOn: '2024-03-01',
  annualLeaveMinutes: 12875,
  carryoverMinutes: 1545,
  leaveBalanceYear: 2025,
  remainingLeaveMinutes: 11330,
  createdAt: '2024-03-01T00:00:00.000Z',
  updatedAt: '2024-03-01T00:00:00.000Z',
}

describe('useEmployeeTableActions pure helpers', () => {
  describe('parseAnnualLeaveMinutesFromForm', () => {
    it('returns undefined when neither days nor minutes are provided', () => {
      expect(parseAnnualLeaveMinutesFromForm('', '', 480)).toBeUndefined()
    })

    it('parses days into minutes using workday length', () => {
      expect(parseAnnualLeaveMinutesFromForm('', '10', 480)).toBe(4800)
    })

    it('throws error for negative or invalid days', () => {
      expect(() => parseAnnualLeaveMinutesFromForm('', '-2', 480)).toThrow(
        'Leave days must be a non-negative number',
      )
      expect(() => parseAnnualLeaveMinutesFromForm('', 'abc', 480)).toThrow(
        'Leave days must be a non-negative number',
      )
    })

    it('parses minutes when days are empty', () => {
      expect(parseAnnualLeaveMinutesFromForm('2400', '', 480)).toBe(2400)
    })

    it('throws error for negative or non-integer minutes', () => {
      expect(() => parseAnnualLeaveMinutesFromForm('-100', '', 480)).toThrow(
        'Leave minutes must be a non-negative integer',
      )
      expect(() => parseAnnualLeaveMinutesFromForm('12.5', '', 480)).toThrow(
        'Leave minutes must be a non-negative integer',
      )
    })
  })

  describe('parseAllowanceDays', () => {
    it('parses valid positive number', () => {
      expect(parseAllowanceDays('25')).toBe(25)
      expect(parseAllowanceDays(' 12.5 ')).toBe(12.5)
    })

    it('throws error for negative or invalid values', () => {
      expect(() => parseAllowanceDays('-1')).toThrow('Leave days must be a non-negative number')
      expect(() => parseAllowanceDays('abc')).toThrow('Leave days must be a non-negative number')
    })
  })

  describe('parseCarryoverMinutes', () => {
    it('parses valid non-negative integer', () => {
      expect(parseCarryoverMinutes('0')).toBe(0)
      expect(parseCarryoverMinutes(' 1500 ')).toBe(1500)
    })

    it('throws error for negative or float values', () => {
      expect(() => parseCarryoverMinutes('-5')).toThrow(
        'Carryover minutes must be a non-negative integer',
      )
      expect(() => parseCarryoverMinutes('12.5')).toThrow(
        'Carryover minutes must be a non-negative integer',
      )
    })
  })

  describe('applyCarryoverBalanceUpdate', () => {
    it('updates carryover, balance year, and recalculates remainingLeaveMinutes with delta', () => {
      const updated = applyCarryoverBalanceUpdate(dummyEmployee, {
        carryoverMinutes: 2060,
        year: 2026,
      })

      // Delta is 2060 - 1545 = 515
      expect(updated.carryoverMinutes).toBe(2060)
      expect(updated.leaveBalanceYear).toBe(2026)
      expect(updated.remainingLeaveMinutes).toBe(11330 + 515)
    })
  })

  describe('validateAndBuildCreatePayload', () => {
    it('validates required name', () => {
      expect(() =>
        validateAndBuildCreatePayload(
          {
            name: '  ',
            role: 'MECHANIC',
            sortOrder: '0',
            motherLanguageCode: '',
            hiredOn: '',
            annualLeaveMinutes: '',
            annualLeaveDays: '',
          },
          true,
        ),
      ).toThrow('Employee name is required')
    })

    it('validates sort order', () => {
      expect(() =>
        validateAndBuildCreatePayload(
          {
            name: 'Valid Name',
            role: 'MECHANIC',
            sortOrder: '-1',
            motherLanguageCode: '',
            hiredOn: '',
            annualLeaveMinutes: '',
            annualLeaveDays: '',
          },
          true,
        ),
      ).toThrow('Sort order must be a non-negative integer')
    })

    it('constructs payload with HR fields when hasHrEditAccess is true', () => {
      const payload = validateAndBuildCreatePayload(
        {
          name: 'Jane Doe',
          role: 'SERVICE_ADVISOR',
          sortOrder: '2',
          motherLanguageCode: 'es',
          hiredOn: '2024-01-01',
          annualLeaveMinutes: '',
          annualLeaveDays: '20',
        },
        true,
      )

      expect(payload).toEqual({
        name: 'Jane Doe',
        role: 'SERVICE_ADVISOR',
        sortOrder: 2,
        isActive: true,
        motherLanguageCode: 'es',
        hiredOn: '2024-01-01',
        annualLeaveMinutes: 20 * 480,
      })
    })

    it('omits HR fields when hasHrEditAccess is false', () => {
      const payload = validateAndBuildCreatePayload(
        {
          name: 'Jane Doe',
          role: 'SERVICE_ADVISOR',
          sortOrder: '2',
          motherLanguageCode: '',
          hiredOn: '2024-01-01',
          annualLeaveMinutes: '500',
          annualLeaveDays: '20',
        },
        false,
      )

      expect(payload).toEqual({
        name: 'Jane Doe',
        role: 'SERVICE_ADVISOR',
        sortOrder: 2,
        isActive: true,
        motherLanguageCode: null,
      })
      expect(payload).not.toHaveProperty('hiredOn')
      expect(payload).not.toHaveProperty('annualLeaveMinutes')
    })
  })
})

describe('useEmployeeTableActions hook', () => {
  it('handles delete employee correctly', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ deleted: true })
    const { result } = renderHook(() =>
      useEmployeeTableActions({
        createMutation: { mutateAsync: vi.fn(), isPending: false } as unknown as ReturnType<
          typeof useCreateEmployee
        >,
        updateMutation: { mutateAsync: vi.fn(), isPending: false } as unknown as ReturnType<
          typeof useUpdateEmployee
        >,
        deleteMutation: { mutateAsync, isPending: false } as unknown as ReturnType<
          typeof useDeleteEmployee
        >,
        patchLeaveBalanceMutation: { mutateAsync: vi.fn(), isPending: false } as unknown as ReturnType<
          typeof usePatchLeaveBalance
        >,
        hasHrEditAccess: true,
        selectedEmployee: null,
        setSelectedEmployee: vi.fn(),
        formState: {
          name: '',
          role: 'MECHANIC',
          sortOrder: '0',
          motherLanguageCode: '',
          hiredOn: '',
          annualLeaveMinutes: '',
          annualLeaveDays: '',
        },
        setFormState: vi.fn(),
        onCreateOpenChange: vi.fn(),
        sheetAllowanceDays: '',
        sheetAvgMinutes: 480,
        carryoverMinutes: '0',
        setCarryoverMinutes: vi.fn(),
      }),
    )

    await act(async () => {
      await result.current.handleDelete('emp-1')
    })

    expect(mutateAsync).toHaveBeenCalledWith('emp-1')
  })
})
