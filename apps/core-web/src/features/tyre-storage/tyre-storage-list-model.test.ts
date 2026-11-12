import { describe, expect, it } from 'vitest'

import type { StorageLocation } from '@/api/locations'
import type { TyreSet, TyreSetListResponse } from '@/api/tyre-storage'

import { TYRE_STORAGE_FILTER_ALL } from './tyre-storage-list-constants'
import {
  buildTyreSetListParams,
  filterCustomerStorageLocations,
  filtersLockedForDueView,
  resolveTyreStorageListLoading,
  resolveTyreStorageListRows,
  resolveTyreStoragePageCount,
  tyreStoragePageSizeOptions,
} from './tyre-storage-list-model'

const tyreSet = { id: 'ts-1' } as TyreSet

function location(type: StorageLocation['type']): StorageLocation {
  return { id: 'loc-1', name: 'Rack', code: 'R1', type }
}

describe('buildTyreSetListParams', () => {
  it('omits ALL sentinels and blank strings from the API query', () => {
    expect(
      buildTyreSetListParams(
        {
          search: ' W-1 ',
          season: TYRE_STORAGE_FILTER_ALL,
          status: 'IN_STORAGE',
          locationId: TYRE_STORAGE_FILTER_ALL,
          customerId: 'cust-1',
          dueFrom: '',
          dueTo: '2026-12-01',
        },
        { page: 2, pageSize: 25 },
      ),
    ).toEqual({
      search: ' W-1 ',
      status: 'IN_STORAGE',
      customerId: 'cust-1',
      dueTo: '2026-12-01',
      page: 2,
      pageSize: 25,
    })
  })
})

describe('filterCustomerStorageLocations', () => {
  it('keeps only customer_storage locations', () => {
    expect(
      filterCustomerStorageLocations([location('warehouse'), location('customer_storage')]),
    ).toEqual([location('customer_storage')])
  })
})

describe('list view resolution', () => {
  const listData: TyreSetListResponse = {
    data: [tyreSet],
    meta: { pageCount: 3, page: 1, pageSize: 25, total: 1 },
  }
  const dueData = { data: [{ id: 'due-1' } as TyreSet] }

  it('switches rows, loading, pagination and filter lock by view mode', () => {
    expect(resolveTyreStorageListRows('all', listData, dueData)).toEqual([tyreSet])
    expect(resolveTyreStorageListRows('due', listData, dueData)).toEqual(dueData.data)
    expect(resolveTyreStorageListLoading('all', true, false)).toBe(true)
    expect(resolveTyreStorageListLoading('due', true, false)).toBe(false)
    expect(resolveTyreStoragePageCount('all', listData)).toBe(3)
    expect(resolveTyreStoragePageCount('due', listData)).toBe(1)
    expect(tyreStoragePageSizeOptions('due')).toEqual([])
    expect(tyreStoragePageSizeOptions('all')).toBeUndefined()
    expect(filtersLockedForDueView('due')).toBe(true)
    expect(filtersLockedForDueView('all')).toBe(false)
  })
})
