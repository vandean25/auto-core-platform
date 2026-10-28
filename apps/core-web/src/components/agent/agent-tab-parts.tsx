import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { DateField } from '@/components/ui/date-field'

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
      <label htmlFor={field.id} className="text-xs text-slate-500 font-medium">
        {field.label}:
      </label>
      <DateField
        id={field.id}
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
      className="text-slate-500 hover:text-slate-900"
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
    <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
      <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
      {t('common.loading')}
    </div>
  )
}

export function AgentErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('agent')

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
      <p className="text-sm font-medium text-rose-800">{t('common.error')}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="mt-3 border-rose-300 text-rose-700 hover:bg-rose-100"
      >
        {t('common.retry')}
      </Button>
    </div>
  )
}
