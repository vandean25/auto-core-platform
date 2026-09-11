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
        description: 'Engine diagnostic',
        qty: 1,
      },
    ]

    render(<LaborItemsCard laborItems={laborItems} />)

    expect(screen.getByText('Labor', { selector: 'h3' })).toBeInTheDocument()
    expect(screen.queryByText('Labour', { selector: 'h3' })).not.toBeInTheDocument()
  })
})
