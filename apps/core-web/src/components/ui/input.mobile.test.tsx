import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Command, CommandInput } from './command'
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

  it('keeps CommandInput at text-base below md', () => {
    render(
      <Command>
        <CommandInput aria-label="Search commands" />
      </Command>,
    )
    expect(screen.getByLabelText('Search commands')).toHaveClass('text-base')
    expect(screen.getByLabelText('Search commands')).toHaveClass('md:text-sm')
  })

  it('applies max-sm:min-h-11 to Input and SelectTrigger while keeping desktop heights', () => {
    render(
      <>
        <Input aria-label="Touch Input" />
        <Select>
          <SelectTrigger aria-label="Touch Select">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
        </Select>
      </>,
    )
    expect(screen.getByLabelText('Touch Input')).toHaveClass('h-9', 'max-sm:min-h-11')
    expect(screen.getByLabelText('Touch Select')).toHaveClass('h-10', 'max-sm:min-h-11')
  })

  it('allows dense desktop-only opt-out via max-sm:min-h-0 on Input and SelectTrigger', () => {
    render(
      <>
        <Input aria-label="Dense Input" className="max-sm:min-h-0" />
        <Select>
          <SelectTrigger aria-label="Dense Select" className="max-sm:min-h-0">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
        </Select>
      </>,
    )
    const denseInput = screen.getByLabelText('Dense Input')
    expect(denseInput).toHaveClass('h-9', 'max-sm:min-h-0')
    expect(denseInput).not.toHaveClass('max-sm:min-h-11')

    const denseSelect = screen.getByLabelText('Dense Select')
    expect(denseSelect).toHaveClass('h-10', 'max-sm:min-h-0')
    expect(denseSelect).not.toHaveClass('max-sm:min-h-11')
  })
})
