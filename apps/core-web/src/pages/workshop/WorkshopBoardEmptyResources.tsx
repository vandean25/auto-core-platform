import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Wrench } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { BoardViewMode } from '@/components/workshop/BoardViewToggle'

export function WorkshopBoardEmptyResources({ mode }: { mode: BoardViewMode }) {
  const navigate = useNavigate()
  const { t } = useTranslation('workshop')
  const tab = mode === 'mechanic' ? 'employees' : 'bays'
  const resourceKey = mode === 'mechanic' ? 'mechanics' : 'bays'
  const resource = t(`board.emptyResources.${resourceKey}`)

  return (
    <Card className="max-w-sm mx-auto mt-8">
      <CardHeader className="items-center pb-2">
        <div className="rounded-full bg-slate-100 p-3 mb-2">
          <Wrench className="h-6 w-6 text-slate-400" />
        </div>
        <CardTitle className="text-base text-center">{t('board.emptyResources.title', { resource })}</CardTitle>
        <CardDescription className="text-center">
          {t('board.emptyResources.description', { resource })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pt-0">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/settings?tab=${tab}`)}
        >
          {t('board.emptyResources.goToSettings')}
        </Button>
      </CardContent>
    </Card>
  )
}
