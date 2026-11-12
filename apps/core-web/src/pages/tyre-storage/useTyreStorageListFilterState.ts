import { useState } from 'react'

import type { Customer } from '@/api/types'
import {
  TYRE_STORAGE_FILTER_ALL,
  type TyreStorageListViewMode,
} from '@/features/tyre-storage/tyre-storage-list-constants'

export function useTyreStorageListFilterState() {
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<TyreStorageListViewMode>('all')
  const [season, setSeason] = useState<string>(TYRE_STORAGE_FILTER_ALL)
  const [status, setStatus] = useState<string>(TYRE_STORAGE_FILTER_ALL)
  const [locationId, setLocationId] = useState<string>(TYRE_STORAGE_FILTER_ALL)
  const [customerFilter, setCustomerFilter] = useState<Customer | null>(null)
  const [dueFrom, setDueFrom] = useState('')
  const [dueTo, setDueTo] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  return {
    search,
    setSearch,
    viewMode,
    setViewMode,
    season,
    setSeason,
    status,
    setStatus,
    locationId,
    setLocationId,
    customerFilter,
    setCustomerFilter,
    dueFrom,
    setDueFrom,
    dueTo,
    setDueTo,
    createOpen,
    setCreateOpen,
  }
}
