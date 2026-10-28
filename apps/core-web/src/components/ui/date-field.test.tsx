import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { registerGermanUiForTests } from '@/test/german-ui'
import { DateField, parseDisplayDate } from './date-field'

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

  it('exposes a German placeholder and a calendar button', () => {
    render(<Harness initial="" />)

    expect(screen.getByLabelText('Von')).toHaveAttribute('placeholder', 'TT.MM.JJJJ')
    expect(screen.getByRole('button', { name: 'Kalender öffnen' })).toBeInTheDocument()
  })
})

describe('parseDisplayDate', () => {
  it('only accepts zero-padded real dates', () => {
    expect(parseDisplayDate('29.02.2028')).toBe('2028-02-29')
    expect(parseDisplayDate('29.02.2027')).toBeNull()
    expect(parseDisplayDate('1.2.2026')).toBeNull()
  })
})
