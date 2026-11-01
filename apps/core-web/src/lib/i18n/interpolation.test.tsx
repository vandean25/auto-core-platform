import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Trans, useTranslation } from 'react-i18next'
import { i18n, SafeTrans } from '@/lib/i18n'

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

  it('renders allowed HTML tags and numbered slots inside SafeTrans as plain text without creating extra elements', () => {
    const injection = '<strong>bold</strong> and <br /> with <1>slot</1> and <p>paragraph</p>'

    function SafeTransComponent() {
      const { t } = useTranslation('settings')
      return (
        <div data-testid="safe-trans-target">
          <SafeTrans
            t={t}
            i18nKey="labor.categories.editDialog.description"
            values={{ name: injection }}
            components={{ strong: <strong /> }}
          />
        </div>
      )
    }

    const { container } = render(<SafeTransComponent />)

    // Only the single outer <strong> wrapper mapped by components should exist
    const strongElements = container.querySelectorAll('strong')
    expect(strongElements).toHaveLength(1)
    expect(container.querySelector('br')).toBeNull()
    expect(container.querySelector('p')).toBeNull()

    // The text content should be unchanged plain text containing the literal tags
    const target = screen.getByTestId('safe-trans-target')
    expect(target.textContent).toBe(
      'Aktualisieren Sie die Details für <strong>bold</strong> and <br /> with <1>slot</1> and <p>paragraph</p>.',
    )
    expect(strongElements[0]?.textContent).toBe(injection)
  })

  it('renders special characters in SafeTrans values unchanged without entity encoding', () => {
    const nameWithSpecialChars = 'Halle A/B & "x" \'y\''

    function SafeTransComponent() {
      const { t } = useTranslation('settings')
      return (
        <div data-testid="special-chars-target">
          <SafeTrans
            t={t}
            i18nKey="labor.categories.editDialog.description"
            values={{ name: nameWithSpecialChars }}
            components={{ strong: <strong /> }}
          />
        </div>
      )
    }

    const { container } = render(<SafeTransComponent />)
    const strong = container.querySelector('strong')
    expect(strong?.textContent).toBe('Halle A/B & "x" \'y\'')
    expect(strong?.textContent).not.toContain('&#x2F;')
    expect(strong?.textContent).not.toContain('&amp;')
    expect(strong?.textContent).not.toContain('&quot;')
    expect(strong?.textContent).not.toContain('&#39;')
    expect(strong?.textContent).not.toContain('&#27;')
  })

  it('renders entity names with allowed tags and special characters safely in accountingExport headers with SafeTrans', () => {
    const entityName = 'Auto <br> <strong>Repair</strong> & "Co" <1>slot</1>'

    function ExportHeaderComponent() {
      const { t } = useTranslation('settings')
      return (
        <div data-testid="export-header-target">
          <SafeTrans
            t={t}
            i18nKey="accountingExport.header.selected"
            values={{ name: entityName }}
            components={{ name: <span className="font-medium text-slate-700" /> }}
          />
        </div>
      )
    }

    const { container } = render(<ExportHeaderComponent />)
    expect(container.querySelector('br')).toBeNull()
    expect(container.querySelector('strong')).toBeNull()

    const nameSpan = container.querySelector('span')
    expect(nameSpan?.textContent).toBe(entityName)
    expect(nameSpan?.textContent).not.toContain('&amp;')
    expect(nameSpan?.textContent).not.toContain('&quot;')
  })

  it('renders plain text when passing shouldUnescape and escapeValue:true directly to Trans', () => {
    const injection = '<strong>allowed tag</strong> <br /> <1>slot</1>'

    function DirectTransComponent() {
      const { t } = useTranslation('settings')
      return (
        <div data-testid="direct-trans-target">
          <Trans
            t={t}
            i18nKey="labor.categories.editDialog.description"
            values={{ name: injection }}
            components={{ strong: <strong /> }}
            shouldUnescape
            tOptions={{ interpolation: { escapeValue: true } }}
          />
        </div>
      )
    }

    const { container } = render(<DirectTransComponent />)
    expect(container.querySelectorAll('strong')).toHaveLength(1)
    expect(container.querySelector('br')).toBeNull()

    const strong = container.querySelector('strong')
    expect(strong?.textContent).toBe(injection)
  })
})
