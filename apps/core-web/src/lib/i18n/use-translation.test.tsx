import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useTranslation } from '@/lib/i18n/use-translation'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { stripLazyNamespacesForTest } from '@/test/lazy-namespace-test-helpers'

function WorkshopTitleProbe() {
  const { t } = useTranslation('workshop')
  return <p>{t('kpi.title')}</p>
}

describe('useTranslation lazy namespace guard', () => {
  it('renders translated workshop copy instead of raw keys when the bundle was not preloaded', async () => {
    stripLazyNamespacesForTest()

    render(<WorkshopTitleProbe />)

    expect(screen.queryByText('kpi.title')).not.toBeInTheDocument()
    await screen.findByText('Werkstatt diesen Monat')

    await ensureNamespaceLoaded('workshop')
  })
})
