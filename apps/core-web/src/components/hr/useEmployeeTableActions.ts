import * as React from 'react'
import { toast } from 'sonner'

import type {
  Employee,
  EmployeeRole,
  useCreateEmployee,
  useDeleteEmployee,
  useUpdateEmployee,
} from '@/api/employees'
import type { usePatchLeaveBalance } from '@/api/hr'
import { getErrorMessage } from '@/lib/error-utils'
import { daysToMinutes, FALLBACK_AVG_WORKDAY_MINUTES } from '@/lib/hr-leave-minutes'
import { i18n } from '@/lib/i18n'

export const MIN_LEAVE_MINUTES = 0

const hrT = (key: string, options?: Record<string, unknown>) => i18n.t(`hr:${key}`, options)

export type EmployeeFormState = {
  name: string
  role: EmployeeRole
  sortOrder: string
  motherLanguageCode: string
  hiredOn: string
  annualLeaveMinutes: string
  annualLeaveDays: string
}

export const defaultFormState: EmployeeFormState = {
  name: '',
  role: 'MECHANIC',
  sortOrder: '0',
  motherLanguageCode: '',
  hiredOn: '',
  annualLeaveMinutes: '',
  annualLeaveDays: '',
}

export function parseAnnualLeaveMinutesFromForm(
  annualLeaveMinutes: string,
  annualLeaveDays: string,
  avgMinutesPerWorkday: number,
): number | undefined {
  const normalizedDays = annualLeaveDays.trim()
  if (normalizedDays) {
    const parsedDays = Number(normalizedDays)
    if (!Number.isFinite(parsedDays) || parsedDays < 0) {
      throw new Error(hrT('employees.validation.leaveDaysNonNegative'))
    }
    return daysToMinutes(parsedDays, avgMinutesPerWorkday)
  }

  const normalizedMinutes = annualLeaveMinutes.trim()
  if (!normalizedMinutes) {
    return undefined
  }

  const parsedMinutes = Number(normalizedMinutes)
  if (!Number.isInteger(parsedMinutes) || parsedMinutes < MIN_LEAVE_MINUTES) {
    throw new Error(hrT('employees.validation.leaveMinutesNonNegative'))
  }
  return parsedMinutes
}

export function parseAllowanceDays(allowanceDays: string): number {
  const parsed = Number(allowanceDays.trim())
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(hrT('employees.validation.leaveDaysNonNegative'))
  }
  return parsed
}

export function parseCarryoverMinutes(carryover: string): number {
  const parsed = Number(carryover.trim())
  if (!Number.isInteger(parsed) || parsed < MIN_LEAVE_MINUTES) {
    throw new Error(hrT('employees.validation.carryoverNonNegative'))
  }
  return parsed
}

export function applyCarryoverBalanceUpdate(
  current: Employee,
  updatedBalance: { carryoverMinutes: number; year: number },
): Employee {
  const carryoverDelta = updatedBalance.carryoverMinutes - current.carryoverMinutes
  return {
    ...current,
    carryoverMinutes: updatedBalance.carryoverMinutes,
    leaveBalanceYear: updatedBalance.year,
    remainingLeaveMinutes: current.remainingLeaveMinutes + carryoverDelta,
  }
}

export function validateAndBuildCreatePayload(
  formState: EmployeeFormState,
  hasHrEditAccess: boolean,
) {
  const normalizedName = formState.name.trim()
  if (!normalizedName) {
    throw new Error(hrT('employees.validation.nameRequired'))
  }

  const parsedSortOrder = Number(formState.sortOrder)
  if (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
    throw new Error(hrT('employees.validation.sortOrderNonNegative'))
  }

  let parsedAnnualLeaveMinutes: number | undefined
  if (hasHrEditAccess) {
    parsedAnnualLeaveMinutes = parseAnnualLeaveMinutesFromForm(
      formState.annualLeaveMinutes,
      formState.annualLeaveDays,
      FALLBACK_AVG_WORKDAY_MINUTES,
    )
  }

  return {
    name: normalizedName,
    role: formState.role,
    sortOrder: parsedSortOrder,
    isActive: true,
    motherLanguageCode: formState.motherLanguageCode || null,
    ...(hasHrEditAccess
      ? {
          hiredOn: formState.hiredOn || null,
          ...(parsedAnnualLeaveMinutes !== undefined && {
            annualLeaveMinutes: parsedAnnualLeaveMinutes,
          }),
        }
      : {}),
  }
}

export type UseEmployeeTableActionsOptions = {
  createMutation: ReturnType<typeof useCreateEmployee>
  updateMutation: ReturnType<typeof useUpdateEmployee>
  deleteMutation: ReturnType<typeof useDeleteEmployee>
  patchLeaveBalanceMutation: ReturnType<typeof usePatchLeaveBalance>
  hasHrEditAccess: boolean
  selectedEmployee: Employee | null
  setSelectedEmployee: React.Dispatch<React.SetStateAction<Employee | null>>
  formState: EmployeeFormState
  setFormState: React.Dispatch<React.SetStateAction<EmployeeFormState>>
  onCreateOpenChange: (open: boolean) => void
  sheetAllowanceDays: string
  sheetAvgMinutes: number
  carryoverMinutes: string
  setCarryoverMinutes: React.Dispatch<React.SetStateAction<string>>
}

export function useEmployeeTableActions({
  createMutation,
  updateMutation,
  deleteMutation,
  patchLeaveBalanceMutation,
  hasHrEditAccess,
  selectedEmployee,
  setSelectedEmployee,
  formState,
  setFormState,
  onCreateOpenChange,
  sheetAllowanceDays,
  sheetAvgMinutes,
  carryoverMinutes,
  setCarryoverMinutes,
}: UseEmployeeTableActionsOptions) {
  const runUpdate = React.useCallback(
    async (
      id: string,
      data: {
        name?: string
        role?: EmployeeRole
        isActive?: boolean
        sortOrder?: number
        motherLanguageCode?: string | null
        hiredOn?: string | null
        annualLeaveMinutes?: number
      },
      successMessage: string,
      fallbackMessage: string,
    ) => {
      try {
        await updateMutation.mutateAsync({ id, data })
        toast.success(successMessage)
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, fallbackMessage))
        throw error
      }
    },
    [updateMutation],
  )

  const handleCreate = React.useCallback(
    async (event?: React.SyntheticEvent) => {
      event?.preventDefault()

      let payload: ReturnType<typeof validateAndBuildCreatePayload>
      try {
        payload = validateAndBuildCreatePayload(formState, hasHrEditAccess)
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, hrT('employees.toast.createFailed')))
        return
      }

      try {
        await createMutation.mutateAsync(payload)
        toast.success(hrT('employees.toast.created'))
        setFormState(defaultFormState)
        onCreateOpenChange(false)
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, hrT('employees.toast.createFailed')))
      }
    },
    [createMutation, formState, hasHrEditAccess, onCreateOpenChange, setFormState],
  )

  const handleDelete = React.useCallback(
    async (id: string) => {
      try {
        const result = await deleteMutation.mutateAsync(id)
        if (result.deleted) {
          toast.success(hrT('employees.toast.deleted'))
          return
        }

        toast.success(hrT('employees.toast.deactivated'))
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, hrT('employees.toast.deleteFailed')))
      }
    },
    [deleteMutation],
  )

  const handleSaveAllowanceDays = React.useCallback(async () => {
    if (!selectedEmployee || !hasHrEditAccess || !sheetAllowanceDays.trim()) return

    let parsedDays: number
    try {
      parsedDays = parseAllowanceDays(sheetAllowanceDays)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, hrT('employees.validation.leaveDaysNonNegative')))
      return
    }

    const annualLeaveMinutes = daysToMinutes(parsedDays, sheetAvgMinutes)
    if (annualLeaveMinutes === selectedEmployee.annualLeaveMinutes) return

    try {
      await runUpdate(
        selectedEmployee.id,
        { annualLeaveMinutes },
        hrT('employees.toast.leaveAllowanceUpdated'),
        hrT('employees.toast.updateLeaveAllowanceFailed'),
      )
      setSelectedEmployee((current) =>
        current?.id === selectedEmployee.id ? { ...current, annualLeaveMinutes } : current,
      )
    } catch {
      // runUpdate already toasted
    }
  }, [
    hasHrEditAccess,
    runUpdate,
    selectedEmployee,
    setSelectedEmployee,
    sheetAllowanceDays,
    sheetAvgMinutes,
  ])

  const handleSaveCarryover = React.useCallback(async () => {
    if (!selectedEmployee || !hasHrEditAccess || !carryoverMinutes.trim()) return

    let parsedCarryoverMinutes: number
    try {
      parsedCarryoverMinutes = parseCarryoverMinutes(carryoverMinutes)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, hrT('employees.validation.carryoverNonNegative')))
      return
    }

    if (parsedCarryoverMinutes === selectedEmployee.carryoverMinutes) return

    try {
      const updatedBalance = await patchLeaveBalanceMutation.mutateAsync({
        employeeId: selectedEmployee.id,
        data: {
          year: selectedEmployee.leaveBalanceYear,
          carryoverMinutes: parsedCarryoverMinutes,
        },
      })

      setSelectedEmployee((current) =>
        current?.id === selectedEmployee.id
          ? applyCarryoverBalanceUpdate(current, updatedBalance)
          : current,
      )
      setCarryoverMinutes(String(updatedBalance.carryoverMinutes))
      toast.success(hrT('employees.toast.carryoverUpdated'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, hrT('employees.toast.updateCarryoverFailed')))
    }
  }, [
    carryoverMinutes,
    hasHrEditAccess,
    patchLeaveBalanceMutation,
    selectedEmployee,
    setCarryoverMinutes,
    setSelectedEmployee,
  ])

  return {
    runUpdate,
    handleCreate,
    handleDelete,
    handleSaveAllowanceDays,
    handleSaveCarryover,
  }
}
