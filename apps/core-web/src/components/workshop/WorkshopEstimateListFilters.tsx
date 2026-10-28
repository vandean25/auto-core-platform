import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DateField } from '@/components/ui/date-field'
import { Label } from '@/components/ui/label'
import { estimateBadgeLabel } from '@/features/workshop/workshop-estimate-decision'
import {
  ESTIMATE_STATUS_CHIPS,
  hasInvalidSentRange,
  type EstimateListView,
} from '@/features/workshop/workshop-estimate-list-filters'
import { EstimateCustomerPicker } from './EstimateCustomerPicker'

type WorkshopEstimateListFiltersProps = {
  view: EstimateListView
  onChange: (patch: Partial<EstimateListView>) => void
}

/** Status chips, customer, sent range and the older-versions switch of the estimates list. */
export function WorkshopEstimateListFilters({ view, onChange }: WorkshopEstimateListFiltersProps) {
  const { t } = useTranslation('workshop')
  const chips = ['ALL', ...ESTIMATE_STATUS_CHIPS] as const

  return (
    <div className="space-y-3" data-testid="estimate-list-filters">
      <div role="group" aria-label={t('estimateList.filters.statusAria')} className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <Button
            key={chip}
            size="sm"
            variant={!view.showOlder && view.status === chip ? 'default' : 'outline'}
            disabled={view.showOlder}
            aria-pressed={!view.showOlder && view.status === chip}
            data-testid={`estimate-status-chip-${chip}`}
            onClick={() => onChange({ status: chip })}
          >
            {chip === 'ALL' ? t('estimateList.filters.all') : estimateBadgeLabel(chip)}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 max-sm:basis-full flex-col gap-1">
          <Label>{t('estimateList.filters.customer')}</Label>
          <EstimateCustomerPicker
            customerId={view.customerId}
            customerName={view.customerName}
            onChange={(customer) => onChange({ customerId: customer?.id ?? '', customerName: customer?.name ?? '' })}
          />
        </div>
        <div className="flex flex-col gap-1 max-sm:flex-1">
          <Label htmlFor="estimate-sent-from">{t('estimateList.filters.sentFrom')}</Label>
          <DateField
            id="estimate-sent-from"
            value={view.sentFrom}
            onChange={(sentFrom) => onChange({ sentFrom })}
            data-testid="estimate-sent-from"
          />
        </div>
        <div className="flex flex-col gap-1 max-sm:flex-1">
          <Label htmlFor="estimate-sent-to">{t('estimateList.filters.sentTo')}</Label>
          <DateField
            id="estimate-sent-to"
            value={view.sentTo}
            onChange={(sentTo) => onChange({ sentTo })}
            data-testid="estimate-sent-to"
          />
        </div>
        <div className="flex min-h-11 items-center gap-2 sm:min-h-9">
          <Checkbox
            id="estimate-show-older"
            checked={view.showOlder}
            onCheckedChange={(checked) => onChange({ showOlder: checked === true })}
          />
          <Label htmlFor="estimate-show-older">{t('estimateList.filters.showOlder')}</Label>
        </div>
      </div>
      {hasInvalidSentRange(view) ? (
        <p className="text-sm text-warning" role="status">
          {t('estimateList.filters.rangeHint')}
        </p>
      ) : null}
    </div>
  )
}
