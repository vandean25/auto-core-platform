import { useAuthSession } from '@/api/auth-session'
import type { WorkshopOrder } from '@/api/types'
import { MechanicFindingAdvisorPanel } from '@/components/workshop/MechanicFindingAdvisorPanel'
import { ResumeWaitingTasksPanel } from '@/components/workshop/ResumeWaitingTasksPanel'
import { WorkshopCommunicationTimeline } from '@/components/workshop/WorkshopCommunicationTimeline'
import { WorkshopEstimateCard } from '@/components/workshop/WorkshopEstimateCard'
import { WorkshopReadyEmailNotice } from '@/components/workshop/WorkshopReadyEmailNotice'
import { canManageWorkshopEstimates } from '@/features/workshop/workshop-estimate-permissions'

/** The tasks the customer still has to answer. Their work does not go on until the advisor resumes them (AUT-355). */
function countWaitingTasks(tasks: ReadonlyArray<{ status: string }> | null | undefined): number {
  return (tasks ?? []).filter((task) => task.status === 'WAITING_CUSTOMER').length
}

/** Estimate, waiting-task and customer communication panels. Only roles that manage estimates see them. */
export function OrderAdvisorPanels({ order, isLocked }: { order: WorkshopOrder; isLocked: boolean }) {
  const sessionQuery = useAuthSession()
  if (!canManageWorkshopEstimates(sessionQuery.data?.activeRole)) return null

  return (
    <>
      <MechanicFindingAdvisorPanel orderId={order.id} />
      <WorkshopEstimateCard
        orderId={order.id}
        orderStatus={order.status}
        isLocked={isLocked}
        orderRevision={JSON.stringify(order.tasks ?? [])}
        customer={order.customer ?? null}
      />
      <ResumeWaitingTasksPanel
        orderId={order.id}
        waitingCount={countWaitingTasks(order.tasks)}
        orderStatus={order.status}
      />
      <WorkshopReadyEmailNotice orderId={order.id} notice={order.ready_email_notice} />
      <WorkshopCommunicationTimeline orderId={order.id} />
    </>
  )
}
