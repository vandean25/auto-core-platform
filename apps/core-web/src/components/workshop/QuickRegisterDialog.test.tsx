import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { QuickRegisterDialog } from './QuickRegisterDialog'
import * as workshopApi from '@/api/workshop'
import { expectFieldErrorLinked, expectFieldValid } from '@/test/form-a11y'
import { deWorkshop } from '@/test/de-workshop'

const qr = deWorkshop.quickRegister

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

    fireEvent.click(screen.getByRole('button', { name: qr.register }))

    await screen.findAllByText(qr.required)
    for (const label of [qr.vin, qr.plate, qr.make, qr.model, qr.firstName, qr.lastName]) {
      expectFieldErrorLinked(screen.getByLabelText(label), qr.required)
    }
    expectFieldValid(screen.getByLabelText(qr.year))
  })

  it('is full screen on a phone with the primary action outside the scroll region', () => {
    render(<QuickRegisterDialog open onOpenChange={vi.fn()} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('max-sm:h-dvh')
    const submit = screen.getByRole('button', { name: qr.register })
    expect(submit).toHaveAttribute('form', 'quick-register-form')
    expect(dialog.querySelector('.dialog-body')?.contains(submit)).toBe(false)
    expect(dialog.querySelector('.grid')).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
  })
})
