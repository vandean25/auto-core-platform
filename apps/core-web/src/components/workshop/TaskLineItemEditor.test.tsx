import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as workshopApi from '@/api/workshop'
import * as laborApi from '@/api/labor'
import { TaskLineItemEditor } from './TaskLineItemEditor'

vi.mock('@/api/workshop')
vi.mock('@/api/labor')

describe('TaskLineItemEditor labor metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(workshopApi.useCatalogSearch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { labor: [], parts: [] },
      isFetching: false,
    })
    ;(laborApi.useLaborOperation as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isFetching: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders Standard AW, Actual Hours, and Efficiency for labor lines', () => {
    render(
      <TaskLineItemEditor
        workshopOrderId='wo-1'
        taskId='task-1'
        lineItems={[
          {
            id: 'li-1',
            type: 'LABOR',
            itemNo: 'LAB-001',
            description: 'Oil service labor',
            qty: 1.5,
            unitPrice: 100,
            laborOperationId: '550e8400-e29b-41d4-a716-446655440000',
            standardAw: 1.5,
            actualHours: 2,
            internalCostRate: 55,
          },
        ]}
        readOnly={false}
        onLineItemsChange={vi.fn()}
      />,
    )

    expect(screen.getByText(/Standard AW\s+1\.50/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Actual Hours')).toBeInTheDocument()
    expect(screen.getByText(/Efficiency\s+0\.75x/i)).toBeInTheDocument()
  })
})
