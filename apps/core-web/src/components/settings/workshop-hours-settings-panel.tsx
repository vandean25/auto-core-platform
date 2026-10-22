import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useAuthSession } from '@/api/auth-session'
import {
  type UpdateWorkshopSettingsPayload,
  type WorkshopHoliday,
  type WorkshopSettingsResponse,
  useDeleteWorkshopHoliday,
  useImportWorkshopHolidays,
  useUpdateWorkshopSettings,
  useWorkshopHolidays,
  useWorkshopSettings,
} from '@/api/workshop'
import { DataTable } from '@/components/data-table/DataTable'
import { WorkshopHolidayDialog } from '@/components/settings/WorkshopHolidayDialog'
import {
  buildWorkshopHolidayColumns,
  formatHolidayHours,
} from '@/components/settings/workshop-hours-holiday-columns'
import {
  commitSettingsTabMutation,
  SettingsSubmitRow,
  SettingsTabLoadingState,
  SettingsTabPanel,
} from '@/components/settings/settings-tab-shared'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { getErrorMessage } from '@/lib/error-utils'

type WeekdayNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7

const SLOT_MINUTES = [15, 30, 60] as const

const COMMON_TIMEZONES = [
  'Europe/Vienna',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
]

type OpeningHourFormRow = {
  weekday: number
  isClosed: boolean
  openTime: string
  closeTime: string
}

type SettingsFormState = {
  timezone: string
  slotMinutes: 15 | 30 | 60
  holidayCountryIso: string
  holidaySubdivisionCode: string
  openingHours: OpeningHourFormRow[]
}

function normalizeTimeValue(value: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value)
  return match ? `${match[1]}:${match[2]}` : value
}

function settingsToFormState(settings: WorkshopSettingsResponse): SettingsFormState {
  return {
    timezone: settings.timezone,
    slotMinutes: settings.slotMinutes,
    holidayCountryIso: settings.holidayCountryIso,
    holidaySubdivisionCode: settings.holidaySubdivisionCode ?? '',
    openingHours: settings.openingHours.map((hour) => ({
      weekday: hour.weekday,
      isClosed: hour.isClosed,
      openTime: normalizeTimeValue(hour.openTime),
      closeTime: normalizeTimeValue(hour.closeTime),
    })),
  }
}

function canManageWorkshopHours(activeRole?: string | null): boolean {
  return activeRole === 'OWNER' || activeRole === 'ADMIN'
}

export function WorkshopHoursSettingsPanel() {
  const { t } = useTranslation('settings')
  const sessionQuery = useAuthSession()
  const canManage = canManageWorkshopHours(sessionQuery.data?.activeRole)

  const {
    data: settings,
    isLoading: isLoadingSettings,
    isError: isSettingsError,
  } = useWorkshopSettings()
  const { data: holidaysResponse, isLoading: isLoadingHolidays } = useWorkshopHolidays()
  const updateSettingsMutation = useUpdateWorkshopSettings()
  const deleteHolidayMutation = useDeleteWorkshopHoliday()
  const importHolidaysMutation = useImportWorkshopHolidays()

  const [formState, setFormState] = React.useState<SettingsFormState | null>(null)
  const [holidayDialogOpen, setHolidayDialogOpen] = React.useState(false)
  const [editingHoliday, setEditingHoliday] = React.useState<WorkshopHoliday | null>(null)

  const { queryParams, setPagination, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })

  React.useEffect(() => {
    if (!settings || formState) return
    setFormState(settingsToFormState(settings))
  }, [formState, settings])

  const filteredHolidays = React.useMemo(() => {
    const holidays = holidaysResponse?.data ?? []
    const term = (queryParams.search ?? '').trim().toLowerCase()
    if (!term) return holidays
    return holidays.filter((holiday) =>
      [
        holiday.name,
        holiday.observedOn,
        holiday.source,
        holiday.repeatsAnnually ? t('workshopHours.holidays.yes') : t('workshopHours.holidays.no'),
        formatHolidayHours(holiday, t('workshopHours.holidays.closedLabel')),
      ].some((value) => value.toLowerCase().includes(term)),
    )
  }, [holidaysResponse?.data, queryParams.search, t])

  const closedLabel = t('workshopHours.holidays.closedLabel')

  const sortedHolidays = React.useMemo(() => {
    const field = queryParams.sortField
    if (!field) return filteredHolidays
    const direction = queryParams.sortDirection === 'desc' ? -1 : 1
    return [...filteredHolidays].sort((left, right) => {
      if (field === 'repeatsAnnually') {
        return direction * (Number(left.repeatsAnnually) - Number(right.repeatsAnnually))
      }
      const leftValue = String(
        field === 'hours' ? formatHolidayHours(left, closedLabel) : left[field as keyof WorkshopHoliday] ?? '',
      )
      const rightValue = String(
        field === 'hours' ? formatHolidayHours(right, closedLabel) : right[field as keyof WorkshopHoliday] ?? '',
      )
      return direction * leftValue.localeCompare(rightValue)
    })
  }, [closedLabel, filteredHolidays, queryParams.sortDirection, queryParams.sortField])

  const pageSize = queryParams.pageSize
  const pageCount = Math.max(1, Math.ceil(sortedHolidays.length / pageSize))
  const currentPage = Math.min(queryParams.page, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const pagedHolidays = sortedHolidays.slice(pageStart, pageStart + pageSize)

  React.useEffect(() => {
    if (queryParams.page <= pageCount) return
    setPagination((previous) => ({ ...previous, pageIndex: pageCount - 1 }))
  }, [pageCount, queryParams.page, setPagination])

  const updateOpeningHour = (
    weekday: number,
    patch: Partial<OpeningHourFormRow>,
  ) => {
    setFormState((previous) => {
      if (!previous) return previous
      return {
        ...previous,
        openingHours: previous.openingHours.map((row) =>
          row.weekday === weekday ? { ...row, ...patch } : row,
        ),
      }
    })
  }

  const handleSaveSettings = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!formState || !canManage) return

    for (const hour of formState.openingHours) {
      if (!hour.isClosed && hour.closeTime <= hour.openTime) {
        toast.error(
          t('workshopHours.toast.closeTimeInvalid', {
            day: t(`workshopHours.weekdays.${hour.weekday as WeekdayNumber}`),
          }),
        )
        return
      }
    }

    const payload: UpdateWorkshopSettingsPayload = {
      timezone: formState.timezone.trim(),
      slotMinutes: formState.slotMinutes,
      holidayCountryIso: formState.holidayCountryIso.trim().toUpperCase(),
      holidaySubdivisionCode: formState.holidaySubdivisionCode.trim() || null,
      openingHours: formState.openingHours.map((hour) => ({
        weekday: hour.weekday,
        isClosed: hour.isClosed,
        openTime: normalizeTimeValue(hour.openTime),
        closeTime: normalizeTimeValue(hour.closeTime),
      })),
    }

    await commitSettingsTabMutation({
      mutateAsync: updateSettingsMutation.mutateAsync,
      payload,
      onSaved: (saved) => setFormState(settingsToFormState(saved)),
      successMessage: t('workshopHours.toast.saved'),
      failureMessage: t('workshopHours.toast.saveFailed'),
    })
  }

  const handleImportHolidays = async () => {
    if (!canManage) return

    try {
      const result = await importHolidaysMutation.mutateAsync({})
      toast.success(
        t('workshopHours.toast.importSuccess', {
          imported: result.imported,
          skipped: result.skipped,
        }),
      )
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('workshopHours.toast.importFailed')))
    }
  }

  const handleDeleteHoliday = async (id: string) => {
    if (!canManage) return

    try {
      await deleteHolidayMutation.mutateAsync(id)
      toast.success(t('workshopHours.toast.holidayDeleted'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('workshopHours.toast.holidayDeleteFailed')))
    }
  }

  const openCreateHoliday = () => {
    setEditingHoliday(null)
    setHolidayDialogOpen(true)
  }

  const openEditHoliday = (holiday: WorkshopHoliday) => {
    setEditingHoliday(holiday)
    setHolidayDialogOpen(true)
  }

  const holidayColumns = React.useMemo(
    () => buildWorkshopHolidayColumns(t, closedLabel),
    [closedLabel, t],
  )

  if (isSettingsError) {
    return (
      <p className='text-sm text-destructive'>
        {t('workshopHours.loadFailed')}
      </p>
    )
  }

  if (isLoadingSettings || !formState) {
    return (
      <SettingsTabLoadingState />
    )
  }

  return (
    <div className='space-y-8'>
      <form onSubmit={handleSaveSettings} className='space-y-6'>
        <SettingsTabPanel title={t('workshopHours.title')} description={t('workshopHours.description')}>
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
            <div className='space-y-2'>
              <Label htmlFor='workshop-timezone'>{t('workshopHours.timezone')}</Label>
              <Input
                id='workshop-timezone'
                value={formState.timezone}
                disabled={!canManage}
                list='workshop-timezone-options'
                onChange={(event) => {
                  setFormState((previous) =>
                    previous ? { ...previous, timezone: event.target.value } : previous,
                  )
                }}
              />
              <datalist id='workshop-timezone-options'>
                {COMMON_TIMEZONES.map((timezone) => (
                  // eslint-disable-next-line jsx-a11y/control-has-associated-label -- datalist suggestions are named by their value
                  <option key={timezone} value={timezone} />
                ))}
              </datalist>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='workshop-slot-minutes'>{t('workshopHours.slotMinutes')}</Label>
              <Select
                value={String(formState.slotMinutes)}
                disabled={!canManage}
                onValueChange={(value) => {
                  setFormState((previous) =>
                    previous
                      ? { ...previous, slotMinutes: Number(value) as 15 | 30 | 60 }
                      : previous,
                  )
                }}
              >
                <SelectTrigger id='workshop-slot-minutes'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLOT_MINUTES.map((minutes) => (
                    <SelectItem key={minutes} value={String(minutes)}>
                      {t('workshopHours.slotMinutesOption', { minutes })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='workshop-country'>{t('workshopHours.holidayCountry')}</Label>
              <Input
                id='workshop-country'
                value={formState.holidayCountryIso}
                disabled={!canManage}
                maxLength={2}
                onChange={(event) => {
                  setFormState((previous) =>
                    previous
                      ? { ...previous, holidayCountryIso: event.target.value.toUpperCase() }
                      : previous,
                  )
                }}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='workshop-subdivision'>{t('workshopHours.subdivision')}</Label>
              <Input
                id='workshop-subdivision'
                value={formState.holidaySubdivisionCode}
                disabled={!canManage}
                placeholder={t('workshopHours.subdivisionPlaceholder')}
                onChange={(event) => {
                  setFormState((previous) =>
                    previous
                      ? { ...previous, holidaySubdivisionCode: event.target.value }
                      : previous,
                  )
                }}
              />
            </div>
          </div>

          <div className='space-y-3'>
            <h3 className='text-sm font-medium'>{t('workshopHours.weekdaysTitle')}</h3>
            <div className='space-y-2'>
              {formState.openingHours.map((hour) => (
                <div
                  key={hour.weekday}
                  className='grid gap-3 items-center md:grid-cols-[140px_120px_1fr_1fr] border rounded-md p-3'
                >
                  <span className='text-sm font-medium'>{t(`workshopHours.weekdays.${hour.weekday as WeekdayNumber}`)}</span>
                  <div className='flex items-center gap-2'>
                    <Checkbox
                      id={`weekday-closed-${hour.weekday}`}
                      checked={hour.isClosed}
                      disabled={!canManage}
                      onCheckedChange={(checked) => {
                        updateOpeningHour(hour.weekday, { isClosed: checked === true })
                      }}
                    />
                    <Label htmlFor={`weekday-closed-${hour.weekday}`}>{t('workshopHours.closed')}</Label>
                  </div>
                  <Input
                    type='time'
                    value={hour.openTime}
                    disabled={!canManage || hour.isClosed}
                    onChange={(event) => {
                      updateOpeningHour(hour.weekday, { openTime: event.target.value })
                    }}
                  />
                  <Input
                    type='time'
                    value={hour.closeTime}
                    disabled={!canManage || hour.isClosed}
                    onChange={(event) => {
                      updateOpeningHour(hour.weekday, { closeTime: event.target.value })
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {canManage ? (
            <SettingsSubmitRow
              pending={updateSettingsMutation.isPending}
              label={t('workshopHours.saveHours')}
            />
          ) : null}
        </SettingsTabPanel>
      </form>

      <SettingsTabPanel
        density="compact"
        title={t('workshopHours.holidays.title')}
        description={t('workshopHours.holidays.description')}
        headerActions={
          canManage ? (
            <div className='flex items-center gap-2'>
              <Button
                type='button'
                variant='outline'
                disabled={importHolidaysMutation.isPending}
                onClick={() => {
                  void handleImportHolidays()
                }}
              >
                {importHolidaysMutation.isPending
                  ? t('workshopHours.holidays.importing')
                  : t('workshopHours.holidays.import')}
              </Button>
              <Button type='button' onClick={openCreateHoliday}>
                {t('workshopHours.holidays.createButton')}
              </Button>
            </div>
          ) : null
        }
      >
        <DataTable
          columns={holidayColumns}
          data={pagedHolidays}
          pageCount={pageCount}
          isLoading={isLoadingHolidays}
          searchPlaceholder={t('workshopHours.holidays.searchPlaceholder')}
          setPagination={setPagination}
          rowBehaviour={{
            onRowClick: canManage ? openEditHoliday : undefined,
            getRowContextActions: canManage
              ? (row) => [
                  {
                    label: t('workshopHours.holidays.delete'),
                    destructive: true,
                    onClick: () => {
                      void handleDeleteHoliday(row.id)
                    },
                  },
                ]
              : undefined,
          }}
          {...tableState}
        />
      </SettingsTabPanel>

      <WorkshopHolidayDialog
        open={holidayDialogOpen}
        onOpenChange={setHolidayDialogOpen}
        holiday={editingHoliday}
      />
    </div>
  )
}
