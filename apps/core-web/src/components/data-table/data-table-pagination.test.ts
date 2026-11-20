// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getPageSizeChoices, getPaginationDisplay } from './data-table-pagination'

describe('getPageSizeChoices', () => {
  it('returns an empty array when there are no options', () => {
    expect(getPageSizeChoices([], 25)).toEqual([])
  })

  it('adds the current page size, dedupes and sorts', () => {
    expect(getPageSizeChoices([10, 50, 25], 30)).toEqual([10, 25, 30, 50])
  })

  it('does not duplicate when the current size is already listed', () => {
    expect(getPageSizeChoices([25, 10], 25)).toEqual([10, 25])
  })
})

describe('getPaginationDisplay', () => {
  it.each([
    [-1, true, { totalPages: 1, canNext: false }],
    [0, false, { totalPages: 1, canNext: false }],
    [1, false, { totalPages: 1, canNext: false }],
    [3, true, { totalPages: 3, canNext: true }],
    [3, false, { totalPages: 3, canNext: false }],
  ])('returns safe totalPages and canNext for pageCount=%i, canNextPage=%s', (pageCount, canNextPage, expected) => {
    expect(getPaginationDisplay(pageCount, canNextPage)).toEqual(expected)
  })
})
