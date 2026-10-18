import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { Customer, Vehicle, WorkshopSearchResponse } from '@/api/types'
import {
  type PlannerBooking,
  useCreateWorkshopOrder,
  useWorkshopResources,
  useWorkshopSearch,
} from '@/api/workshop'
import { MechanicAwayAlert } from '@/components/hr/MechanicAwayAlert'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  getEffectiveHours,
  intervalsOverlap,
  isOutsideEffectiveHours,
} from '@/features/workshop/planner/planner-hours'
import { formatLocalDate } from '@/features/workshop/planner/planner-time'
import { formatIsoDateTimeInZone, zonedWallClockToUtc } from '@/lib/format'
import type { components } from '@/api/generated/openapi'

type WorkshopOpeningHour = components['schemas']['WorkshopOpeningHourDto']
type PlannerHoliday = components['schemas']['PlannerHolidayDto']
type PlannerEmployeeAway = components['schemas']['PlannerEmployeeAwayDto']

type ExistingVehicle = Vehicle & { customer: Customer | null }

export type PlannerCreatePrefill = {
  bayId: string
  scheduledStartAt: string
  scheduledEndAt: string
}

type PlannerCreateSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  prefill: PlannerCreatePrefill | null
  bays: Array<{ id: string; name: string }>
  timezone: string
  openings: WorkshopOpeningHour[]
  holidays: PlannerHoliday[]
  bookings: PlannerBooking[]
  employeesAway: PlannerEmployeeAway[]
}

export function PlannerCreateSheet({
  open,
  onOpenChange,
  prefill,
  bays,
  timezone,
  openings,
  holidays,
  bookings,
  employeesAway,
}: PlannerCreateSheetProps) {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()
  const createOrder = useCreateWorkshopOrder()
  const { data: resources } = useWorkshopResources()

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedVehicle, setSelectedVehicle] = useState<ExistingVehicle | null>(null)
  const [bayId, setBayId] = useState('')
  const [mechanicId, setMechanicId] = useState<string | null>(null)
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [reportedIssue, setReportedIssue] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!open || !prefill) return
    setBayId(prefill.bayId)
    setStartAt(prefill.scheduledStartAt)
    setEndAt(prefill.scheduledEndAt)
  }, [open, prefill])

  const resetState = () => {
    setSearch('')
    setDebouncedSearch('')
    setSelectedVehicle(null)
    setBayId('')
    setMechanicId(null)
    setStartAt('')
    setEndAt('')
    setReportedIssue('')
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resetState()
    onOpenChange(nextOpen)
  }

  const { data: searchData, isLoading: searchLoading } = useWorkshopSearch(debouncedSearch)
  const vehicles =
    (searchData as WorkshopSearchResponse | undefined)?.data?.vehicles ?? []

  const startDate = startAt ? formatLocalDate(new Date(startAt), timezone) : null
  const effectiveHours = startDate
    ? getEffectiveHours(startDate, openings, holidays)
    : null

  const selectedMechanicAway = useMemo(() => {
    if (!mechanicId || !startDate) return null
    return employeesAway.find(
      (away) =>
        away.employeeId === mechanicId &&
        away.startOn <= startDate &&
        away.endOn >= startDate,
    )
  }, [employeesAway, mechanicId, startDate])

  const bayCollision = useMemo(() => {
    if (!bayId || !startAt || !endAt) return null
    const start = new Date(startAt)
    const end = new Date(endAt)
    const hit = bookings.find(
      (booking) =>
        booking.bayId === bayId &&
        intervalsOverlap(
          start,
          end,
          new Date(booking.scheduledStartAt),
          new Date(booking.scheduledEndAt),
        ),
    )
    return hit?.orderNumber ?? null
  }, [bayId, startAt, endAt, bookings])

  const mechanicOverlap = useMemo(() => {
    if (!mechanicId || !startAt || !endAt) return null
    const start = new Date(startAt)
    const end = new Date(endAt)
    const hit = bookings.find(
      (booking) =>
        booking.mechanicId === mechanicId &&
        intervalsOverlap(
          start,
          end,
          new Date(booking.scheduledStartAt),
          new Date(booking.scheduledEndAt),
        ),
    )
    return hit?.orderNumber ?? null
  }, [mechanicId, startAt, endAt, bookings])

  const outsideHours =
    startAt &&
    endAt &&
    startDate &&
    effectiveHours &&
    isOutsideEffectiveHours(
      new Date(startAt),
      new Date(endAt),
      effectiveHours,
      timezone,
      startDate,
    )

  const canSubmit =
    !!selectedVehicle?.customer?.id &&
    !!bayId &&
    !!startAt &&
    !!endAt &&
    new Date(endAt) > new Date(startAt) &&
    !bayCollision &&
    !createOrder.isPending

  async function handleCreate() {
    if (!selectedVehicle?.customer?.id) {
      toast.error(t('planner.createSheet.toastSelectVehicle'))
      return
    }

    try {
      const order = await createOrder.mutateAsync({
        customerId: selectedVehicle.customer.id,
        vehicleId: selectedVehicle.id,
        status: 'SCHEDULED',
        bayId,
        mechanicId,
        scheduledStartAt: startAt,
        scheduledEndAt: endAt,
        reportedIssue: reportedIssue || undefined,
      })
      toast.success(t('planner.createSheet.toastScheduled'))
      handleOpenChange(false)
      navigate(`/workshop/orders/${order.id}`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('planner.createSheet.toastCreateFailed')
      toast.error(message)
    }
  }

  const mechanics = resources?.mechanics ?? []

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <SheetTitle>{t('planner.createSheet.title')}</SheetTitle>
            <SheetDescription>{t('planner.createSheet.description')}</SheetDescription>
          </div>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            {t('planner.createSheet.createButton')}
          </Button>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="planner-search">{t('planner.createSheet.searchLabel')}</Label>
            <Input
              id="planner-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('planner.createSheet.searchPlaceholder')}
            />
            {searchLoading && <p className="text-xs text-slate-500">{t('planner.createSheet.searching')}</p>}
            {vehicles.length > 0 && (
              <ul className="rounded-md border border-slate-200 divide-y max-h-40 overflow-y-auto">
                {vehicles.map((vehicle) => (
                  <li key={vehicle.id}>
                    <button
                      type="button"
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                        selectedVehicle?.id === vehicle.id ? 'bg-slate-100' : ''
                      }`}
                      onClick={() => setSelectedVehicle(vehicle as ExistingVehicle)}
                    >
                      <span className="font-medium">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </span>
                      {vehicle.plate && (
                        <span className="text-slate-500"> · {vehicle.plate}</span>
                      )}
                      {vehicle.customer && (
                        <span className="block text-xs text-slate-500">
                          {vehicle.customer.first_name} {vehicle.customer.last_name}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t('planner.createSheet.bay')}</Label>
              <Select value={bayId} onValueChange={setBayId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('planner.createSheet.selectBay')} />
                </SelectTrigger>
                <SelectContent>
                  {bays.map((bay) => (
                    <SelectItem key={bay.id} value={bay.id}>{bay.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('planner.createSheet.mechanicOptional')}</Label>
              <Select
                value={mechanicId ?? 'none'}
                onValueChange={(value) => setMechanicId(value === 'none' ? null : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('planner.createSheet.unassigned')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('planner.createSheet.unassigned')}</SelectItem>
                  {mechanics.map((mechanic) => (
                    <SelectItem key={mechanic.id} value={mechanic.id}>
                      {mechanic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="planner-start">{t('planner.createSheet.start')}</Label>
              <Input
                id="planner-start"
                type="datetime-local"
                value={toLocalInputValue(startAt, timezone)}
                onChange={(event) =>
                  setStartAt(fromLocalInputValue(event.target.value, timezone))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="planner-end">{t('planner.createSheet.end')}</Label>
              <Input
                id="planner-end"
                type="datetime-local"
                value={toLocalInputValue(endAt, timezone)}
                onChange={(event) =>
                  setEndAt(fromLocalInputValue(event.target.value, timezone))
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="planner-issue">{t('planner.createSheet.reportedIssue')}</Label>
            <Input
              id="planner-issue"
              value={reportedIssue}
              onChange={(event) => setReportedIssue(event.target.value)}
              placeholder={t('planner.createSheet.optional')}
            />
          </div>

          {outsideHours && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTitle>{t('planner.createSheet.outsideHoursTitle')}</AlertTitle>
              <AlertDescription>{t('planner.createSheet.outsideHoursDescription')}</AlertDescription>
            </Alert>
          )}

          <MechanicAwayAlert
            employeeAway={selectedMechanicAway}
            mechanicName={mechanics.find((m) => m.id === mechanicId)?.name}
          />

          {mechanicOverlap && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTitle>{t('planner.createSheet.mechanicDoubleBookedTitle')}</AlertTitle>
              <AlertDescription>
                {t('planner.createSheet.mechanicDoubleBookedDescription', {
                  orderNumber: mechanicOverlap,
                })}
              </AlertDescription>
            </Alert>
          )}

          {bayCollision && (
            <Alert variant="destructive">
              <AlertTitle>{t('planner.createSheet.bayOccupiedTitle')}</AlertTitle>
              <AlertDescription>
                {t('planner.createSheet.bayOccupiedDescription', { orderNumber: bayCollision })}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function toLocalInputValue(iso: string, timeZone: string): string {
  if (!iso) return ''
  const formatted = formatIsoDateTimeInZone(iso, timeZone)
  if (!formatted) return ''
  const [datePart, timePart] = formatted.split(' ')
  return `${datePart}T${timePart.slice(0, 5)}`
}

function fromLocalInputValue(value: string, timeZone: string): string {
  if (!value) return ''
  const [datePart, timePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  return zonedWallClockToUtc(timeZone, year, month, day, hour, minute).toISOString()
}
