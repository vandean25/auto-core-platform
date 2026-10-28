import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { InlineEdit } from './InlineEdit'
import { expectFieldErrorLinked, expectFieldValid } from '@/test/form-a11y'

describe('InlineEdit', () => {
  afterEach(() => {
    cleanup()
  })

  it('invites to edit an empty value in German, and a caller text wins', () => {
    const { rerender } = render(<InlineEdit value='' onSave={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Zum Bearbeiten klicken' })).toBeInTheDocument()

    rerender(<InlineEdit value='' emptyText='Notiz hinzufügen' onSave={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Notiz hinzufügen' })).toBeInTheDocument()
    expect(screen.queryByText('Click to edit')).not.toBeInTheDocument()
  })

  it('links the validation error to the input it describes', async () => {
    const onSave = vi.fn()
    render(
      <InlineEdit
        value="Brake fluid"
        ariaLabel="Note"
        schema={z.string().min(3, 'Note must have at least 3 characters')}
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Brake fluid' }))
    const input = screen.getByRole('textbox', { name: 'Note' })
    expectFieldValid(input)

    fireEvent.change(input, { target: { value: 'ab' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Note must have at least 3 characters')
    expectFieldErrorLinked(input, 'Note must have at least 3 characters')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('links the validation error of a textarea to the textarea', async () => {
    render(
      <InlineEdit
        value="Check pads"
        mode="textarea"
        ariaLabel="Note"
        schema={z.string().min(5, 'Note must have at least 5 characters')}
        onSave={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Check pads' }))
    const textarea = screen.getByRole('textbox', { name: 'Note' })
    fireEvent.change(textarea, { target: { value: 'ok' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Note must have at least 5 characters')
    expectFieldErrorLinked(textarea, 'Note must have at least 5 characters')
  })
})
