import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Trans, useTranslation } from 'react-i18next'
import { i18n } from '@/lib/i18n'

describe('i18n interpolation escaping (AUT-838)', () => {
  it('renders special characters (/ & < > \' ") unchanged in translated strings', () => {
    const raw = "205/55 R16 91H & <M+S> 'XL' \"PRO\""
    const translated = i18n.t('inventory:tyreStorage.detail.dimension', { value: raw })

    expect(translated).toBe("Dimension: 205/55 R16 91H & <M+S> 'XL' \"PRO\"")
    expect(translated).not.toContain('&#x2F;')
    expect(translated).not.toContain('&amp;')
    expect(translated).not.toContain('&lt;')
    expect(translated).not.toContain('&gt;')
    expect(translated).not.toContain('&#39;')
    expect(translated).not.toContain('&#27;')
    expect(translated).not.toContain('&quot;')
  })

  it('renders tyre storage locations with slashes (e.g. Halle A/B) without HTML escaping', () => {
    const result = i18n.t('inventory:shared.locationCodeName', {
      code: 'LOC-1',
      name: 'Halle A/B',
    })

    expect(result).toBe('LOC-1 — Halle A/B')
    expect(result).not.toContain('&#x2F;')
  })

  it('renders HTML injection strings as plain text and not as HTML elements in React DOM', () => {
    const injection = '<img src=x onerror=alert(1)>'

    function Component() {
      const { t } = useTranslation('inventory')
      return <div data-testid="target">{t('tyreStorage.detail.dimension', { value: injection })}</div>
    }

    const { container } = render(<Component />)

    // React escapes text children so no <img> element should ever be injected into DOM
    expect(container.querySelector('img')).toBeNull()
    const target = screen.getByTestId('target')
    expect(target.textContent).toBe('Dimension: <img src=x onerror=alert(1)>')
    expect(screen.getByText('Dimension: <img src=x onerror=alert(1)>')).toBeInTheDocument()
  })

  it('renders HTML injection strings as plain text inside Trans components with mapped tags', () => {
    const injection = '<img src=x onerror=alert(1)>'

    function TransComponent() {
      const { t } = useTranslation('settings')
      return (
        <div data-testid="trans-target">
          <Trans
            t={t}
            i18nKey="labor.categories.editDialog.description"
            values={{ name: injection }}
            components={{ strong: <strong /> }}
          />
        </div>
      )
    }

    const { container } = render(<TransComponent />)

    expect(container.querySelector('img')).toBeNull()
    const strong = container.querySelector('strong')
    expect(strong).not.toBeNull()
    expect(strong?.textContent).toBe('<img src=x onerror=alert(1)>')
  })
})
