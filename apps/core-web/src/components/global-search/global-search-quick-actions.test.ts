import { describe, expect, it } from 'vitest'
import {
  filterQuickActionSections,
  quickActionSections,
} from './global-search-quick-actions'

const labelsOf = (sections: ReturnType<typeof filterQuickActionSections>) =>
  sections.flatMap((section) => section.items.map((item) => item.label))

describe('filterQuickActionSections', () => {
  it('returns every section unchanged for an empty query', () => {
    expect(filterQuickActionSections(quickActionSections, '')).toBe(quickActionSections)
  })

  it('matches label and description case-insensitively and drops empty sections', () => {
    const result = filterQuickActionSections(quickActionSections, 'PURCHASE')

    expect(result.map((section) => section.heading)).toEqual(['Create'])
    expect(labelsOf(result)).toEqual(['Create Purchase Order', 'Create Purchase Bill'])
  })

  it('finds the invoicing action by its label', () => {
    const labels = labelsOf(filterQuickActionSections(quickActionSections, 'invoice'))

    expect(labels).toContain('Find a sales order to invoice')
    expect(labels).not.toContain('Create Sales Invoice')
  })

  it('returns no sections when nothing matches', () => {
    expect(filterQuickActionSections(quickActionSections, 'zzz')).toEqual([])
  })
})
