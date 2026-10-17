import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as workshopApi from '@/api/workshop'
import { RegistrationDocumentIntakeStep } from './RegistrationDocumentIntakeStep'
import { deWorkshop } from '@/test/de-workshop'

vi.mock('@/api/workshop')
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const appliedIntake = {
  id: 'intake-1',
  state: 'APPLIED',
  appliedWorkshopOrderId: 'order-1',
  evidence: {
    documentKind: 'AT_ZULASSUNGSSCHEIN',
    warnings: [],
    fields: {
      holder: {
        raw: null,
        normalized: { firstName: 'Max', lastName: 'Mustermann' },
        uncertainty: 0.1,
      },
    },
  },
  matchSnapshot: { cases: [], customers: [], vehicles: [] },
}

describe('RegistrationDocumentIntakeStep', () => {
  const onOrderCreated = vi.fn()
  const createOrder = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    createOrder.mockReset()
    ;(workshopApi.useCreateRegistrationIntake as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
      data: appliedIntake,
    })
    ;(workshopApi.useRegistrationIntake as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: appliedIntake,
    })
    ;(workshopApi.useApplyRegistrationIntake as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    ;(workshopApi.useRegistrationIntakeOrder as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: createOrder,
      isPending: false,
    })
    ;(workshopApi.useAbortRegistrationIntake as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
    ;(workshopApi.useDeleteRegistrationIntake as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('opens check-in for an existing intake order without calling the order endpoint', async () => {
    render(
      <RegistrationDocumentIntakeStep
        odometer="12000"
        fuelLevel="50"
        notes=""
        onOrderCreated={onOrderCreated}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: deWorkshop.registrationReview.continueCheckIn }),
    )

    await waitFor(() => {
      expect(onOrderCreated).toHaveBeenCalledWith('order-1')
    })
    expect(createOrder).not.toHaveBeenCalled()
  })
})
