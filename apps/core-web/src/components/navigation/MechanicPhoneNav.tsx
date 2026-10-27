import { useState } from 'react'
import { ClipboardList, Clock, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { useHrMeClock, usePunchClock } from '@/api/hr'
import { useMechanicQueue } from '@/api/mechanic'
import { AttendancePunchBar } from '@/components/hr/AttendancePunchBar'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { MECHANIC_ROUTE_PATHS } from '@/lib/app-route-paths'
import { getErrorStatus } from '@/lib/error-utils'
import { PhoneBottomNav } from './PhoneBottomNav'

/**
 * Bottom bar of the mechanic shell: My tasks, Punch (time clock sheet), + Finding (opens the task being
 * worked on, else the first queued task) and Search (the Cmd+K palette).
 */
export function MechanicPhoneNav({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { t } = useTranslation('nav')
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [punchOpen, setPunchOpen] = useState(false)
  const { data: queue } = useMechanicQueue()
  const { data: clock, error: clockError } = useHrMeClock()
  const { mutate: punch, isPending } = usePunchClock()
  const tasks = queue?.data ?? []
  const findingTask = tasks.find((task) => task.taskStatus === 'IN_PROGRESS') ?? tasks[0]
  const clockAvailable = Boolean(clock) && getErrorStatus(clockError) !== 403

  return (
    <>
      <PhoneBottomNav
        start={[
          {
            id: 'my-tasks',
            label: t('phoneNav.myTasks'),
            icon: ClipboardList,
            to: MECHANIC_ROUTE_PATHS.queue,
            active: pathname.startsWith(MECHANIC_ROUTE_PATHS.root),
          },
          { id: 'punch', label: t('phoneNav.punch'), icon: Clock, onSelect: () => setPunchOpen(true) },
        ]}
        create={{
          label: findingTask ? t('phoneNav.finding') : t('phoneNav.findingNoTask'),
          disabled: !findingTask,
          onSelect: () => findingTask && navigate(MECHANIC_ROUTE_PATHS.taskDetail.replace(':taskId', findingTask.taskId)),
        }}
        end={[{ id: 'search', label: t('phoneNav.search'), icon: Search, onSelect: onOpenSearch }]}
      />
      <Sheet open={punchOpen} onOpenChange={setPunchOpen}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{t('phoneNav.punchTitle')}</SheetTitle>
            <SheetDescription className="sr-only">{t('phoneNav.punchTitle')}</SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {clock && clockAvailable ? (
              <AttendancePunchBar state={clock.state} pending={isPending} touchFriendly onPunch={(type) => punch({ type })} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('phoneNav.punchUnavailable')}</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
