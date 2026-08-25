import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Loader2, Save } from 'lucide-react'
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
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { WorkshopHolidayDialog } from '@/components/settings/WorkshopHolidayDialog'
import { Badge } from '@/components/ui/badge'
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

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
}

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

function settingsToFormState(settings: WorkshopSettingsResponse): SettingsFormState {
  return {
    timezone: settings.timezone,
    slotMinutes: settings.slotMinutes,
    holidayCountryIso: settings.holidayCountryIso,
    holidaySubdivisionCode: settings.holidaySubdivisionCode ?? '',
    openingHours: settings.openingHours.map((hour) => ({
      weekday: hour.weekday,
      isClosed: hour.isClosed,
      openTime: hour.openTime,
      closeTime: hour.closeTime,
    })),
  }
}

function formatHolidayHours(holiday: WorkshopHoliday): string {
  if (holiday.isClosed) return 'Closed'
  if (holiday.openTime && holiday.closeTime) {
    return `${holiday.openTime} – ${holiday.closeTime}`
  }
  return '—'
}

function canManageWorkshopHours(activeRole?: string | null): boolean {
  return activeRole === 'OWNER' || activeRole === 'ADMIN'
}

export function WorkshopHoursSettingsTab() {
  const sessionQuery = useAuthSession()
  const canManage = canManageWorkshopHours(sessionQuery.data?.activeRole)

  const { data: settings, isLoading: isLoadingSettings } = useWorkshopSettings()
  const { data: holidaysResponse, isLoading: isLoadingHolidays } = useWorkshopHolidays()
  const updateSettingsMutation = useUpdateWorkshopSettings()
  const deleteHolidayMutation = useDeleteWorkshopHoliday()
  const importHolidaysMutation = useImportWorkshopHolidays()

  const [formState, setFormState] = React.useState<SettingsFormState | null>(null)
  const [holidayDialogOpen, setHolidayDialogOpen] = React.useState(false)
  const [editingHoliday, setEditingHoliday] = React.useState<WorkshopHoliday | null>(null)

  const { queryParams, setPagination, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })

  React.useEffect(() => {
    if (settings) {
      setFormState(settingsToFormState(settings))
    }
  }, [settings])

  const holidays = holidaysResponse?.data ?? []

  const filteredHolidays = React.useMemo(() => {
    const term = (queryParams.search ?? '').trim().toLowerCase()
    if (!term) return holidays
    return holidays.filter((holiday) =>
      [
        holiday.name,
        holiday.observedOn,
        holiday.source,
        holiday.repeatsAnnually ? 'annual' : 'one-off',
        formatHolidayHours(holiday),
      ].some((value) => value.toLowerCase().includes(term)),
    )
  }, [holidays, queryParams.search])

  const pageSize = queryParams.pageSize
  const pageCount = Math.max(1, Math.ceil(filteredHolidays.length / pageSize))
  const currentPage = Math.min(queryParams.page, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const pagedHolidays = filteredHolidays.slice(pageStart, pageStart + pageSize)

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
        toast.error(`${WEEKDAY_LABELS[hour.weekday]} close time must be after open time`)
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
        openTime: hour.openTime,
        closeTime: hour.closeTime,
      })),
    }

    try {
      await updateSettingsMutation.mutateAsync(payload)
      toast.success('Workshop hours saved')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to save workshop hours'))
    }
  }

  const handleImportHolidays = async () => {
    if (!canManage) return

    try {
      const result = await importHolidaysMutation.mutateAsync({})
      toast.success(
        `Imported ${result.imported} public holidays (${result.skipped} skipped)`,
      )
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to import public holidays'))
    }
  }

  const handleDeleteHoliday = async (id: string) => {
    if (!canManage) return

    try {
      await deleteHolidayMutation.mutateAsync(id)
      toast.success('Holiday deleted')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to delete holiday'))
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

  const holidayColumns = React.useMemo<ColumnDef<WorkshopHoliday>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Name' />,
        cell: ({ row }) => row.original.name,
      },
      {
        accessorKey: 'observedOn',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Date' />,
        cell: ({ row }) => row.original.observedOn,
      },
      {
        accessorKey: 'repeatsAnnually',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Annual' />,
        cell: ({ row }) => (row.original.repeatsAnnually ? 'Yes' : 'No'),
      },
      {
        id: 'hours',
        header: 'Hours',
        cell: ({ row }) => formatHolidayHours(row.original),
      },
      {
        accessorKey: 'source',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Source' />,
        cell: ({ row }) => (
          <Badge variant='outline'>{row.original.source}</Badge>
        ),
      },
    ],
    [],
  )

  if (isLoadingSettings || !formState) {
    return (
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='h-6 w-6 animate-spin text-muted-foreground' />
      </div>
    )
  }

  return (
    <div className='space-y-8'>
      <form onSubmit={handleSaveSettings} className='space-y-6'>
        <div className='p-6 bg-white border rounded-lg shadow-sm space-y-6'>
          <div>
            <h3 className='text-lg font-medium'>Workshop hours</h3>
            <p className='text-sm text-muted-foreground'>
              Opening hours and holidays drive the Workshop Planner grid. Slot size sets the day-view column width.
            </p>
          </div>

          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
            <div className='space-y-2'>
              <Label htmlFor='workshop-timezone'>Timezone</Label>
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
                  <option key={timezone} value={timezone} />
                ))}
              </datalist>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='workshop-slot-minutes'>Slot size (minutes)</Label>
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
                      {minutes} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='workshop-country'>Holiday country (ISO)</Label>
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
              <Label htmlFor='workshop-subdivision'>Subdivision code (optional)</Label>
              <Input
                id='workshop-subdivision'
                value={formState.holidaySubdivisionCode}
                disabled={!canManage}
                placeholder='DE-BY'
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
            <h4 className='text-sm font-medium'>Weekdays</h4>
            <div className='space-y-2'>
              {formState.openingHours.map((hour) => (
                <div
                  key={hour.weekday}
                  className='grid gap-3 items-center md:grid-cols-[140px_120px_1fr_1fr] border rounded-md p-3'
                >
                  <span className='text-sm font-medium'>{WEEKDAY_LABELS[hour.weekday]}</span>
                  <div className='flex items-center gap-2'>
                    <Checkbox
                      id={`weekday-closed-${hour.weekday}`}
                      checked={hour.isClosed}
                      disabled={!canManage}
                      onCheckedChange={(checked) => {
                        updateOpeningHour(hour.weekday, { isClosed: checked === true })
                      }}
                    />
                    <Label htmlFor={`weekday-closed-${hour.weekday}`}>Closed</Label>
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
            <div className='flex justify-end'>
              <Button type='submit' disabled={updateSettingsMutation.isPending}>
                {updateSettingsMutation.isPending ? (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                ) : (
                  <Save className='mr-2 h-4 w-4' />
                )}
                Save hours
              </Button>
            </div>
          ) : null}
        </div>
      </form>

      <div className='p-6 bg-white border rounded-lg shadow-sm space-y-4'>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <h3 className='text-lg font-medium'>Holidays</h3>
            <p className='text-sm text-muted-foreground'>
              Closed or short days override weekday hours on the planner. Public holidays from OpenHolidays API.
            </p>
          </div>
          {canManage ? (
            <div className='flex items-center gap-2'>
              <Button
                type='button'
                variant='outline'
                disabled={importHolidaysMutation.isPending}
                onClick={() => {
                  void handleImportHolidays()
                }}
              >
                {importHolidaysMutation.isPending ? 'Importing...' : 'Import public holidays'}
              </Button>
              <Button type='button' onClick={openCreateHoliday}>+ Holiday</Button>
            </div>
          ) : null}
        </div>

        <DataTable
          columns={holidayColumns}
          data={pagedHolidays}
          pageCount={pageCount}
          isLoading={isLoadingHolidays}
          searchPlaceholder='Search holidays...'
          setPagination={setPagination}
          onRowClick={canManage ? openEditHoliday : undefined}
          getRowContextActions={
            canManage
              ? (row) => [
                  {
                    label: 'Delete',
                    destructive: true,
                    onClick: () => {
                      void handleDeleteHoliday(row.id)
                    },
                  },
                ]
              : undefined
          }
          {...tableState}
        />
      </div>

      <WorkshopHolidayDialog
        open={holidayDialogOpen}
        onOpenChange={setHolidayDialogOpen}
        holiday={editingHoliday}
      />
    </div>
  )
}
