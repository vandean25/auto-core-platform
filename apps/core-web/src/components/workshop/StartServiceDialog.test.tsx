import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, it, vi, beforeEach } from 'vitest'
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
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    ;(workshopApi.useCreateWorkshopOrder as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    })
  })

  it('links the required odometer error to its input', async () => {
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

  it('links the fuel level range error to its input', async () => {
    render(
      <StartServiceDialog
        open
        onOpenChange={vi.fn()}
        customerId="customer-1"
        vehicleId="vehicle-1"
        vehicleDescription="VW Golf"
      />,
    )

    fireEvent.change(screen.getByLabelText('Odometer (km)'), { target: { value: '12000' } })
    fireEvent.change(screen.getByLabelText('Fuel Level (%)'), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start Service' }))

    await screen.findByText('0-100 required')
    expectFieldErrorLinked(screen.getByLabelText('Fuel Level (%)'), '0-100 required')
    expectFieldValid(screen.getByLabelText('Odometer (km)'))
  })
})
