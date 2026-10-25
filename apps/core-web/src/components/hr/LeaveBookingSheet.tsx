import { useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import type { Employee } from '@/api/employees'
import {
  type CreateEmployeeLeavePayload,
  type CreateLeavePayload,
  type LeaveRequest,
  useCreateEmployeeLeave,
  useCreateLeave,
} from '@/api/hr'
import type { components } from '@/api/generated/openapi'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatIsoDateOnly, formatLocalDateInZone } from '@/lib/format'
import { getErrorMessage } from '@/lib/error-utils'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'

function hrT(key: string): string {
  const t = i18n.getFixedT(i18n.language, 'hr') as (k: string) => string
  return t(key)
}

type TenantMemberRole = components['schemas']['TenantMemberRole']
type LeaveEmployee = Pick<Employee, 'id' | 'name' | 'role'>

const DEFAULT_TIMEZONE = 'UTC'

export type LeaveBookingSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeRole?: TenantMemberRole | null
  employee: LeaveEmployee
  employees: LeaveEmployee[]
  initialEmployeeId?: string
  initialStartOn?: string
  initialEndOn?: string
  timezone?: string
  booking?: LeaveRequest | null
}

type LeaveFormState = {
  employeeId: string
  startOn: string
  endOn: string
  note: string
}

function canManageLeave(activeRole?: TenantMemberRole | null): boolean {
  return activeRole === 'OWNER' || activeRole === 'ADMIN'
}

function getToday(timezone: string): string {
  return formatLocalDateInZone(new Date(), timezone)
}

function getInitialFormState(
  employee: LeaveEmployee,
  initialEmployeeId?: string,
  initialStartOn?: string,
  initialEndOn?: string,
  timezone = DEFAULT_TIMEZONE,
): LeaveFormState {
  const startOn = initialStartOn ?? getToday(timezone)
  return {
    employeeId: initialEmployeeId ?? employee.id,
    startOn,
    endOn: initialEndOn ?? startOn,
    note: '',
  }
}

function getNotePayload(note: string): Pick<CreateLeavePayload, 'note'> {
  const normalizedNote = note.trim()
  return normalizedNote ? { note: normalizedNote } : {}
}

function getBookingEmployeeName(booking: LeaveRequest, employees: LeaveEmployee[]): string {
  return booking.employee?.name ?? employees.find((employee) => employee.id === booking.employeeId)?.name ?? hrT('leave.bookingSheet.employeeFallback')
}

function LeaveBookingDetails({ booking, employeeName, t }: { booking: LeaveRequest; employeeName: string; t: TFunction<'hr'> }) {
  return (
    <div className='space-y-5' data-testid='leave-booking-details'>
      <div className='space-y-1'>
        <p className='text-sm font-medium text-slate-900'>{employeeName}</p>
        <StatusBadge status={booking.status} />
      </div>
      <dl className='grid gap-4 sm:grid-cols-2'>
        <div>
          <dt className='text-sm font-medium text-slate-500'>{t('leave.bookingSheet.start')}</dt>
          <dd className='text-sm'>{formatIsoDateOnly(booking.startOn)}</dd>
        </div>
        <div>
          <dt className='text-sm font-medium text-slate-500'>{t('leave.bookingSheet.end')}</dt>
          <dd className='text-sm'>{formatIsoDateOnly(booking.endOn)}</dd>
        </div>
        <div>
          <dt className='text-sm font-medium text-slate-500'>{t('leave.bookingSheet.chargedMin')}</dt>
          <dd className='text-sm'>{booking.minutesCharged}</dd>
        </div>
        <div>
          <dt className='text-sm font-medium text-slate-500'>{t('leave.bookingSheet.note')}</dt>
          <dd className='text-sm'>{booking.note || i18n.t('common:placeholders.missing')}</dd>
        </div>
      </dl>
    </div>
  )
}

export function LeaveBookingSheet({
  open,
  onOpenChange,
  activeRole,
  employee,
  employees,
  initialEmployeeId,
  initialStartOn,
  initialEndOn,
  timezone = DEFAULT_TIMEZONE,
  booking,
}: LeaveBookingSheetProps) {
  const { t } = useTranslation('hr')
  useEffect(() => { void ensureNamespaceLoaded('hr') }, [])

  const isManager = canManageLeave(activeRole)
  const createLeave = useCreateLeave()
  const createEmployeeLeave = useCreateEmployeeLeave()
  const [formState, setFormState] = useState(() =>
    getInitialFormState(employee, initialEmployeeId, initialStartOn, initialEndOn, timezone),
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFormState(getInitialFormState(employee, initialEmployeeId, initialStartOn, initialEndOn, timezone))
    setErrorMessage(null)
  }, [employee, initialEmployeeId, initialStartOn, initialEndOn, open, timezone])

  const isPending = createLeave.isPending || createEmployeeLeave.isPending

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)

    try {
      if (isManager) {
        const payload: CreateEmployeeLeavePayload = {
          employeeId: formState.employeeId,
          startOn: formState.startOn,
          endOn: formState.endOn,
          ...getNotePayload(formState.note),
        }
        await createEmployeeLeave.mutateAsync(payload)
      } else {
        const payload: CreateLeavePayload = {
          startOn: formState.startOn,
          endOn: formState.endOn,
          ...getNotePayload(formState.note),
        }
        await createLeave.mutateAsync(payload)
      }
      onOpenChange(false)
    } catch (error) {
      const message = getErrorMessage(error, t('leave.bookingSheet.createFailed'))
      setErrorMessage(message)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='w-full overflow-y-auto sm:max-w-xl'>
        <SheetHeader className='mb-6 flex-row items-start justify-between pr-10 text-left'>
          <div className='space-y-2'>
            <SheetTitle>{booking ? t('leave.bookingSheet.viewTitle') : t('leave.bookingSheet.bookTitle')}</SheetTitle>
            <SheetDescription>
              {booking ? t('leave.bookingSheet.viewDescription') : t('leave.bookingSheet.bookDescription')}
            </SheetDescription>
          </div>
          {!booking ? (
            <Button type='submit' form='leave-booking-form' disabled={isPending}>
              {isPending ? t('leave.bookingSheet.saving') : t('leave.bookLeave')}
            </Button>
          ) : null}
        </SheetHeader>

        {booking ? (
          <LeaveBookingDetails booking={booking} employeeName={getBookingEmployeeName(booking, employees)} t={t} />
        ) : (
          <form id='leave-booking-form' onSubmit={handleSubmit} className='space-y-5'>
            <div className='space-y-2'>
              <Label htmlFor='leave-employee'>{t('leave.bookingSheet.employee')}</Label>
              {isManager ? (
                <select
                  id='leave-employee'
                  className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm'
                  value={formState.employeeId}
                  onChange={(event) => {
                    setFormState((current) => ({ ...current, employeeId: event.target.value }))
                  }}
                >
                  {employees.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input id='leave-employee' value={employee.name} readOnly />
              )}
            </div>

            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='leave-start'>{t('leave.bookingSheet.start')}</Label>
                <Input
                  id='leave-start'
                  type='date'
                  value={formState.startOn}
                  onChange={(event) => {
                    setFormState((current) => ({ ...current, startOn: event.target.value }))
                  }}
                  required
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='leave-end'>{t('leave.bookingSheet.end')}</Label>
                <Input
                  id='leave-end'
                  type='date'
                  value={formState.endOn}
                  onChange={(event) => {
                    setFormState((current) => ({ ...current, endOn: event.target.value }))
                  }}
                  required
                />
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='leave-note'>{t('leave.bookingSheet.note')}</Label>
              <textarea
                id='leave-note'
                value={formState.note}
                onChange={(event) => {
                  setFormState((current) => ({ ...current, note: event.target.value }))
                }}
                className='min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring'
                placeholder={t('leave.bookingSheet.notePlaceholder')}
              />
            </div>

            {errorMessage ? (
              <Alert variant='destructive'>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}

          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
