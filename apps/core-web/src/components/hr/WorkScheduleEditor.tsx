import { useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  useCreateWorkSchedule,
  useEmployeeWorkSchedule,
  useUpdateWorkSchedule,
} from '@/api/hr'
import { useMySites } from '@/api/sites'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/error-utils'
import { formatIsoDateOnly } from '@/lib/format'
import {
  buildDefaultDays,
  daysFromVersion,
  normalizeDaysForSubmit,
  type ScheduleDayFormState,
  validateDays,
  weekdayLabel,
  DEFAULT_NON_WORKING_DAY,
  DEFAULT_WORKING_DAY,
} from '@/components/hr/work-schedule-form'
import { ensureNamespaceLoaded } from '@/lib/i18n'

export type WorkScheduleEditorProps = {
  employeeId: string
  canEdit: boolean
  defaultEffectiveFrom?: string
}

function ScheduleDayRow({
  day,
  canEdit,
  onChange,
  t,
}: {
  day: ScheduleDayFormState
  canEdit: boolean
  onChange: (weekday: number, patch: Partial<ScheduleDayFormState>) => void
  t: TFunction<'hr'>
}) {
  const dayName = weekdayLabel(day.weekday)
  if (!canEdit) {
    return (
      <tr>
        <td className='px-3 py-2 text-sm'>{dayName}</td>
        <td className='px-3 py-2 text-sm'>{day.isWorking ? t('employees.yes') : t('employees.no')}</td>
        <td className='px-3 py-2 text-sm'>{day.startTime ?? t('employees.notSet')}</td>
        <td className='px-3 py-2 text-sm'>{day.endTime ?? t('employees.notSet')}</td>
        <td className='px-3 py-2 text-sm'>{day.breakMinutes}</td>
      </tr>
    )
  }

  return (
    <tr>
      <td className='px-3 py-2 text-sm'>{dayName}</td>
      <td className='px-3 py-2'>
        <input
          type='checkbox'
          aria-label={t('workSchedule.workingAria', { day: dayName })}
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
          aria-label={t('workSchedule.startAria', { day: dayName })}
          value={day.startTime ?? ''}
          disabled={!day.isWorking}
          onChange={(event) => onChange(day.weekday, { startTime: event.target.value })}
          className='h-8 w-[120px]'
        />
      </td>
      <td className='px-3 py-2'>
        <Input
          type='time'
          aria-label={t('workSchedule.endAria', { day: dayName })}
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
          aria-label={t('workSchedule.breakAria', { day: dayName })}
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
  t,
}: {
  days: ScheduleDayFormState[]
  canEdit: boolean
  onChange: (weekday: number, patch: Partial<ScheduleDayFormState>) => void
  t: TFunction<'hr'>
}) {
  return (
    <div className='overflow-hidden rounded-md border'>
      <table className='min-w-full divide-y divide-slate-200'>
        <thead className='bg-slate-50'>
          <tr>
            <th className='px-3 py-2 text-left text-xs font-medium uppercase text-slate-500'>{t('workSchedule.table.day')}</th>
            <th className='px-3 py-2 text-left text-xs font-medium uppercase text-slate-500'>{t('workSchedule.table.working')}</th>
            <th className='px-3 py-2 text-left text-xs font-medium uppercase text-slate-500'>{t('workSchedule.table.start')}</th>
            <th className='px-3 py-2 text-left text-xs font-medium uppercase text-slate-500'>{t('workSchedule.table.end')}</th>
            <th className='px-3 py-2 text-left text-xs font-medium uppercase text-slate-500'>{t('workSchedule.table.breakMin')}</th>
          </tr>
        </thead>
        <tbody className='divide-y divide-slate-200 bg-white'>
          {days.map((day) => (
            <ScheduleDayRow key={day.weekday} day={day} canEdit={canEdit} onChange={onChange} t={t} />
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
  const { t } = useTranslation('hr')
  useEffect(() => {
    void ensureNamespaceLoaded('hr')
  }, [])

  const scheduleQuery = useEmployeeWorkSchedule(employeeId)
  const createSchedule = useCreateWorkSchedule(employeeId)
  const updateSchedule = useUpdateWorkSchedule(employeeId)
  const sitesQuery = useMySites(canEdit)
  const currentVersion = scheduleQuery.data?.current
  const currentVersionId = currentVersion?.id
  const [correctionDays, setCorrectionDays] = useState<ScheduleDayFormState[]>(buildDefaultDays())
  const [newVersionDays, setNewVersionDays] = useState<ScheduleDayFormState[]>(buildDefaultDays())
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [showNewVersion, setShowNewVersion] = useState(false)
  const [siteId, setSiteId] = useState('')
  const [newVersionSiteId, setNewVersionSiteId] = useState('')

  useEffect(() => {
    if (!siteId && !currentVersion && sitesQuery.data?.[0]) setSiteId(sitesQuery.data[0].id)
  }, [siteId, currentVersion, sitesQuery.data])

  useEffect(() => {
    if (!currentVersionId) {
      setCorrectionDays(buildDefaultDays())
      setNewVersionDays(buildDefaultDays())
      return
    }

    const version = scheduleQuery.data?.current
    if (!version || version.id !== currentVersionId) {
      return
    }

    const mappedDays = daysFromVersion(version.days)
    setCorrectionDays(mappedDays)
    setNewVersionDays(mappedDays)
    setSiteId(version.siteId ?? '')
    setNewVersionSiteId(version.siteId ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when employee/version identity changes
  }, [employeeId, currentVersionId])

  useEffect(() => {
    if (!currentVersionId && defaultEffectiveFrom) {
      setEffectiveFrom(defaultEffectiveFrom)
      return
    }
    if (currentVersionId) {
      setEffectiveFrom('')
    }
  }, [currentVersionId, defaultEffectiveFrom])

  useEffect(() => {
    if (!canEdit || currentVersionId) {
      return
    }
    setShowNewVersion(true)
  }, [canEdit, currentVersionId])

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
    setNewVersionSiteId(siteId)
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
        data: { days: normalizeDaysForSubmit(correctionDays), siteId: siteId || undefined },
      })
      toast.success(t('workSchedule.toast.updated'))
    } catch (error) {
      toast.error(getErrorMessage(error, t('workSchedule.toast.updateFailed')))
    }
  }

  const handleCreateVersion = async () => {
    const versionSiteId = currentVersion ? newVersionSiteId : siteId
    const validationError = validateDays(newVersionDays)
    if (validationError) {
      toast.error(validationError)
      return
    }

    if (!effectiveFrom) {
      toast.error(t('workSchedule.toast.effectiveDateRequired'))
      return
    }
    if (!versionSiteId) {
      toast.error(t('workSchedule.toast.siteRequired'))
      return
    }

    try {
      await createSchedule.mutateAsync({
        effectiveFrom,
        siteId: versionSiteId,
        days: normalizeDaysForSubmit(newVersionDays),
      })
      toast.success(t('workSchedule.toast.versionCreated'))
      if (currentVersion) {
        setShowNewVersion(false)
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t('workSchedule.toast.createFailed')))
    }
  }

  if (scheduleQuery.isLoading) {
    return <p className='text-sm text-slate-500'>{t('workSchedule.loading')}</p>
  }

  if (scheduleQuery.error) {
    return (
      <p className='text-sm text-red-600'>
        {getErrorMessage(scheduleQuery.error, t('workSchedule.loadFailed'))}
      </p>
    )
  }

  const creatingFirstVersion = canEdit && !currentVersion

  return (
    <section className='space-y-4' data-testid='work-schedule-editor'>
      <div className='space-y-1'>
        <h4 className='text-sm font-semibold text-slate-900'>{t('workSchedule.title')}</h4>
        <p className='text-sm text-slate-500'>{t('workSchedule.description')}</p>
        {currentVersion ? (
          <p className='text-xs text-slate-500'>
            {t('workSchedule.currentFrom', { date: formatIsoDateOnly(currentVersion.effectiveFrom) })}
          </p>
        ) : (
          <p className='text-xs text-slate-500'>{t('workSchedule.noVersion')}</p>
        )}
      </div>

      {currentVersion ? (
        <>
        {canEdit ? <div className='space-y-2'>
          <Label htmlFor='schedule-site'>{t('workSchedule.siteAssignment')}</Label>
          <select id='schedule-site' aria-label={t('workSchedule.siteAssignment')} value={siteId} onChange={(event) => setSiteId(event.target.value)} className='h-10 rounded-md border px-3 text-base md:text-sm'>
            <option value=''>{t('workSchedule.selectSite')}</option>
            {(sitesQuery.data ?? []).map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </div> : (
          <p className='text-sm text-slate-500'>
            {t('workSchedule.siteLabel', {
              name:
                sitesQuery.data?.find((site) => site.id === currentVersion.siteId)?.name ??
                t('workSchedule.notAssigned'),
            })}
          </p>
        )}
        <ScheduleDaysTable
          t={t}
          days={correctionDays}
          canEdit={canEdit}
          onChange={updateCorrectionDay}
        />
        </>
      ) : creatingFirstVersion ? (
        <div className='space-y-4' data-testid='first-schedule-version'>
          <div className='space-y-2'>
            <Label htmlFor='schedule-site'>{t('workSchedule.siteAssignment')}</Label>
            <select id='schedule-site' aria-label={t('workSchedule.siteAssignment')} value={siteId} onChange={(event) => setSiteId(event.target.value)} className='h-10 rounded-md border px-3 text-base md:text-sm'>
              <option value=''>{t('workSchedule.selectSite')}</option>
              {(sitesQuery.data ?? []).map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='schedule-effective-from'>{t('workSchedule.effectiveFrom')}</Label>
            <Input
              id='schedule-effective-from'
              type='date'
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </div>
          <ScheduleDaysTable t={t} days={newVersionDays} canEdit onChange={updateNewVersionDay} />
          <Button
            type='button'
            size='sm'
            disabled={createSchedule.isPending}
            onClick={() => void handleCreateVersion()}
          >
            {createSchedule.isPending ? t('workSchedule.creating') : t('workSchedule.createVersion')}
          </Button>
        </div>
      ) : (
        <ScheduleDaysTable t={t} days={buildDefaultDays()} canEdit={false} onChange={() => undefined} />
      )}

      {canEdit && currentVersion ? (
        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            size='sm'
            disabled={updateSchedule.isPending}
            onClick={() => void handleSaveCorrection()}
          >
            {updateSchedule.isPending ? t('workSchedule.saving') : t('workSchedule.saveCorrection')}
          </Button>
          <Button type='button' size='sm' variant='outline' onClick={openNewVersionPanel}>
            {t('workSchedule.newVersion')}
          </Button>
        </div>
      ) : null}

      {canEdit && showNewVersion && currentVersion ? (
        <div className='space-y-4 rounded-md border border-dashed p-4' data-testid='new-schedule-version'>
          <div className='space-y-2'>
            <Label htmlFor='schedule-new-version-site'>{t('workSchedule.newVersionSite')}</Label>
            <select id='schedule-new-version-site' aria-label={t('workSchedule.newVersionSiteAria')} value={newVersionSiteId} onChange={(event) => setNewVersionSiteId(event.target.value)} className='h-10 rounded-md border px-3 text-base md:text-sm'>
              <option value=''>{t('workSchedule.selectSite')}</option>
              {(sitesQuery.data ?? []).map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='schedule-new-effective-from'>{t('workSchedule.effectiveFrom')}</Label>
            <Input
              id='schedule-new-effective-from'
              type='date'
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </div>
          <ScheduleDaysTable t={t} days={newVersionDays} canEdit onChange={updateNewVersionDay} />
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              size='sm'
              disabled={createSchedule.isPending}
              onClick={() => void handleCreateVersion()}
            >
              {createSchedule.isPending ? t('workSchedule.creating') : t('workSchedule.createVersion')}
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => setShowNewVersion(false)}
            >
              {t('workSchedule.hideNewVersion')}
            </Button>
          </div>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className='space-y-2'>
          <p className='text-sm font-medium text-slate-700'>{t('workSchedule.previousVersions')}</p>
          <ul className='space-y-1 text-sm text-slate-600'>
            {history.map((version) => (
              <li key={version.id}>{t('workSchedule.fromDate', { date: formatIsoDateOnly(version.effectiveFrom) })}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
