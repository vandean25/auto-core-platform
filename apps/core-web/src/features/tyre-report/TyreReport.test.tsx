import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TyreReport } from './TyreReport'
import { measurement } from './tyre-report.test-fixtures'

afterEach(cleanup)

describe('TyreReport', () => {
  it.each([
    ['GOOD', 'Messwerte unauffällig', 'text-success'],
    ['RECOMMENDED', 'Empfehlung', 'text-warning'],
    ['URGENT', 'Dringender Handlungsbedarf', 'text-destructive'],
  ] as const)('displays the server status %s without reevaluating the tread', (status, label, colour) => {
    render(<TyreReport measurement={{ ...measurement, worstStatus: status, wheels: [
      { ...measurement.wheels[0], evaluation: { ...measurement.wheels[0].evaluation, status } },
    ] }} />)
    const wheel = screen.getByRole('article', { name: 'Vorne links' })
    expect(wheel).toHaveClass(colour)
    expect(within(wheel).getByText(label)).toBeVisible()
  })

  it('highlights the minimum supplied by the server and translates reasons and DOT age', () => {
    render(<TyreReport measurement={measurement} />)
    const wheel = screen.getByRole('article', { name: 'Vorne links' })
    expect(within(wheel).getByText('3,5 mm')).toHaveAttribute('data-worst-point', 'true')
    expect(within(wheel).getByText('79 Monate')).toBeVisible()
    expect(within(wheel).getByText(/Austausch empfohlen.*keine gesetzliche Grenze/)).toBeVisible()
    expect(screen.queryByText('TREAD_REPLACEMENT_RECOMMENDED')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows missing legacy values as dashes rather than zero and includes SPARE only when present', () => {
    const wheel = { ...measurement.wheels[0], treadInnerMm: null, treadOuterMm: null, brand: null, dot: null }
    const { rerender } = render(<TyreReport measurement={{ ...measurement, wheels: [wheel] }} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
    expect(within(screen.getByRole('article', { name: 'Vorne links' })).getByText('Reifenalter').nextElementSibling).toHaveTextContent('—')
    expect(screen.queryByRole('article', { name: 'Reserverad' })).not.toBeInTheDocument()
    rerender(<TyreReport measurement={{ ...measurement, wheels: [wheel, { ...wheel, id: 'spare', position: 'SPARE' }] }} />)
    expect(screen.getByRole('article', { name: 'Reserverad' })).toBeVisible()
  })

  it('uses the API threshold snapshot in the legend, including raised recommendations', () => {
    render(<TyreReport measurement={{ ...measurement, wheels: [{ ...measurement.wheels[0],
      evaluation: { ...measurement.wheels[0].evaluation,
        thresholds: { legalMinimumMm: 2, recommendedBelowMm: 5.5, ordinaryMinimumMm: 2 } },
    }] }} />)
    const legend = screen.getByRole('region', { name: 'Bewertung und Grenzwerte' })
    expect(within(legend).getByText(/5,5 mm/)).toBeVisible()
    expect(within(legend).getByText('Gesetzlicher Grenzwert: unter 2 mm')).toBeVisible()
  })

  it('renders numeric age recommendations only when supplied by the API snapshot', () => {
    const wheel = measurement.wheels[0]
    const { rerender } = render(<TyreReport measurement={{ ...measurement, wheels: [{ ...wheel,
      evaluation: { ...wheel.evaluation, ageRecommendations: { conditionCheckFromMonths: 84, replacementFromMonths: 132 } },
    }] }} />)
    const legend = screen.getByRole('region', { name: 'Bewertung und Grenzwerte' })
    expect(within(legend).getByText(/Zustand prüfen ab 84 Monaten/)).toBeVisible()
    expect(within(legend).getByText(/Austausch empfohlen ab 132 Monaten/)).toBeVisible()
    rerender(<TyreReport measurement={{ ...measurement, wheels: [{ ...wheel, evaluation: { ...wheel.evaluation, ageRecommendations: undefined } }] }} />)
    expect(within(legend).queryByText(/Zustand prüfen ab/)).not.toBeInTheDocument()
  })

  it('renders the wheel thumbnail only from the supplied media URLs', () => {
    render(<TyreReport measurement={{ ...measurement, wheels: [{ ...measurement.wheels[0], mediaId: 'photo-1' }] }} mediaUrls={{ 'photo-1': 'blob:photo-1' }} />)
    expect(screen.getByRole('img', { name: 'Reifenfoto: Vorne links' })).toHaveAttribute('src', 'blob:photo-1')
  })

  it('stacks usable cards at 375 px without imposing a minimum width', () => {
    const original = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
    const { container } = render(<TyreReport measurement={measurement} />)
    expect(screen.getAllByRole('article')).toHaveLength(4)
    expect(container.firstChild).toHaveClass('min-w-0')
    expect(container.querySelector('[data-testid="tyre-wheel-layout"]')).toHaveClass('grid-cols-1')
    for (const card of screen.getAllByRole('article')) {
      const metadata = within(card).getByText('Winterkennzeichnung').closest('dl')
      expect(metadata).toHaveClass('min-w-0', 'break-words', '[&>div]:min-w-0')
    }
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: original })
  })
})
