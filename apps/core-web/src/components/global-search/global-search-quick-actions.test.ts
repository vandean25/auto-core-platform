import { ClipboardList } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { filterQuickActionSections, type QuickActionSection } from './global-search-quick-actions'

const fixtureSections: QuickActionSection[] = [
  {
    heading: 'Navigate',
    items: [
      {
        href: '/purchase-orders',
        icon: ClipboardList,
        label: 'Create Purchase Order',
        description: 'Raise a new supplier order.',
        keywords: ['purchase'],
      },
      {
        href: '/sales-orders',
        icon: ClipboardList,
        label: 'Find a sales order to invoice',
        description: 'Open a sales order and use Create Invoice to draft its invoice.',
        keywords: ['sales invoice'],
      },
    ],
  },
]

function labelsOf(sections: QuickActionSection[]) {
  return sections.flatMap((section) => section.items.map((item) => item.label))
}

describe('filterQuickActionSections', () => {
  it('returns all sections for an empty query', () => {
    expect(filterQuickActionSections(fixtureSections, '')).toBe(fixtureSections)
  })

  it('filters items by label, description or keywords', () => {
    const result = filterQuickActionSections(fixtureSections, 'PURCHASE')
    expect(labelsOf(result)).toEqual(['Create Purchase Order'])
  })

  it('matches invoice-related quick actions via keywords', () => {
    const labels = labelsOf(filterQuickActionSections(fixtureSections, 'invoice'))
    expect(labels).toContain('Find a sales order to invoice')
  })

  it('matches multi-word keyword phrases', () => {
    expect(labelsOf(filterQuickActionSections(fixtureSections, 'sales invoice'))).toContain(
      'Find a sales order to invoice',
    )
    expect(labelsOf(filterQuickActionSections(fixtureSections, 'Create Sales Invoice'))).toEqual([])
  })

  it('returns no sections when nothing matches', () => {
    expect(filterQuickActionSections(fixtureSections, 'zzz')).toEqual([])
  })
})
