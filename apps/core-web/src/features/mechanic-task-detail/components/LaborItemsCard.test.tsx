import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MechanicTaskDetail } from '@/api/mechanic'
import { LaborItemsCard } from './LaborItemsCard'

type LaborLine = MechanicTaskDetail['lineItems'][number]

describe('LaborItemsCard', () => {
  it('uses the canonical Labor heading', () => {
    const laborItems: LaborLine[] = [
      {
        id: 'labor-1',
        type: 'LABOR',
        itemNo: 'ENG-001',
        description: 'Engine diagnostic',
        qty: 1,
      },
    ]

    render(<LaborItemsCard laborItems={laborItems} />)

    expect(screen.getByText('Labor', { selector: 'h3' })).toBeInTheDocument()
    expect(screen.getByText('ENG-001 · Engine diagnostic')).toBeInTheDocument()
    expect(screen.getByText('1 hr')).toBeInTheDocument()
    expect(screen.queryByText('Labour', { selector: 'h3' })).not.toBeInTheDocument()
  })

  it('falls back to the description when a labor code is missing', () => {
    const laborItems: LaborLine[] = [
      {
        id: 'labor-2',
        type: 'LABOR',
        itemNo: '',
        description: 'General labor',
        qty: 2,
      },
    ]

    render(<LaborItemsCard laborItems={laborItems} />)

    expect(screen.getByText('General labor')).toBeInTheDocument()
    expect(screen.getByText('2 hrs')).toBeInTheDocument()
  })
})
