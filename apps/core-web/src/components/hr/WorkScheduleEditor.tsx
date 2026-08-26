import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  useCreateWorkSchedule,
  useEmployeeWorkSchedule,
  useUpdateWorkSchedule,
} from '@/api/hr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/error-utils'
import {
  buildDefaultDays,
  daysFromVersion,
  normalizeDaysForSubmit,
  type ScheduleDayFormState,
  validateDays,
  WEEKDAY_LABELS,
  DEFAULT_NON_WORKING_DAY,
  DEFAULT_WORKING_DAY,
} from '@/components/hr/work-schedule-form'

export type WorkScheduleEditorProps = {
  employeeId: string
  canEdit: boolean
  defaultEffectiveFrom?: string
}

function ScheduleDayRow({
  day,
  canEdit,
  onChange,
}: {
  day: ScheduleDayFormState
  canEdit: boolean
  onChange: (weekday: number, patch: Partial<ScheduleDayFormState>) => void
}) {
  if (!canEdit) {
    return (
      <tr>
        <td className='px-3 py-2 text-sm'>{WEEKDAY_LABELS[day.weekday]}</td>
        <td className='px-3 py-2 text-sm'>{day.isWorking ? 'Yes' : 'No'}</td>
        <td className='px-3 py-2 text-sm'>{day.startTime ?? '—'}</td>
        <td className='px-3 py-2 text-sm'>{day.endTime ?? '—'}</td>
        <td className='px-3 py-2 text-sm'>{day.breakMinutes}</td>
      </tr>
    )
  }

  return (
    <tr>
      <td className='px-3 py-2 text-sm'>{WEEKDAY_LABELS[day.weekday]}</td>
      <td className='px-3 py-2'>
        <input
          type='checkbox'
          aria-label={`${WEEKDAY_LABELS[day.weekday]} working`}
          checked={day.isWorking}
          onChange={(event) => {
            const isWorking = event.target.checked
            onChange(day.weekday, isWorking
              ? {
                  isWorking: true,
                  startTime: day.startTime ?? DEFAULT_WORKING_DAY.startTime,
                  endTime: day.endTime ?? DEFAULT_WORKING_DAY.endTime,
                  breakMinutes: day.breakMinutes,
                }
              : DEFAULT_NON_WORKING_DAY)
          }}
        />
      </td>
      <td className='px-3 py-2'>
        <Input
          type='time'
          aria-label={`${WEEKDAY_LABELS[day.weekday]} start`}
          value={day.startTime ?? ''}
          disabled={!day.isWorking}
          onChange={(event) => onChange(day.weekday, { startTime: event.target.value })}
          className='h-8 w-[120px]'
        />
      </td>
      <td className='px-3 py-2'>
        <Input
          type='time'
          aria-label={`${WEEKDAY_LABELS[day.weekday]} end`}
          value={day.endTime ?? ''}
          disabled={!day.isWorking}
          onChange={(event) => onChange(day.weekday, { endTime: event.target.value })}
          className='h-8 w-[120px]'
        />
      </td>
      <td className='px-3 py-2'>
        <Input
          type='number'
          min={0}
          step={1}
          aria-label={`${WEEKDAY_LABELS[day.weekday]} break minutes`}
          value={day.breakMinutes}
          disabled={!day.isWorking}
          onChange={(event) =>
            onChange(day.weekday, { breakMinutes: Number(event.target.value) })}
          className='h-8 w-[88px]'
        />
      </td>
    </tr>
  )
}

function ScheduleDaysTable({
  days,
  canEdit,
  onChange,
}: {
  days: ScheduleDayFormState[]
  canEdit: boolean
  onChange: (weekday: number, patch: Partial<ScheduleDayFormState>) => void
}) {
  return (
    <div className='overflow-hidden rounded-md border'>
      <table className='min-w-full divide-y divide-slate-200'>
        <thead className='bg-slate-50'>
          <tr>
            <th className='px-3 py-2 text-left text-xs font-medium uppercase text-slate-500'>Day</th>
            <th className='px-3 py-2 text-left text-xs font-medium uppercase text-slate-500'>Working</th>
            <th className='px-3 py-2 text-left text-xs font-medium uppercase text-slate-500'>Start</th>
            <th className='px-3 py-2 text-left text-xs font-medium uppercase text-slate-500'>End</th>
            <th className='px-3 py-2 text-left text-xs font-medium uppercase text-slate-500'>Break (min)</th>
          </tr>
        </thead>
        <tbody className='divide-y divide-slate-200 bg-white'>
          {days.map((day) => (
            <ScheduleDayRow key={day.weekday} day={day} canEdit={canEdit} onChange={onChange} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function WorkScheduleEditor({
  employeeId,
  canEdit,
  defaultEffectiveFrom,
}: WorkScheduleEditorProps) {
  const scheduleQuery = useEmployeeWorkSchedule(employeeId)
  const createSchedule = useCreateWorkSchedule(employeeId)
  const updateSchedule = useUpdateWorkSchedule(employeeId)
  const currentVersion = scheduleQuery.data?.current
  const currentVersionId = currentVersion?.id
  const [correctionDays, setCorrectionDays] = useState<ScheduleDayFormState[]>(buildDefaultDays())
  const [newVersionDays, setNewVersionDays] = useState<ScheduleDayFormState[]>(buildDefaultDays())
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [showNewVersion, setShowNewVersion] = useState(false)

  useEffect(() => {
    if (!currentVersionId) {
      return
    }

    const mappedDays = daysFromVersion(currentVersion.days)
    setCorrectionDays(mappedDays)
    setNewVersionDays(mappedDays)
  }, [currentVersionId, currentVersion])

  useEffect(() => {
    if (!currentVersion && defaultEffectiveFrom) {
      setEffectiveFrom(defaultEffectiveFrom)
      return
    }
    if (currentVersion) {
      setEffectiveFrom('')
    }
  }, [currentVersion, defaultEffectiveFrom])

  useEffect(() => {
    if (!canEdit || currentVersion) {
      return
    }
    setShowNewVersion(true)
  }, [canEdit, currentVersion])

  const history = useMemo(
    () => scheduleQuery.data?.history.filter((version) => version.id !== currentVersion?.id) ?? [],
    [currentVersion?.id, scheduleQuery.data?.history],
  )

  const updateCorrectionDay = (weekday: number, patch: Partial<ScheduleDayFormState>) => {
    setCorrectionDays((current) =>
      current.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)),
    )
  }

  const updateNewVersionDay = (weekday: number, patch: Partial<ScheduleDayFormState>) => {
    setNewVersionDays((current) =>
      current.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)),
    )
  }

  const openNewVersionPanel = () => {
    setNewVersionDays(correctionDays)
    setEffectiveFrom('')
    setShowNewVersion(true)
  }

  const handleSaveCorrection = async () => {
    if (!currentVersion) return

    const validationError = validateDays(correctionDays)
    if (validationError) {
      toast.error(validationError)
      return
    }

    try {
      await updateSchedule.mutateAsync({
        scheduleId: currentVersion.id,
        data: { days: normalizeDaysForSubmit(correctionDays) },
      })
      toast.success('Work schedule updated')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update work schedule'))
    }
  }

  const handleCreateVersion = async () => {
    const validationError = validateDays(newVersionDays)
    if (validationError) {
      toast.error(validationError)
      return
    }

    if (!effectiveFrom) {
      toast.error('Effective date is required for a new schedule version')
      return
    }

    try {
      await createSchedule.mutateAsync({
        effectiveFrom,
        days: normalizeDaysForSubmit(newVersionDays),
      })
      toast.success('Work schedule version created')
      if (currentVersion) {
        setShowNewVersion(false)
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to create work schedule version'))
    }
  }

  if (scheduleQuery.isLoading) {
    return <p className='text-sm text-slate-500'>Loading work schedule…</p>
  }

  if (scheduleQuery.error) {
    return (
      <p className='text-sm text-red-600'>
        {getErrorMessage(scheduleQuery.error, 'Failed to load work schedule')}
      </p>
    )
  }

  const creatingFirstVersion = canEdit && !currentVersion

  return (
    <section className='space-y-4' data-testid='work-schedule-editor'>
      <div className='space-y-1'>
        <h4 className='text-sm font-semibold text-slate-900'>Work schedule</h4>
        <p className='text-sm text-slate-500'>
          Expected working hours per weekday. Leave minutes are charged from this pattern.
        </p>
        {currentVersion ? (
          <p className='text-xs text-slate-500'>Current version from {currentVersion.effectiveFrom}</p>
        ) : (
          <p className='text-xs text-slate-500'>No schedule version yet.</p>
        )}
      </div>

      {currentVersion ? (
        <ScheduleDaysTable
          days={correctionDays}
          canEdit={canEdit}
          onChange={updateCorrectionDay}
        />
      ) : creatingFirstVersion ? (
        <div className='space-y-4' data-testid='first-schedule-version'>
          <div className='space-y-2'>
            <Label htmlFor='schedule-effective-from'>Effective from</Label>
            <Input
              id='schedule-effective-from'
              type='date'
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </div>
          <ScheduleDaysTable days={newVersionDays} canEdit onChange={updateNewVersionDay} />
          <Button
            type='button'
            size='sm'
            disabled={createSchedule.isPending}
            onClick={() => void handleCreateVersion()}
          >
            {createSchedule.isPending ? 'Creating…' : 'Create version'}
          </Button>
        </div>
      ) : (
        <ScheduleDaysTable days={buildDefaultDays()} canEdit={false} onChange={() => undefined} />
      )}

      {canEdit && currentVersion ? (
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            size='sm'
            disabled={updateSchedule.isPending}
            onClick={() => void handleSaveCorrection()}
          >
            {updateSchedule.isPending ? 'Saving…' : 'Save correction'}
          </Button>
          <Button type='button' size='sm' variant='outline' onClick={openNewVersionPanel}>
            New version
          </Button>
        </div>
      ) : null}

      {canEdit && showNewVersion && currentVersion ? (
        <div className='space-y-4 rounded-md border border-dashed p-4' data-testid='new-schedule-version'>
          <div className='space-y-2'>
            <Label htmlFor='schedule-new-effective-from'>Effective from</Label>
            <Input
              id='schedule-new-effective-from'
              type='date'
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </div>
          <ScheduleDaysTable days={newVersionDays} canEdit onChange={updateNewVersionDay} />
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              size='sm'
              disabled={createSchedule.isPending}
              onClick={() => void handleCreateVersion()}
            >
              {createSchedule.isPending ? 'Creating…' : 'Create version'}
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => setShowNewVersion(false)}
            >
              Hide new version
            </Button>
          </div>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className='space-y-2'>
          <p className='text-sm font-medium text-slate-700'>Previous versions</p>
          <ul className='space-y-1 text-sm text-slate-600'>
            {history.map((version) => (
              <li key={version.id}>From {version.effectiveFrom}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
