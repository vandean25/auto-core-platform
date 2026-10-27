import { useSyncExternalStore } from 'react'

/** Chrome's install prompt event; it is not in the DOM typings. */
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function setDeferredPrompt(next: BeforeInstallPromptEvent | null) {
  deferredPrompt = next
  for (const listener of listeners) listener()
}

/** True when the app already runs as an installed app (home screen icon), where no install hint is shown. */
export function isStandaloneDisplay(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}

/** Safari on iPhone and iPad (iPadOS reports itself as a Mac with a touch screen). Other iOS browsers cannot add to the home screen the same way. */
export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  const isIos = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  return isIos && /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(userAgent)
}

/** Starts capturing the install prompt. Call once at startup: the browser fires the event early. */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    setDeferredPrompt(event as BeforeInstallPromptEvent)
  })
  window.addEventListener('appinstalled', () => setDeferredPrompt(null))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** An "Install app" action once the browser offers it (Android/Chrome); never while the app is already installed. */
export function useInstallPrompt() {
  const prompt = useSyncExternalStore(subscribe, () => deferredPrompt)
  const canInstall = prompt !== null && !isStandaloneDisplay()

  const promptInstall = async () => {
    if (!prompt) return
    // The browser lets each event be used once, so the entry goes away whatever the user chooses.
    setDeferredPrompt(null)
    try {
      await prompt.prompt()
      await prompt.userChoice
    } catch {
      // The browser refused a second use of the event; there is nothing left to offer.
    }
  }

  return { canInstall, promptInstall }
}
