import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, it, vi, beforeEach } from 'vitest'
import { StartServiceDialog } from './StartServiceDialog'
import * as workshopApi from '@/api/workshop'
import { expectFieldErrorLinked, expectFieldValid } from '@/test/form-a11y'
import { deWorkshop } from '@/test/de-workshop'

const ss = deWorkshop.startService

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

    fireEvent.click(screen.getByRole('button', { name: ss.submit }))

    await screen.findByText(ss.required)
    expectFieldErrorLinked(screen.getByLabelText(ss.odometer), ss.required)
    expectFieldValid(screen.getByLabelText(ss.fuelLevel))
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

    fireEvent.change(screen.getByLabelText(ss.odometer), { target: { value: '12000' } })
    fireEvent.change(screen.getByLabelText(ss.fuelLevel), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: ss.submit }))

    await screen.findByText(ss.fuelRange)
    expectFieldErrorLinked(screen.getByLabelText(ss.fuelLevel), ss.fuelRange)
    expectFieldValid(screen.getByLabelText(ss.odometer))
  })
})
