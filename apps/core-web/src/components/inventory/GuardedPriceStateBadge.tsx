import { useTranslation } from 'react-i18next'
import type { GuardedPriceItemStatus } from '@/api/inventory-price-operations'
import { StatusBadge } from '@/components/status/StatusBadge'

const STATUS_BADGE_MAP: Record<GuardedPriceItemStatus, string> = {
  APPLIED: 'APPLIED',
  CONFLICT: 'CONFLICT',
  PENDING: 'ACCEPTED',
  UNRESOLVED: 'UNRESOLVED',
  FENCED: 'FENCED',
  OUTCOME_UNAVAILABLE: 'OUTCOME_UNAVAILABLE',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID: 'INVALID',
}

const STATE_LABEL_KEY = {
  APPLIED: 'bulk.adjustPrice.states.applied',
  CONFLICT: 'bulk.adjustPrice.states.conflict',
  PENDING: 'bulk.adjustPrice.states.pending',
  UNRESOLVED: 'bulk.adjustPrice.states.unresolved',
  FENCED: 'bulk.adjustPrice.states.notApplied',
  OUTCOME_UNAVAILABLE: 'bulk.adjustPrice.states.outcomeUnavailable',
  FORBIDDEN: 'bulk.adjustPrice.states.forbidden',
  NOT_FOUND: 'bulk.adjustPrice.states.notFound',
  INVALID: 'bulk.adjustPrice.states.invalid',
} as const satisfies Record<GuardedPriceItemStatus, string>

export function GuardedPriceStateBadge({ status }: { status: GuardedPriceItemStatus }) {
  const { t } = useTranslation('inventory')
  return <StatusBadge status={STATUS_BADGE_MAP[status]} label={t(STATE_LABEL_KEY[status])} />
}
