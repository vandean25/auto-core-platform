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
  settingsAction,
}: {
  icon: React.ReactNode
  title: string
  description: string
  settingsAction: React.ReactNode
}) {
  return (
    <Empty className="mx-auto my-6 max-w-sm border">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{settingsAction}</EmptyContent>
    </Empty>
  )
}
