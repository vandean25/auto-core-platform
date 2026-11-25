import type { ColumnFiltersState } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type ContactedFilter = 'yes' | 'no' | 'older_than'

const WINDOW_ALL = 'ALL'
const STATUS_ALL = 'ALL'
const CONTACTED_ALL = 'ALL'
export const DEFAULT_OLDER_THAN_DAYS = 14

function upsertFilter(
  current: ColumnFiltersState,
  id: string,
  value: string | null,
): ColumnFiltersState {
  const next = current.filter((filter) => filter.id !== id)
  if (value) next.push({ id, value })
  return next
}

type PickerlDueFiltersProps = {
  window?: 30 | 60 | 90
  status?: string
  contacted?: ContactedFilter
  contactedDays?: number
  setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>
  resetPage: () => void
}

export function PickerlDueFilters({
  window,
  status,
  contacted,
  contactedDays,
  setColumnFilters,
  resetPage,
}: PickerlDueFiltersProps) {
  const { t } = useTranslation('vehicles')

  return (
    <div className="flex flex-wrap gap-3">
      <Select
        value={window ? String(window) : WINDOW_ALL}
        onValueChange={(value) => {
          setColumnFilters((current) =>
            upsertFilter(current, 'window', value === WINDOW_ALL ? null : value),
          )
          resetPage()
        }}
      >
        <SelectTrigger aria-label={t('pickerlDue.windowAria')} className="w-[180px] max-sm:min-h-11">
          <SelectValue placeholder={t('pickerlDue.windowPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={WINDOW_ALL}>{t('pickerlDue.windowAll')}</SelectItem>
          <SelectItem value="30">{t('pickerlDue.windowDays', { count: 30 })}</SelectItem>
          <SelectItem value="60">{t('pickerlDue.windowDays', { count: 60 })}</SelectItem>
          <SelectItem value="90">{t('pickerlDue.windowDays', { count: 90 })}</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={status ?? STATUS_ALL}
        onValueChange={(value) => {
          setColumnFilters((current) =>
            upsertFilter(current, 'status', value === STATUS_ALL ? null : value),
          )
          resetPage()
        }}
      >
        <SelectTrigger aria-label={t('pickerlDue.statusAria')} className="w-[180px] max-sm:min-h-11">
          <SelectValue placeholder={t('pickerlDue.statusPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={STATUS_ALL}>{t('pickerlDue.statusAll')}</SelectItem>
          <SelectItem value="OK">{t('pickerlDue.statusOk')}</SelectItem>
          <SelectItem value="DUE_SOON">{t('pickerlDue.statusDueSoon')}</SelectItem>
          <SelectItem value="OVERDUE">{t('pickerlDue.statusOverdue')}</SelectItem>
          <SelectItem value="UNKNOWN">{t('pickerlDue.statusUnknown')}</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={contacted ?? CONTACTED_ALL}
        onValueChange={(value) => {
          setColumnFilters((current) => {
            const withContacted = upsertFilter(
              current,
              'contacted',
              value === CONTACTED_ALL ? null : value,
            )
            return value === 'older_than'
              ? upsertFilter(
                  withContacted,
                  'contactedDays',
                  String(contactedDays ?? DEFAULT_OLDER_THAN_DAYS),
                )
              : upsertFilter(withContacted, 'contactedDays', null)
          })
          resetPage()
        }}
      >
        <SelectTrigger aria-label={t('pickerlDue.contactedAria')} className="w-[200px] max-sm:min-h-11">
          <SelectValue placeholder={t('pickerlDue.contactedPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CONTACTED_ALL}>{t('pickerlDue.contactedAll')}</SelectItem>
          <SelectItem value="yes">{t('pickerlDue.contactedYes')}</SelectItem>
          <SelectItem value="no">{t('pickerlDue.contactedNo')}</SelectItem>
          <SelectItem value="older_than">{t('pickerlDue.contactedOlderThan')}</SelectItem>
        </SelectContent>
      </Select>

      {contacted === 'older_than' && (
        <Input
          type="number"
          min={1}
          aria-label={t('pickerlDue.contactedDaysAria')}
          className="w-[100px] max-sm:min-h-11"
          value={contactedDays ?? DEFAULT_OLDER_THAN_DAYS}
          onChange={(e) => {
            const val = Math.max(1, Number(e.target.value) || DEFAULT_OLDER_THAN_DAYS)
            setColumnFilters((current) => upsertFilter(current, 'contactedDays', String(val)))
            resetPage()
          }}
        />
      )}
    </div>
  )
}
