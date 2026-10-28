import { describe, expect, it } from 'vitest'

import { MAX_LIST_PAGE_SIZE, MAX_VEHICLE_LIST_PAGE_SIZE, clampPageSize } from './list-page-size'

describe('clampPageSize', () => {
  it('keeps a page size inside the cap and raises one below 1', () => {
    expect(clampPageSize(25)).toBe(25)
    expect(clampPageSize(200)).toBe(MAX_LIST_PAGE_SIZE)
    expect(clampPageSize(200, MAX_VEHICLE_LIST_PAGE_SIZE)).toBe(MAX_VEHICLE_LIST_PAGE_SIZE)
    expect(clampPageSize(0)).toBe(1)
    expect(clampPageSize(12.7)).toBe(12)
  })
})
