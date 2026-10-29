import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { StatusBadge } from '@/components/status/StatusBadge'
import { changeUiLanguage } from '@/lib/i18n'
import { formatStatusLabel } from '@/lib/i18n/enum-labels'
import { registerGermanUiForTests } from '@/test/german-ui'

registerGermanUiForTests()
afterEach(cleanup)

const TONE_CLASSES = {
  success: ['border-success/30', 'bg-success/10', 'text-success'],
  warning: ['border-warning/40', 'bg-warning/10', 'text-warning'],
  info: ['border-info/30', 'bg-info/10', 'text-info'],
  destructive: ['border-destructive/30', 'bg-destructive/10', 'text-destructive'],
  neutral: ['border-border', 'bg-muted', 'text-muted-foreground'],
} as const

describe('StatusBadge tones (AUT-655)', () => {
  it.each([
    ['COMPLETED', 'success'],
    ['IN_PROGRESS', 'warning'],
    ['CONFIRMED', 'info'],
    ['CANCELLED', 'destructive'],
    ['DRAFT', 'neutral'],
    ['EXPIRED', 'neutral'],
    ['ESTIMATE_EXPIRED', 'warning'],
    ['STATUS_WITHOUT_MAPPING', 'neutral'],
  ] as const)('renders %s with the %s tone', (status, tone) => {
    render(<StatusBadge status={status} />)

    expect(screen.getByText(formatStatusLabel(status))).toHaveClass(...TONE_CLASSES[tone])
  })

  it('shows an explicit label instead of the status label', () => {
    render(<StatusBadge status="COMPLETED" label="Fertig" />)

    expect(screen.getByText('Fertig')).toHaveClass(...TONE_CLASSES.success)
  })

  it.each(Object.keys(TONE_CLASSES) as Array<keyof typeof TONE_CLASSES>)(
    'uses theme tokens only for the %s tone',
    (tone) => {
      const status = { success: 'PAID', warning: 'PENDING', info: 'SENT', destructive: 'FAILED', neutral: 'DRAFT' }[tone]
      render(<StatusBadge status={status} />)

      const className = screen.getByText(formatStatusLabel(status)).className
      expect(className).not.toMatch(/\b(?:slate|gray|zinc|red|rose|amber|emerald|green|sky|blue|cyan|indigo|violet|purple)-\d/)
    },
  )

  it('re-renders its label when the UI language changes', async () => {
    render(<StatusBadge status="IN_STOCK" />)
    expect(screen.getByText('Auf Lager')).toBeInTheDocument()

    await act(async () => {
      await changeUiLanguage('en')
    })
    expect(screen.getByText('In Stock')).toBeInTheDocument()

    await act(async () => {
      await changeUiLanguage('de')
    })
    expect(screen.getByText('Auf Lager')).toBeInTheDocument()
  })
})
