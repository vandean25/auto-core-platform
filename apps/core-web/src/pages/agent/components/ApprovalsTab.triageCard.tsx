import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Clock, ExternalLink } from 'lucide-react'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { AgentSupervisionTriageItem } from '@/api/agent-supervision-triage'
import { formatDateTime } from '@/lib/format'

const TRIAGE_STATUS_BY_KIND: Partial<
  Record<AgentSupervisionTriageItem['kind'], string>
> = {
  OVERDUE_LOANER: 'OUT_OF_STOCK',
  CUSTOMER_WAITING: 'WAITING_CUSTOMER',
  CUSTOMER_DECISION: 'IN_PROGRESS',
}

export function TriageCard({ item }: { item: AgentSupervisionTriageItem }) {
  const { t } = useTranslation('agent')
  const reasonLabel = t(`approvals.triageReason.${item.reason}`, {
    defaultValue: item.reason,
  })

  return (
    <article
      className="rounded-lg border border-border bg-card p-5 shadow-sm transition hover:border-muted-foreground/40"
      data-testid={`triage-card-${item.kind}-${item.entity_id}`}
      aria-label={reasonLabel}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              status={TRIAGE_STATUS_BY_KIND[item.kind] ?? 'PENDING'}
              label={reasonLabel}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            <Clock className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            {formatDateTime(item.created_at)}
            {item.due_at
              ? ` · ${t('approvals.dueAt')} ${formatDateTime(item.due_at)}`
              : null}
          </p>
        </div>
        <Link
          to={item.record_link}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/50"
          data-testid={`triage-open-${item.entity_id}`}
        >
          {t('approvals.openRecord')}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}
