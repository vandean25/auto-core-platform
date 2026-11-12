import { useWorkshopPlannerPage } from './hooks/useWorkshopPlannerPage'
import { WorkshopPlannerPageView } from './WorkshopPlannerPageView'

export default function WorkshopPlannerPage() {
  return <WorkshopPlannerPageView {...useWorkshopPlannerPage()} />
}
