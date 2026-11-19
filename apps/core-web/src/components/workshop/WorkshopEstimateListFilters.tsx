import { useState } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DateField } from '@/components/ui/date-field'
import { Label } from '@/components/ui/label'
import { estimateVersionStatusLabel } from '@/features/workshop/workshop-estimate-decision'
import {
  ESTIMATE_STATUS_CHIPS,
  hasInvalidSentRange,
  type EstimateListView,
} from '@/features/workshop/workshop-estimate-list-filters'
import { cn } from '@/lib/utils'
import { EstimateCustomerPicker } from './EstimateCustomerPicker'

type WorkshopEstimateListFiltersProps = {
  view: EstimateListView
  onChange: (patch: Partial<EstimateListView>) => void
}

/** Status chips, customer, sent range and the older-versions switch of the estimates list. */
export function WorkshopEstimateListFilters({ view, onChange }: WorkshopEstimateListFiltersProps) {
  const { t } = useTranslation('workshop')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const chips = ['ALL', ...ESTIMATE_STATUS_CHIPS] as const
  const activeFilterCount =
    Number(Boolean(view.customerId)) + Number(Boolean(view.sentFrom || view.sentTo)) + Number(view.showOlder)

  return (
    <div className="space-y-3" data-testid="estimate-list-filters">
      <div role="group" aria-label={t('estimateList.filters.statusAria')} className="flex flex-wrap gap-1.5 sm:gap-2">
        {chips.map((chip) => (
          <Button
            key={chip}
            size="sm"
            variant={!view.showOlder && view.status === chip ? 'default' : 'outline'}
            disabled={view.showOlder}
            aria-pressed={!view.showOlder && view.status === chip}
            data-testid={`estimate-status-chip-${chip}`}
            className="max-sm:min-h-11"
            onClick={() => onChange({ status: chip })}
          >
            {chip === 'ALL' ? t('estimateList.filters.all') : estimateVersionStatusLabel(chip)}
          </Button>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        aria-expanded={filtersOpen}
        aria-controls="estimate-secondary-filters"
        data-testid="estimate-filters-toggle"
        className="min-h-11 w-full justify-between sm:hidden"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0
            ? t('estimateList.filters.moreFiltersCount', { count: activeFilterCount })
            : t('estimateList.filters.moreFilters')}
        </span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', filtersOpen && 'rotate-180')} />
      </Button>
      <div
        id="estimate-secondary-filters"
        className={cn('grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end', !filtersOpen && 'max-sm:hidden')}
      >
        <div className="col-span-2 flex min-w-0 flex-col gap-1">
          <Label>{t('estimateList.filters.customer')}</Label>
          <EstimateCustomerPicker
            customerId={view.customerId}
            customerName={view.customerName}
            onChange={(customer) => onChange({ customerId: customer?.id ?? '', customerName: customer?.name ?? '' })}
          />
        </div>
        <div className="col-span-2 flex w-full flex-col gap-1 sm:col-span-1 sm:min-w-[10.5rem]">
          <Label htmlFor="estimate-sent-from">{t('estimateList.filters.sentFrom')}</Label>
          <DateField
            id="estimate-sent-from"
            value={view.sentFrom}
            onChange={(sentFrom) => onChange({ sentFrom })}
            data-testid="estimate-sent-from"
          />
        </div>
        <div className="col-span-2 flex w-full flex-col gap-1 sm:col-span-1 sm:min-w-[10.5rem]">
          <Label htmlFor="estimate-sent-to">{t('estimateList.filters.sentTo')}</Label>
          <DateField
            id="estimate-sent-to"
            value={view.sentTo}
            onChange={(sentTo) => onChange({ sentTo })}
            data-testid="estimate-sent-to"
          />
        </div>
        <div className="col-span-2 flex min-h-11 items-center gap-2 sm:min-h-9">
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
