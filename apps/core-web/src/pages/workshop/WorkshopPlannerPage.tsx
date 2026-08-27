import * as React from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Calendar, ChevronLeft, ChevronRight, Wrench } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  type PlannerGridResponse,
  useUpdateWorkshopOrder,
  useWorkshopPlanner,
  useWorkshopSettings,
  workshopKeys,
} from '@/api/workshop'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  buildSlots,
  getEffectiveHours,
} from '@/features/workshop/planner/planner-hours'
import {
  addLocalDays,
  eachLocalDateInRange,
  formatDateLabel,
  formatLocalDate,
  localDateRangeToUtc,
  startOfWeekMonday,
} from '@/features/workshop/planner/planner-time'
import { PlannerBookingBlock } from '@/components/workshop/planner/PlannerBookingBlock'
import {
  PlannerCreateSheet,
  type PlannerCreatePrefill,
} from '@/components/workshop/planner/PlannerCreateSheet'
import { PlannerDayGrid, parsePlannerSlotId } from '@/components/workshop/planner/PlannerDayGrid'
import { PlannerWeekGrid, parsePlannerWeekSlotId } from '@/components/workshop/planner/PlannerWeekGrid'
import { PlannerViewToggle, type PlannerViewMode } from '@/components/workshop/planner/PlannerViewToggle'
import { useNavigate } from 'react-router-dom'

const VIEW_MODE_KEY = 'workshop-planner-view'

function readViewMode(): PlannerViewMode {
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_KEY)
    if (stored === 'day' || stored === 'week') return stored
  } catch {
    // ignore
  }
  return 'day'
}

function ClosedStateCard({
  title,
  description,
  onGoToSettings,
}: {
  title: string
  description: string
  onGoToSettings: () => void
}) {
  return (
    <Card className="max-w-sm mx-auto my-6">
      <CardHeader className="items-center pb-2">
        <div className="rounded-full bg-slate-100 p-3 mb-2">
          <Calendar className="h-6 w-6 text-slate-400" />
        </div>
        <CardTitle className="text-base text-center">{title}</CardTitle>
        <CardDescription className="text-center">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pt-0">
        <Button variant="outline" size="sm" onClick={onGoToSettings}>
          Go to Settings
        </Button>
      </CardContent>
    </Card>
  )
}

function NoBaysCard({ onGoToSettings }: { onGoToSettings: () => void }) {
  return (
    <Card className="max-w-sm mx-auto mt-8">
      <CardHeader className="items-center pb-2">
        <div className="rounded-full bg-slate-100 p-3 mb-2">
          <Wrench className="h-6 w-6 text-slate-400" />
        </div>
        <CardTitle className="text-base text-center">No bays configured</CardTitle>
        <CardDescription className="text-center">
          Add bays in Settings to start scheduling workshop orders.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pt-0">
        <Button variant="outline" size="sm" onClick={onGoToSettings}>
          Go to Settings
        </Button>
      </CardContent>
    </Card>
  )
}

export default function WorkshopPlannerPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = React.useState<PlannerViewMode>(readViewMode)
  const { data: settings } = useWorkshopSettings()
  const defaultTimezone = settings?.timezone ?? 'Europe/Vienna'
  const [anchorDate, setAnchorDate] = React.useState(() =>
    formatLocalDate(new Date(), defaultTimezone),
  )

  React.useEffect(() => {
    if (settings?.timezone) {
      setAnchorDate(formatLocalDate(new Date(), settings.timezone))
    }
  }, [settings?.timezone])
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createPrefill, setCreatePrefill] = React.useState<PlannerCreatePrefill | null>(null)
  const [activeBookingId, setActiveBookingId] = React.useState<string | null>(null)

  const updateOrder = useUpdateWorkshopOrder()
  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor))

  React.useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, viewMode)
    } catch {
      // ignore
    }
  }, [viewMode])

  const timezone = settings?.timezone ?? 'Europe/Vienna'
  const weekStart = startOfWeekMonday(anchorDate)
  const rangeFromDate = viewMode === 'day' ? anchorDate : weekStart
  const rangeToDate =
    viewMode === 'day' ? addLocalDays(anchorDate, 1) : addLocalDays(weekStart, 7)
  const queryRange = localDateRangeToUtc(rangeFromDate, rangeToDate, timezone)

  const { data: plannerData, isLoading } = useWorkshopPlanner(queryRange.from, queryRange.to)
  const plannerTimezone = plannerData?.timezone ?? timezone
  const slotMinutes = plannerData?.slotMinutes ?? 30
  const bays = plannerData?.bays ?? []
  const openings = plannerData?.openings ?? []
  const holidays = plannerData?.holidays ?? []
  const bookings = plannerData?.bookings ?? []
  const employeesAway = plannerData?.employeesAway ?? []

  const subtitle =
    viewMode === 'day'
      ? formatDateLabel(anchorDate, plannerTimezone)
      : `${formatDateLabel(weekStart, plannerTimezone)} – ${formatDateLabel(
          addLocalDays(weekStart, 6),
          plannerTimezone,
        )}`

  const dayHours =
    viewMode === 'day'
      ? getEffectiveHours(anchorDate, openings, holidays)
      : null

  const weekDates = eachLocalDateInRange(weekStart, addLocalDays(weekStart, 7))

  const daySlots =
    viewMode === 'day' && dayHours
      ? buildSlots(dayHours, slotMinutes, plannerTimezone, anchorDate)
      : []

  const activeBooking = activeBookingId
    ? bookings.find((booking) => booking.orderId === activeBookingId)
    : null

  const openCreateSheet = (bayId: string, startIso: string, endIso?: string) => {
    const start = new Date(startIso)
    const end = endIso
      ? new Date(endIso)
      : new Date(start.getTime() + 60 * 60 * 1000)
    setCreatePrefill({
      bayId,
      scheduledStartAt: start.toISOString(),
      scheduledEndAt: end.toISOString(),
    })
    setCreateOpen(true)
  }

  const handleDaySlotClick = (bayId: string, startIso: string) => {
    openCreateSheet(bayId, startIso)
  }

  const handleWeekDayClick = (bayId: string, date: string, startIso: string) => {
    const hours = getEffectiveHours(date, openings, holidays)
    const end =
      hours.openTime && hours.closeTime && !hours.isClosed
        ? new Date(new Date(startIso).getTime() + 60 * 60 * 1000)
        : new Date(new Date(startIso).getTime() + 60 * 60 * 1000)
    openCreateSheet(bayId, startIso, end.toISOString())
  }

  const performReschedule = (
    orderId: string,
    bayId: string,
    startIso: string,
    durationMs: number,
    plannerKey: readonly unknown[],
  ) => {
    const start = new Date(startIso)
    const end = new Date(start.getTime() + durationMs)
    const previousData = queryClient.getQueryData<PlannerGridResponse>(plannerKey)

    queryClient.setQueryData<PlannerGridResponse>(plannerKey, (old) => {
      if (!old) return old
      return {
        ...old,
        bookings: old.bookings.map((booking) =>
          booking.orderId === orderId
            ? {
                ...booking,
                bayId,
                scheduledStartAt: start.toISOString(),
                scheduledEndAt: end.toISOString(),
              }
            : booking,
        ),
      }
    })

    updateOrder.mutate(
      {
        id: orderId,
        bayId,
        scheduledStartAt: start.toISOString(),
        scheduledEndAt: end.toISOString(),
      },
      {
        onError: (error) => {
          queryClient.setQueryData(plannerKey, previousData)
          const message =
            error instanceof Error ? error.message : 'Failed to reschedule workshop order'
          toast.error(message)
        },
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: workshopKeys.planner() })
        },
      },
    )
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveBookingId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveBookingId(null)
    const { active, over } = event
    if (!over) return

    const booking = bookings.find((row) => row.orderId === String(active.id))
    if (!booking || booking.status !== 'SCHEDULED') return

    const slot = parsePlannerSlotId(String(over.id))
    const weekSlot = parsePlannerWeekSlotId(String(over.id))
    const plannerKey = workshopKeys.planner(queryRange.from, queryRange.to)

    const durationMs =
      new Date(booking.scheduledEndAt).getTime() -
      new Date(booking.scheduledStartAt).getTime()

    if (slot) {
      performReschedule(booking.orderId, slot.bayId, slot.startIso, durationMs, plannerKey)
      return
    }

    if (weekSlot) {
      const hours = getEffectiveHours(weekSlot.date, openings, holidays)
      const dayWindow = buildSlots(hours, slotMinutes, plannerTimezone, weekSlot.date)[0]
      const startIso = dayWindow?.start.toISOString() ?? new Date(booking.scheduledStartAt).toISOString()
      performReschedule(booking.orderId, weekSlot.bayId, startIso, durationMs, plannerKey)
    }
  }

  const shiftAnchor = (days: number) => {
    setAnchorDate((current) => addLocalDays(current, days))
  }

  const showClosedDay =
    viewMode === 'day' &&
    dayHours &&
    dayHours.isClosed &&
    bays.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workshop Planner</h1>
          <p className="text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => shiftAnchor(viewMode === 'day' ? -1 : -7)}
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => shiftAnchor(viewMode === 'day' ? 1 : 7)}
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <PlannerViewToggle value={viewMode} onChange={setViewMode} />
          <Button
            onClick={() => {
              setCreatePrefill(null)
              setCreateOpen(true)
            }}
          >
            + Workshop Order
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : bays.length === 0 ? (
        <NoBaysCard onGoToSettings={() => navigate('/settings?tab=bays')} />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {showClosedDay && (
            <ClosedStateCard
              title={
                dayHours?.holidayName
                  ? `Closed — ${dayHours.holidayName}`
                  : 'Workshop closed'
              }
              description="Adjust opening hours or holidays in Settings."
              onGoToSettings={() => navigate('/settings?tab=hours')}
            />
          )}

          {viewMode === 'day' ? (
            <PlannerDayGrid
              bays={bays}
              date={anchorDate}
              timezone={plannerTimezone}
              slots={daySlots}
              hours={dayHours ?? { isClosed: true, openTime: null, closeTime: null }}
              bookings={bookings}
              onSlotClick={handleDaySlotClick}
            />
          ) : (
            <PlannerWeekGrid
              bays={bays}
              dates={weekDates}
              timezone={plannerTimezone}
              openings={openings}
              holidays={holidays}
              bookings={bookings}
              onDayClick={handleWeekDayClick}
            />
          )}

          <DragOverlay>
            {activeBooking && <PlannerBookingBlock booking={activeBooking} isDragging />}
          </DragOverlay>
        </DndContext>
      )}

      <PlannerCreateSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        prefill={createPrefill}
        bays={bays}
        timezone={plannerTimezone}
        openings={openings}
        holidays={holidays}
        bookings={bookings}
        employeesAway={employeesAway}
      />
    </div>
  )
}
