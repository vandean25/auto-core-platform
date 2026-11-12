import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import type * as React from 'react'

export function PlannerEmptyState({
  icon,
  title,
  description,
  onGoToSettings,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onGoToSettings: () => void
}) {
  const { t } = useTranslation('workshop')
  return (
    <Empty className="mx-auto my-6 max-w-sm border">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" className="max-md:min-h-11" onClick={onGoToSettings}>
          {t('planner.page.goToSettings')}
        </Button>
      </EmptyContent>
    </Empty>
  )
}
