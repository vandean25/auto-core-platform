import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { InlineEdit } from './InlineEdit'
import { expectFieldErrorLinked, expectFieldValid } from '@/test/form-a11y'

describe('InlineEdit', () => {
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
})
