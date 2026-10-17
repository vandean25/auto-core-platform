import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MechanicTaskDetail } from '@/api/mechanic'
import { deWorkshop } from '@/test/de-workshop'
import { LaborItemsCard } from './LaborItemsCard'

type LaborLine = MechanicTaskDetail['lineItems'][number]

const labor = deWorkshop.mechanic.taskDetail.labor

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

    expect(screen.getByText(labor.title, { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByText('ENG-001 · Engine diagnostic')).toBeInTheDocument()
    expect(screen.getByText(labor.hours_one.replace('{{count}}', '1'))).toBeInTheDocument()
    expect(screen.queryByText('Labour', { selector: 'h2' })).not.toBeInTheDocument()
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
    expect(screen.getByText(labor.hours_other.replace('{{count}}', '2'))).toBeInTheDocument()
  })
})
