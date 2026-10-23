// @vitest-environment node
import { Package, Truck } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { filterQuickActionSections, type QuickActionSection } from './global-search-quick-actions'

const sections: QuickActionSection[] = [
  {
    heading: 'Navigate',
    items: [{ href: '/inventory', icon: Package, label: 'Open Inventory', description: 'Browse parts and stock levels.' }],
  },
  {
    heading: 'Create',
    items: [
      { href: '/purchase-orders/new', icon: Truck, label: 'Create Purchase Order', description: 'Raise a new supplier order.' },
      { href: '/purchase-bills/new', icon: Truck, label: 'Create Purchase Bill', description: 'Match a vendor invoice to receipts.' },
    ],
  },
]

const labelsOf = (result: QuickActionSection[]) => result.flatMap((section) => section.items.map((item) => item.label))

describe('filterQuickActionSections', () => {
  it('returns every section unchanged for an empty query', () => {
    expect(filterQuickActionSections(sections, '')).toBe(sections)
  })

  it('matches label and description case-insensitively and drops empty sections', () => {
    const result = filterQuickActionSections(sections, 'PURCHASE')

    expect(result.map((section) => section.heading)).toEqual(['Create'])
    expect(labelsOf(result)).toEqual(['Create Purchase Order', 'Create Purchase Bill'])
  })

  it('matches the description text', () => {
    expect(labelsOf(filterQuickActionSections(sections, 'stock levels'))).toEqual(['Open Inventory'])
  })

  it('returns no sections when nothing matches', () => {
    expect(filterQuickActionSections(sections, 'zzz')).toEqual([])
  })
})
