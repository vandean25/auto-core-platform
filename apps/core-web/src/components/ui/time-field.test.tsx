import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { registerGermanUiForTests } from '@/test/german-ui'
import { autoColonTime, isValidTime, TimeField } from './time-field'

registerGermanUiForTests()
afterEach(cleanup)

function Harness({ initial = '07:30' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <TimeField aria-label="Von" value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('TimeField', () => {
  it('shows the time as 24-hour text, never as AM/PM', () => {
    render(<Harness initial="17:05" />)

    const input = screen.getByLabelText('Von')
    expect(input).toHaveValue('17:05')
    expect(input).toHaveAttribute('type', 'text')
  })

  it('inserts the colon while digits are typed and emits only a real time', () => {
    render(<Harness initial="" />)
    const input = screen.getByLabelText('Von')

    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.change(input, { target: { value: '083' } })
    expect(input).toHaveValue('08:3')
    expect(screen.getByTestId('value')).toHaveTextContent('')

    fireEvent.change(input, { target: { value: '08:30' } })
    expect(screen.getByTestId('value')).toHaveTextContent('08:30')

    fireEvent.change(input, { target: { value: '2575' } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('value')).toHaveTextContent('08:30')
  })

  it('re-formats text that replaces the whole value with something shorter', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Von')

    fireEvent.change(input, { target: { value: '0800' } })

    expect(input).toHaveValue('08:00')
    expect(screen.getByTestId('value')).toHaveTextContent('08:00')
  })

  it('restores the last valid time on blur and clears when emptied', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Von')

    fireEvent.change(input, { target: { value: '07:3' } })
    fireEvent.blur(input)
    expect(input).toHaveValue('07:30')

    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByTestId('value')).toHaveTextContent('')
  })

  it('lets the browser block a form submit while the text is not a time', () => {
    render(
      <form>
        <TimeField aria-label="Von" value="07:30" onChange={() => undefined} required />
      </form>,
    )
    const input = screen.getByLabelText('Von') as HTMLInputElement

    expect(input.checkValidity()).toBe(true)
    fireEvent.change(input, { target: { value: '25:7' } })
    expect(input.checkValidity()).toBe(false)

    fireEvent.blur(input)
    expect(input).toHaveValue('25:7')
    expect(input.checkValidity()).toBe(false)
  })

  it('keeps backspace working after a formatted colon', () => {
    render(<Harness initial="" />)
    const input = screen.getByLabelText('Von')

    fireEvent.change(input, { target: { value: '0830' } })
    fireEvent.change(input, { target: { value: '08:3' } })
    fireEvent.change(input, { target: { value: '08:' } })
    fireEvent.change(input, { target: { value: '08' } })

    expect(input).toHaveValue('08')
  })

  it('follows a value changed from outside', () => {
    const { rerender } = render(<TimeField aria-label="Von" value="07:30" onChange={() => undefined} />)

    rerender(<TimeField aria-label="Von" value="18:00" onChange={() => undefined} />)

    expect(screen.getByLabelText('Von')).toHaveValue('18:00')
  })
})

describe('time helpers', () => {
  it('validates 24-hour times', () => {
    expect(isValidTime('23:59')).toBe(true)
    expect(isValidTime('24:00')).toBe(false)
    expect(isValidTime('7:30')).toBe(false)
    expect(isValidTime('07:60')).toBe(false)
  })

  it('formats digit runs', () => {
    expect(autoColonTime('0830')).toBe('08:30')
    expect(autoColonTime('08')).toBe('08')
    expect(autoColonTime('08:')).toBe('08:')
    expect(autoColonTime('08:30x9')).toBe('08:30')
    expect(autoColonTime('8:30')).toBe('08:30')
    expect(autoColonTime('7:')).toBe('07:')
  })
})
