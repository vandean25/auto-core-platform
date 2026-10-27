import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { captureInstallPrompt, isIosSafari, useInstallPrompt } from './install-prompt'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const IPAD_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const MAC_SAFARI = IPAD_SAFARI
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.0.0 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36'

describe('isIosSafari', () => {
  it('detects Safari on iPhone and on iPad (a Mac with a touch screen)', () => {
    expect(isIosSafari(IPHONE_SAFARI, 5)).toBe(true)
    expect(isIosSafari(IPAD_SAFARI, 5)).toBe(true)
  })

  it('ignores other iOS browsers, Android and Safari on a Mac', () => {
    expect(isIosSafari(IPHONE_CHROME, 5)).toBe(false)
    expect(isIosSafari(ANDROID_CHROME, 5)).toBe(false)
    expect(isIosSafari(MAC_SAFARI, 0)).toBe(false)
  })
})

function installPromptEvent() {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' }>
  }
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome: 'accepted' })
  return event
}

function setDisplayMode(standalone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: standalone && query === '(display-mode: standalone)',
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

describe('useInstallPrompt', () => {
  beforeAll(() => captureInstallPrompt())
  afterEach(() => {
    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    cleanup()
  })

  it('offers the install action once the browser fires beforeinstallprompt, and uses the prompt once', async () => {
    setDisplayMode(false)
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.canInstall).toBe(false)

    const event = installPromptEvent()
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(result.current.canInstall).toBe(true)

    await act(async () => {
      await result.current.promptInstall()
    })
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(result.current.canInstall).toBe(false)
  })

  it('goes away when the app gets installed', () => {
    setDisplayMode(false)
    const { result } = renderHook(() => useInstallPrompt())
    act(() => {
      window.dispatchEvent(installPromptEvent())
    })
    expect(result.current.canInstall).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    expect(result.current.canInstall).toBe(false)
  })

  it('stays hidden in the installed app (display-mode standalone)', () => {
    setDisplayMode(true)
    const { result } = renderHook(() => useInstallPrompt())

    act(() => {
      window.dispatchEvent(installPromptEvent())
    })

    expect(result.current.canInstall).toBe(false)
  })
})
