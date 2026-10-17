import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useMechanicTaskDetail } from '@/api/mechanic'
import { MechanicTaskDetailView } from '@/features/mechanic-task-detail/MechanicTaskDetailView'

export default function MechanicTaskDetailPage() {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()
  const { taskId = '' } = useParams<{ taskId: string }>()
  const { data: task, isLoading, refetch } = useMechanicTaskDetail(taskId)

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-slate-500">{t('mechanic.taskDetail.loading')}</p>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-slate-500">{t('mechanic.taskDetail.notFound')}</p>
        <Button variant="outline" onClick={() => navigate('/mechanic/queue')}>
          {t('mechanic.taskDetail.backToQueue')}
        </Button>
      </div>
    )
  }

  return <MechanicTaskDetailView task={task} refetch={refetch} />
}
