import { useEffect, useMemo, useState } from 'react'
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
      toast.error('Select a vehicle linked to a customer.')
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
      toast.success('Workshop order scheduled.')
      handleOpenChange(false)
      navigate(`/workshop/orders/${order.id}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create workshop order'
      toast.error(message)
    }
  }

  const mechanics = resources?.mechanics ?? []

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <SheetTitle>Schedule workshop order</SheetTitle>
            <SheetDescription>
              Search for a customer vehicle and book a bay slot.
            </SheetDescription>
          </div>
          <Button onClick={handleCreate} disabled={!canSubmit}>
            + Workshop Order
          </Button>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="planner-search">Search vehicle or customer</Label>
            <Input
              id="planner-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="VIN, plate, or customer name"
            />
            {searchLoading && <p className="text-xs text-slate-500">Searching…</p>}
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
              <Label>Bay</Label>
              <Select value={bayId} onValueChange={setBayId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select bay" />
                </SelectTrigger>
                <SelectContent>
                  {bays.map((bay) => (
                    <SelectItem key={bay.id} value={bay.id}>{bay.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Mechanic (optional)</Label>
              <Select
                value={mechanicId ?? 'none'}
                onValueChange={(value) => setMechanicId(value === 'none' ? null : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
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
              <Label htmlFor="planner-start">Start</Label>
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
              <Label htmlFor="planner-end">End</Label>
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
            <Label htmlFor="planner-issue">Reported issue</Label>
            <Input
              id="planner-issue"
              value={reportedIssue}
              onChange={(event) => setReportedIssue(event.target.value)}
              placeholder="Optional"
            />
          </div>

          {outsideHours && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTitle>Outside workshop hours</AlertTitle>
              <AlertDescription>
                This slot is outside effective opening hours. Booking is still allowed.
              </AlertDescription>
            </Alert>
          )}

          <MechanicAwayAlert
            employeeAway={selectedMechanicAway}
            mechanicName={mechanics.find((m) => m.id === mechanicId)?.name}
          />

          {mechanicOverlap && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTitle>Mechanic double-booked</AlertTitle>
              <AlertDescription>
                This mechanic already has {mechanicOverlap} in this window. You can still schedule.
              </AlertDescription>
            </Alert>
          )}

          {bayCollision && (
            <Alert variant="destructive">
              <AlertTitle>Bay occupied</AlertTitle>
              <AlertDescription>
                This bay overlaps with {bayCollision}. Choose another slot.
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
  const date = new Date(iso)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function fromLocalInputValue(value: string, timeZone: string): string {
  if (!value) return ''
  const [datePart, timePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const offsetMs = localOffsetMs(new Date(utcGuess), timeZone)
  return new Date(utcGuess - offsetMs).toISOString()
}

function localOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - date.getTime()
}
