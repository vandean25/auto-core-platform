import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, vi, beforeEach } from 'vitest'
import { QuickRegisterDialog } from './QuickRegisterDialog'
import * as workshopApi from '@/api/workshop'
import { expectFieldErrorLinked, expectFieldValid } from '@/test/form-a11y'

vi.mock('@/api/workshop')
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('QuickRegisterDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(workshopApi.useRegisterIntake as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    })
  })

  it('links each required-field error to the input it describes', async () => {
    render(<QuickRegisterDialog open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Register' }))

    await screen.findAllByText('Required')
    for (const label of ['VIN', 'Plate', 'Make', 'Model', 'First Name', 'Last Name']) {
      expectFieldErrorLinked(screen.getByLabelText(label), 'Required')
    }
    expectFieldValid(screen.getByLabelText('Year'))
  })
})
