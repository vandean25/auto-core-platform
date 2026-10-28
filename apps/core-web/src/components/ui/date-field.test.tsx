import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { registerGermanUiForTests } from '@/test/german-ui'
import { autoDotDate, DateField, parseDisplayDate } from './date-field'

registerGermanUiForTests()
afterEach(cleanup)

function Harness({ initial = '2026-10-04' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <DateField aria-label="Von" value={value} onChange={setValue} />
      <output data-testid="iso">{value}</output>
    </>
  )
}

describe('DateField', () => {
  it('shows an ISO value as TT.MM.JJJJ', () => {
    render(<Harness />)

    expect(screen.getByLabelText('Von')).toHaveValue('04.10.2026')
  })

  it('emits ISO once a real date has been typed and ignores partial or impossible input', () => {
    render(<Harness initial="" />)
    const input = screen.getByLabelText('Von')

    fireEvent.change(input, { target: { value: '12.03.20' } })
    expect(screen.getByTestId('iso')).toHaveTextContent('')

    fireEvent.change(input, { target: { value: '31.02.2026' } })
    expect(screen.getByTestId('iso')).toHaveTextContent('')

    fireEvent.change(input, { target: { value: '12.03.2026' } })
    expect(screen.getByTestId('iso')).toHaveTextContent('2026-03-12')
  })

  it('clears the value when the text is emptied and restores the last valid date on blur', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Von')

    fireEvent.change(input, { target: { value: '04.10.20' } })
    fireEvent.blur(input)
    expect(input).toHaveValue('04.10.2026')

    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByTestId('iso')).toHaveTextContent('')
  })

  it('inserts the dots while digits are typed', () => {
    render(<Harness initial="" />)
    const input = screen.getByLabelText('Von')

    fireEvent.change(input, { target: { value: '12032026' } })

    expect(input).toHaveValue('12.03.2026')
    expect(screen.getByTestId('iso')).toHaveTextContent('2026-03-12')
  })

  it('converts a pasted ISO date', () => {
    render(<Harness initial="" />)
    const input = screen.getByLabelText('Von')

    fireEvent.change(input, { target: { value: '2026-05-12' } })

    expect(input).toHaveValue('12.05.2026')
    expect(screen.getByTestId('iso')).toHaveTextContent('2026-05-12')
  })

  it('marks half-typed text as invalid', () => {
    render(<Harness initial="" />)
    const input = screen.getByLabelText('Von')

    fireEvent.change(input, { target: { value: '12.03' } })

    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('follows a value changed from outside', () => {
    const { rerender } = render(<DateField aria-label="Von" value="2026-10-04" onChange={() => undefined} />)

    rerender(<DateField aria-label="Von" value="2026-11-05" onChange={() => undefined} />)

    expect(screen.getByLabelText('Von')).toHaveValue('05.11.2026')
  })

  it('keeps the date when the selected day is picked again and closes the calendar', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Kalender öffnen: Von' }))
    fireEvent.click((await screen.findAllByRole('button', { name: /4\. Oktober 2026/ }))[0])

    expect(screen.getByTestId('iso')).toHaveTextContent('2026-10-04')
    expect(screen.getByLabelText('Von')).toHaveValue('04.10.2026')
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('re-formats text that replaces the whole value and keeps backspace working', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Von')

    fireEvent.change(input, { target: { value: '1203' } })
    expect(input).toHaveValue('12.03.')

    fireEvent.change(input, { target: { value: '12.03' } })
    expect(input).toHaveValue('12.03')
  })

  it('blocks a form submit while the text is not a date, also after blur', () => {
    render(
      <form>
        <DateField aria-label="Von" value="2026-10-04" onChange={() => undefined} />
      </form>,
    )
    const input = screen.getByLabelText('Von') as HTMLInputElement

    expect(input.checkValidity()).toBe(true)
    fireEvent.change(input, { target: { value: '31.02.2026' } })
    fireEvent.blur(input)

    expect(input).toHaveValue('31.02.2026')
    expect(input.checkValidity()).toBe(false)
  })

  it('exposes a German placeholder and a calendar button', () => {
    render(<Harness initial="" />)

    expect(screen.getByLabelText('Von')).toHaveAttribute('placeholder', 'TT.MM.JJJJ')
    expect(screen.getByRole('button', { name: 'Kalender öffnen: Von' })).toBeInTheDocument()
  })
})

describe('parseDisplayDate', () => {
  it('only accepts zero-padded real dates', () => {
    expect(parseDisplayDate('29.02.2028')).toBe('2028-02-29')
    expect(parseDisplayDate('29.02.2027')).toBeNull()
    expect(parseDisplayDate('1.2.2026')).toBeNull()
    expect(parseDisplayDate('12.03.0020')).toBeNull()
  })

  it('autoDotDate formats digit runs', () => {
    expect(autoDotDate('1203')).toBe('12.03.')
    expect(autoDotDate('120320')).toBe('12.03.20')
    expect(autoDotDate('12.03.2026x')).toBe('12.03.2026')
  })
})
