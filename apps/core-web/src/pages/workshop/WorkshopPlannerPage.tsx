import { DndContext, DragOverlay } from '@dnd-kit/core'
import { Calendar, ChevronLeft, ChevronRight, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PlannerBooking } from '@/api/workshop'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PlannerBookingBlock } from '@/components/workshop/planner/PlannerBookingBlock'
import { PlannerPendingMovesContext } from '@/components/workshop/planner/planner-pending-moves'
import { PlannerCreateSheet } from '@/components/workshop/planner/PlannerCreateSheet'
import { PlannerEmptyState } from '@/components/workshop/planner/PlannerEmptyState'
import { PlannerModeGrid } from '@/components/workshop/planner/PlannerModeGrid'
import { PlannerViewToggle, type PlannerViewMode } from '@/components/workshop/planner/PlannerViewToggle'
import { PlannerCreateUrlOpener } from '@/components/workshop/planner/PlannerCreateUrlOpener'
import type { EffectiveHours, PlannerSlot } from '@/features/workshop/planner/planner-hours'
import type { usePlannerCreateSheet } from './hooks/usePlannerCreateSheet'
import type { usePlannerDragAndDrop } from './hooks/usePlannerDragAndDrop'
import { useWorkshopPlannerPage } from './hooks/useWorkshopPlannerPage'
import type { TFunction } from 'i18next'
import type { NavigateFunction } from 'react-router-dom'
import type { components } from '@/api/generated/openapi'

type WorkshopOpeningHour = components['schemas']['WorkshopOpeningHourDto']
type PlannerHoliday = components['schemas']['PlannerHolidayDto']

function PlannerGoToSettingsButton({ onGoToSettings }: { onGoToSettings: () => void }) {
  const { t } = useTranslation('workshop')
  return (
    <Button variant="outline" size="sm" className="max-md:min-h-11" onClick={onGoToSettings}>
      {t('planner.page.goToSettings')}
    </Button>
  )
}

type WorkshopPlannerPageViewProps = {
  t: TFunction<'workshop'>
  navigate: NavigateFunction
  viewMode: PlannerViewMode
  setViewMode: (mode: PlannerViewMode) => void
  anchorDate: string
  shiftAnchor: (days: number) => void
  pendingMoves: ReadonlySet<string>
  isLoading: boolean
  bays: Array<{ id: string; name: string }>
  openings: WorkshopOpeningHour[]
  holidays: PlannerHoliday[]
  bookings: PlannerBooking[]
  employeesAway: components['schemas']['PlannerEmployeeAwayDto'][]
  plannerTimezone: string
  subtitle: string
  weekDates: string[]
  daySlots: PlannerSlot[]
  dayHours: EffectiveHours | null
  showClosedDay: boolean
  createSheet: ReturnType<typeof usePlannerCreateSheet>
  drag: ReturnType<typeof usePlannerDragAndDrop>
}

function WorkshopPlannerPageSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

function WorkshopPlannerPageContent(props: WorkshopPlannerPageViewProps) {
  const {
    t,
    navigate,
    viewMode,
    setViewMode,
    anchorDate,
    shiftAnchor,
    pendingMoves,
    isLoading,
    bays,
    openings,
    holidays,
    bookings,
    employeesAway,
    plannerTimezone,
    subtitle,
    weekDates,
    daySlots,
    dayHours,
    showClosedDay,
    createSheet,
    drag,
  } = props
  const { setCreatePrefill, setCreateOpen } = createSheet

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        title={t('planner.page.title')}
        description={subtitle}
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              className="max-md:size-11"
              onClick={() => shiftAnchor(viewMode === 'day' ? -1 : -7)}
              aria-label={t('planner.page.previous')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="max-md:size-11"
              onClick={() => shiftAnchor(viewMode === 'day' ? 1 : 7)}
              aria-label={t('planner.page.next')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <PlannerViewToggle value={viewMode} onChange={setViewMode} />
            <Button
              className="max-md:min-h-11"
              onClick={() => {
                setCreatePrefill(null)
                setCreateOpen(true)
              }}
            >
              {t('planner.page.createOrder')}
            </Button>
          </>
        }
      />

      {isLoading ? (
        <WorkshopPlannerPageSkeleton />
      ) : bays.length === 0 ? (
        <PlannerEmptyState
          icon={<Wrench aria-hidden />}
          title={t('planner.page.noBaysTitle')}
          description={t('planner.page.noBaysDescription')}
          settingsAction={
            <PlannerGoToSettingsButton onGoToSettings={() => navigate('/settings?tab=bays')} />
          }
        />
      ) : (
        <WorkshopPlannerBoard
          viewMode={viewMode}
          anchorDate={anchorDate}
          pendingMoves={pendingMoves}
          bays={bays}
          openings={openings}
          holidays={holidays}
          bookings={bookings}
          plannerTimezone={plannerTimezone}
          weekDates={weekDates}
          daySlots={daySlots}
          dayHours={dayHours}
          showClosedDay={showClosedDay}
          createSheet={createSheet}
          drag={drag}
          t={t}
          navigate={navigate}
        />
      )}

      <PlannerCreateUrlOpener
        setPrefill={createSheet.setCreatePrefill}
        setOpen={createSheet.setCreateOpen}
      />
      <PlannerCreateSheet
        open={createSheet.createOpen}
        onOpenChange={createSheet.setCreateOpen}
        prefill={createSheet.createPrefill}
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

type WorkshopPlannerBoardProps = Pick<
  WorkshopPlannerPageViewProps,
  | 'viewMode'
  | 'anchorDate'
  | 'pendingMoves'
  | 'bays'
  | 'openings'
  | 'holidays'
  | 'bookings'
  | 'plannerTimezone'
  | 'weekDates'
  | 'daySlots'
  | 'dayHours'
  | 'showClosedDay'
  | 'createSheet'
  | 'drag'
  | 't'
  | 'navigate'
>

function WorkshopPlannerBoard({
  viewMode,
  anchorDate,
  pendingMoves,
  bays,
  openings,
  holidays,
  bookings,
  plannerTimezone,
  weekDates,
  daySlots,
  dayHours,
  showClosedDay,
  createSheet,
  drag,
  t,
  navigate,
}: WorkshopPlannerBoardProps) {
  return (
    <PlannerPendingMovesContext.Provider value={pendingMoves}>
      <DndContext
        sensors={drag.sensors}
        onDragStart={drag.handleDragStart}
        onDragEnd={drag.handleDragEnd}
      >
        {showClosedDay && (
          <PlannerEmptyState
            icon={<Calendar aria-hidden />}
            title={
              dayHours?.holidayName
                ? t('planner.grid.closedWithHoliday', { name: dayHours.holidayName })
                : t('planner.page.closedTitle')
            }
            description={t('planner.page.closedDescription')}
            settingsAction={
              <PlannerGoToSettingsButton onGoToSettings={() => navigate('/settings?tab=hours')} />
            }
          />
        )}

        <PlannerModeGrid
          viewMode={viewMode}
          bays={bays}
          anchorDate={anchorDate}
          plannerTimezone={plannerTimezone}
          daySlots={daySlots}
          dayHours={dayHours}
          weekDates={weekDates}
          openings={openings}
          holidays={holidays}
          bookings={bookings}
          onDaySlotClick={createSheet.handleDaySlotClick}
          onWeekDayClick={createSheet.handleWeekDayClick}
        />

        <DragOverlay>
          {drag.activeBooking && (
            <PlannerBookingBlock booking={drag.activeBooking} isDragging />
          )}
        </DragOverlay>
      </DndContext>
    </PlannerPendingMovesContext.Provider>
  )
}

export default function WorkshopPlannerPage() {
  return <WorkshopPlannerPageContent {...useWorkshopPlannerPage()} />
}
