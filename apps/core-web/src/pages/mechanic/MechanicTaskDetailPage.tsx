import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useMechanicTaskDetail } from '@/api/mechanic'
import { MechanicTaskDetailView } from '@/features/mechanic-task-detail/MechanicTaskDetailView'

export default function MechanicTaskDetailPage() {
  const navigate = useNavigate()
  const { taskId = '' } = useParams<{ taskId: string }>()
  const { data: task, isLoading, refetch } = useMechanicTaskDetail(taskId)

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-slate-500">Loading task…</p>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-slate-500">Task not found or access denied.</p>
        <Button variant="outline" onClick={() => navigate('/mechanic/queue')}>
          Back to Queue
        </Button>
      </div>
    )
  }

  return <MechanicTaskDetailView task={task} refetch={refetch} />
}
