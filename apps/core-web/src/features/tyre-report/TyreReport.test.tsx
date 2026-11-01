import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { components } from '@/api/generated/openapi'
import { TyreReport } from './TyreReport'
import { measurement } from './tyre-report.test-fixtures'

type ReasonCode = components['schemas']['TyreWheelResponseDto']['evaluation']['reasonCodes'][number]

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
    expect(within(wheel).getByText('Empfehlung: Austausch (Profil)')).toBeVisible()
    expect(within(wheel).queryByText(/keine gesetzliche Grenze/)).not.toBeInTheDocument()
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

  it('does not render any threshold, explanation or legend block on any tyre report view', () => {
    render(<TyreReport measurement={measurement} />)
    expect(screen.queryByRole('region', { name: /Bewertung und Grenzwerte/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Bewertung und Grenzwerte/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Allgemeine Mindestprofiltiefe/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Gesetzlicher Grenzwert/)).not.toBeInTheDocument()
  })

  it('renders no reason line for green wheels even if reason codes are present', () => {
    const greenWheel = {
      ...measurement.wheels[0],
      evaluation: {
        ...measurement.wheels[0].evaluation,
        status: 'GOOD' as const,
        reasonCodes: ['DOT_CONDITION_CHECK_RECOMMENDED', 'AT_WINTER_RULE_NOTICE'] as ReasonCode[],
      },
    }
    render(<TyreReport measurement={{ ...measurement, worstStatus: 'GOOD', wheels: [greenWheel] }} />)
    const wheel = screen.getByRole('article', { name: 'Vorne links' })
    expect(within(wheel).queryByText(/Empfehlung/)).not.toBeInTheDocument()
    expect(within(wheel).queryByText(/Hinweis/)).not.toBeInTheDocument()
  })

  it('renders exactly one reason line containing "Empfehlung" for amber wheels', () => {
    const amberWheel = {
      ...measurement.wheels[0],
      evaluation: {
        ...measurement.wheels[0].evaluation,
        status: 'RECOMMENDED' as const,
        reasonCodes: ['DOT_CONDITION_CHECK_RECOMMENDED'] as ReasonCode[],
      },
    }
    render(<TyreReport measurement={{ ...measurement, wheels: [amberWheel] }} />)
    const wheel = screen.getByRole('article', { name: 'Vorne links' })
    const reasonElement = within(wheel).getByText('Empfehlung: Alter prüfen (DOT)')
    expect(reasonElement).toBeVisible()
    expect(reasonElement.textContent).toContain('Empfehlung')
  })

  it('renders exactly one short reason line for red wheels with dynamic threshold formatting', () => {
    const redWheel = {
      ...measurement.wheels[0],
      evaluation: {
        ...measurement.wheels[0].evaluation,
        status: 'URGENT' as const,
        reasonCodes: ['TREAD_BELOW_LEGAL_MINIMUM'] as ReasonCode[],
        thresholds: { ordinaryMinimumMm: 2, legalMinimumMm: 2, recommendedBelowMm: 4 },
      },
    }
    render(<TyreReport measurement={{ ...measurement, worstStatus: 'URGENT', wheels: [redWheel] }} />)
    const wheel = screen.getByRole('article', { name: 'Vorne links' })
    expect(within(wheel).getByText('Unter 2 mm: gesetzliches Minimum')).toBeVisible()
  })

  it('selects the worst reason when multiple reason codes are present on amber and red wheels', () => {
    // Amber wheel: tread replacement (50) vs dot check (20) -> tread replacement wins
    const amberWheel = {
      ...measurement.wheels[0],
      evaluation: {
        ...measurement.wheels[0].evaluation,
        status: 'RECOMMENDED' as const,
        reasonCodes: ['DOT_CONDITION_CHECK_RECOMMENDED', 'TREAD_REPLACEMENT_RECOMMENDED'] as ReasonCode[],
      },
    }
    // Red wheel: tread below legal min (100) vs winter insufficient (90) -> tread below legal min wins
    const redWheel = {
      ...measurement.wheels[1],
      evaluation: {
        ...measurement.wheels[1].evaluation,
        status: 'URGENT' as const,
        reasonCodes: ['AT_WINTER_TREAD_INSUFFICIENT', 'TREAD_BELOW_LEGAL_MINIMUM'] as ReasonCode[],
        thresholds: { ordinaryMinimumMm: 1.6, legalMinimumMm: 4, recommendedBelowMm: 4 },
      },
    }
    render(<TyreReport measurement={{ ...measurement, wheels: [amberWheel, redWheel] }} />)
    const amberArticle = screen.getByRole('article', { name: 'Vorne links' })
    expect(within(amberArticle).getByText('Empfehlung: Austausch (Profil)')).toBeVisible()
    expect(within(amberArticle).queryByText(/Alter prüfen/)).not.toBeInTheDocument()

    const redArticle = screen.getByRole('article', { name: 'Vorne rechts' })
    expect(within(redArticle).getByText('Unter 1,6 mm: gesetzliches Minimum')).toBeVisible()
    expect(within(redArticle).queryByText(/kein Winterreifen mehr/)).not.toBeInTheDocument()
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
