import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'
import { Skeleton } from '@/components/ui/skeleton'

interface AgentDateRangeFieldsProps {
  idPrefix: string
  startDate: string
  endDate: string
  onStartChange: (iso: string) => void
  onEndChange: (iso: string) => void
  startTestId: string
  endTestId: string
}

export function AgentDateRangeFields({
  idPrefix,
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  startTestId,
  endTestId,
}: AgentDateRangeFieldsProps) {
  const { t } = useTranslation('agent')
  const fields = [
    { id: `${idPrefix}-start-date`, label: t('activity.filters.startDateLabel'), value: startDate, onChange: onStartChange, testId: startTestId },
    { id: `${idPrefix}-end-date`, label: t('activity.filters.endDateLabel'), value: endDate, onChange: onEndChange, testId: endTestId },
  ]

  return fields.map((field) => (
    <div key={field.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
      <label htmlFor={field.id} className="text-xs text-muted-foreground font-medium">
        {field.label}:
      </label>
      <DateField
        id={field.id}
        aria-label={field.label}
        value={field.value}
        onChange={field.onChange}
        className="h-9 w-full text-xs sm:w-36"
        data-testid={field.testId}
      />
    </div>
  ))
}

export function AgentRefreshButton({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useTranslation('agent')

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onRefresh}
      className="text-muted-foreground hover:text-foreground"
      aria-label={t('common.refresh')}
    >
      <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
      {t('common.refresh')}
    </Button>
  )
}

export function AgentLoadingState() {
  const { t } = useTranslation('agent')

  return (
    <div role="status" aria-busy="true" className="space-y-3 rounded-lg border border-border bg-card p-6">
      <span className="sr-only">{t('common.loading')}</span>
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
    </div>
  )
}

export function AgentErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('agent')

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
      <p className="text-sm font-medium text-destructive">{t('common.error')}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/15"
      >
        {t('common.retry')}
      </Button>
    </div>
  )
}
