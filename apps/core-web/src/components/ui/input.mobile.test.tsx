import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Input } from './input'
import { Select, SelectTrigger, SelectValue } from './select'

afterEach(cleanup)

describe('mobile input font sizing', () => {
  it('keeps Input at text-base below md', () => {
    render(<Input aria-label="Amount" />)
    expect(screen.getByLabelText('Amount')).toHaveClass('text-base')
    expect(screen.getByLabelText('Amount')).toHaveClass('md:text-sm')
  })

  it('keeps SelectTrigger at text-base below md', () => {
    render(
      <Select>
        <SelectTrigger aria-label="Status">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
      </Select>,
    )
    expect(screen.getByLabelText('Status')).toHaveClass('text-base')
    expect(screen.getByLabelText('Status')).toHaveClass('md:text-sm')
  })

  it('assigns inputMode for number inputs', () => {
    render(<Input type="number" step="0.01" aria-label="Price" />)
    expect(screen.getByLabelText('Price')).toHaveAttribute('inputMode', 'decimal')
  })
})
