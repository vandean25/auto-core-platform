import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerGermanUiForTests } from '@/test/german-ui'
import { IOS_INSTALL_HINT_DISMISSED_KEY, IosInstallHint, shouldShowIosInstallHint } from './IosInstallHint'

registerGermanUiForTests()

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36'

function setEnvironment(userAgent: string, standalone = false) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: standalone && query === '(display-mode: standalone)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('IosInstallHint', () => {
  it('shows the Add to Home Screen steps once on Safari for iOS and remembers the dismissal', () => {
    setEnvironment(IPHONE_SAFARI)
    const first = render(<IosInstallHint />)

    expect(screen.getByRole('dialog')).toHaveTextContent('Zum Home-Bildschirm')
    fireEvent.click(screen.getByRole('button', { name: 'Verstanden' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY)).toBe('1')

    first.unmount()
    render(<IosInstallHint />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not bring the sheet back after a reload with it still open', () => {
    setEnvironment(IPHONE_SAFARI)
    const first = render(<IosInstallHint />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    first.unmount()
    render(<IosInstallHint />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('counts closing the sheet as a dismissal and its button is 44px', () => {
    setEnvironment(IPHONE_SAFARI)
    render(<IosInstallHint />)

    expect(screen.getByRole('button', { name: 'Verstanden' })).toHaveClass('min-h-11')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(window.localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY)).toBe('1')
  })

  it('stays hidden in the installed app, on other browsers and when storage is unavailable', () => {
    setEnvironment(IPHONE_SAFARI, true)
    expect(shouldShowIosInstallHint()).toBe(false)

    setEnvironment(ANDROID_CHROME)
    expect(shouldShowIosInstallHint()).toBe(false)

    setEnvironment(IPHONE_SAFARI)
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('blocked')
      },
    })
    try {
      expect(shouldShowIosInstallHint()).toBe(false)
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original)
    }
  })
})
