import { useState } from 'react'
import { ClipboardList, Clock, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { matchPath, useLocation, useNavigate } from 'react-router-dom'

import { useMechanicQueue, type MechanicQueueItem } from '@/api/mechanic'
import { MECHANIC_ROUTE_PATHS } from '@/lib/app-route-paths'
import { PhoneBottomNav } from './PhoneBottomNav'
import { PhonePunchSheet } from './PhonePunchSheet'

/** The task shown, else the one in progress, else the first open task. */
function getFindingTaskId(tasks: MechanicQueueItem[], shownTaskId: string | undefined) {
  const inProgress = tasks.find((task) => task.taskStatus === 'IN_PROGRESS')
  return shownTaskId ?? (inProgress ?? tasks.find((task) => task.taskStatus !== 'DONE'))?.taskId
}

/**
 * Bottom bar of the mechanic shell: My tasks, Punch (time clock sheet), + Finding (opens a task, see
 * `getFindingTaskId`) and Search (the Cmd+K palette).
 */
export function MechanicPhoneNav({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { t } = useTranslation('nav')
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [punchOpen, setPunchOpen] = useState(false)
  const { data: queue } = useMechanicQueue()
  const findingTaskId = getFindingTaskId(queue?.data ?? [], matchPath(MECHANIC_ROUTE_PATHS.taskDetail, pathname)?.params.taskId)

  return (
    <>
      <PhoneBottomNav
        start={[
          {
            id: 'my-tasks',
            label: t('phoneNav.myTasks'),
            icon: ClipboardList,
            to: MECHANIC_ROUTE_PATHS.queue,
            active: pathname === MECHANIC_ROUTE_PATHS.queue,
          },
          { id: 'punch', label: t('phoneNav.punch'), icon: Clock, onSelect: () => setPunchOpen(true) },
        ]}
        create={{
          label: findingTaskId ? t('phoneNav.finding') : t('phoneNav.findingNoTask'),
          disabled: !findingTaskId,
          onSelect: () => findingTaskId && navigate(MECHANIC_ROUTE_PATHS.taskDetail.replace(':taskId', findingTaskId)),
        }}
        end={[{ id: 'search', label: t('phoneNav.search'), icon: Search, onSelect: onOpenSearch }]}
      />
      <PhonePunchSheet open={punchOpen} onOpenChange={setPunchOpen} />
    </>
  )
}
