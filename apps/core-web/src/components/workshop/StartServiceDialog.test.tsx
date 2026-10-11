import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, vi, beforeEach } from 'vitest'
import { StartServiceDialog } from './StartServiceDialog'
import * as workshopApi from '@/api/workshop'
import { expectFieldErrorLinked, expectFieldValid } from '@/test/form-a11y'

vi.mock('@/api/workshop')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('StartServiceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(workshopApi.useCreateWorkshopOrder as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    })
  })

  it('links each required-field error to the input it describes', async () => {
    render(
      <StartServiceDialog
        open
        onOpenChange={vi.fn()}
        customerId="customer-1"
        vehicleId="vehicle-1"
        vehicleDescription="VW Golf"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start Service' }))

    await screen.findByText('Required')
    expectFieldErrorLinked(screen.getByLabelText('Odometer (km)'), 'Required')
    expectFieldValid(screen.getByLabelText('Fuel Level (%)'))
  })
})
