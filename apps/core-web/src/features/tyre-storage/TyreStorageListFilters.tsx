import { useTranslation } from 'react-i18next'

import type { Customer } from '@/api/types'
import type { StorageLocation } from '@/api/locations'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import { DateField } from '@/components/ui/date-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { TYRE_STORAGE_FILTER_ALL, type TyreStorageListViewMode } from './tyre-storage-list-constants'
import { filtersLockedForDueView } from './tyre-storage-list-model'

export type TyreStorageListFiltersProps = {
  viewMode: TyreStorageListViewMode
  search: string
  onSearchChange: (value: string) => void
  season: string
  onSeasonChange: (value: string) => void
  status: string
  onStatusChange: (value: string) => void
  locationId: string
  onLocationIdChange: (value: string) => void
  customerFilter: Customer | null
  onCustomerFilterChange: (customer: Customer | null) => void
  dueFrom: string
  onDueFromChange: (value: string) => void
  dueTo: string
  onDueToChange: (value: string) => void
  storageLocations: StorageLocation[]
}

export function TyreStorageListFilters({
  viewMode,
  search,
  onSearchChange,
  season,
  onSeasonChange,
  status,
  onStatusChange,
  locationId,
  onLocationIdChange,
  customerFilter,
  onCustomerFilterChange,
  dueFrom,
  onDueFromChange,
  dueTo,
  onDueToChange,
  storageLocations,
}: TyreStorageListFiltersProps) {
  const { t } = useTranslation('inventory')
  const filtersLocked = filtersLockedForDueView(viewMode)

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:flex md:flex-row md:flex-wrap md:items-end">
        <div className="col-span-2 space-y-1 md:col-span-1">
          <Label>{t('tyreStorage.list.filters.plateVin')}</Label>
          <Input
            className="max-w-md min-h-11 text-base"
            placeholder={t('tyreStorage.list.filters.searchPlateVin')}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            disabled={filtersLocked}
          />
        </div>
        <div
          className={`col-span-2 min-w-0 space-y-1 md:col-span-1 md:min-w-[16rem] ${filtersLocked ? 'pointer-events-none opacity-50' : ''}`}
        >
          <Label>{t('tyreStorage.list.filters.customer')}</Label>
          <CustomerSearch value={customerFilter} onChange={onCustomerFilterChange} />
        </div>
        <div className="space-y-1">
          <Label>{t('tyreStorage.list.filters.season')}</Label>
          <Select value={season} onValueChange={onSeasonChange} disabled={filtersLocked}>
            <SelectTrigger className="min-h-11 w-full md:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TYRE_STORAGE_FILTER_ALL}>{t('tyreStorage.list.filters.all')}</SelectItem>
              <SelectItem value="WINTER">{t('tyreStorage.list.filters.winter')}</SelectItem>
              <SelectItem value="SUMMER">{t('tyreStorage.list.filters.summer')}</SelectItem>
              <SelectItem value="ALL_SEASON">{t('tyreStorage.list.filters.allSeason')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t('tyreStorage.list.filters.status')}</Label>
          <Select value={status} onValueChange={onStatusChange} disabled={filtersLocked}>
            <SelectTrigger className="min-h-11 w-full md:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TYRE_STORAGE_FILTER_ALL}>{t('tyreStorage.list.filters.all')}</SelectItem>
              <SelectItem value="NEW">{t('tyreStorage.list.filters.new')}</SelectItem>
              <SelectItem value="IN_STORAGE">{t('tyreStorage.list.filters.inStorage')}</SelectItem>
              <SelectItem value="RETURNED">{t('tyreStorage.list.filters.returned')}</SelectItem>
              <SelectItem value="DISPOSED">{t('tyreStorage.list.filters.disposed')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t('tyreStorage.list.filters.location')}</Label>
          <Select value={locationId} onValueChange={onLocationIdChange} disabled={filtersLocked}>
            <SelectTrigger className="min-h-11 w-full md:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TYRE_STORAGE_FILTER_ALL}>{t('tyreStorage.list.filters.all')}</SelectItem>
              {storageLocations.map((loc) => (
                <SelectItem key={loc.id} value={loc.id}>
                  {loc.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 w-full space-y-1 sm:col-span-1 sm:min-w-[10.5rem]">
          <Label>{t('tyreStorage.list.filters.dueFrom')}</Label>
          <DateField
            aria-label={t('tyreStorage.list.filters.dueFrom')}
            className="min-h-11"
            value={dueFrom}
            onChange={onDueFromChange}
            disabled={filtersLocked}
          />
        </div>
        <div className="col-span-2 w-full space-y-1 sm:col-span-1 sm:min-w-[10.5rem]">
          <Label>{t('tyreStorage.list.filters.dueTo')}</Label>
          <DateField
            aria-label={t('tyreStorage.list.filters.dueTo')}
            className="min-h-11"
            value={dueTo}
            onChange={onDueToChange}
            disabled={filtersLocked}
          />
        </div>
      </div>
    </div>
  )
}
