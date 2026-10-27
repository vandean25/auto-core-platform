import { useState } from 'react'
import { Share } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { isIosSafari, isStandaloneDisplay } from '@/pwa/install-prompt'

export const IOS_INSTALL_HINT_DISMISSED_KEY = 'acp:ios-install-hint-dismissed'

/** Safari on iOS has no install prompt: show the "Add to Home Screen" steps once per device, never in the installed app. */
export function shouldShowIosInstallHint(): boolean {
  try {
    return (
      isIosSafari(navigator.userAgent, navigator.maxTouchPoints) &&
      !isStandaloneDisplay() &&
      window.localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY) === null
    )
  } catch {
    return false
  }
}

export function IosInstallHint() {
  const { t } = useTranslation('nav')
  const [open, setOpen] = useState(shouldShowIosInstallHint)

  const dismiss = () => {
    try {
      window.localStorage.setItem(IOS_INSTALL_HINT_DISMISSED_KEY, '1')
    } catch {
      // Private mode: the hint may show again next time.
    }
    setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{t('install.iosTitle')}</SheetTitle>
          <SheetDescription>{t('install.iosIntro')}</SheetDescription>
        </SheetHeader>
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm">
          <li>
            <span className="inline-flex items-center gap-1.5">
              {t('install.iosStepShare')} <Share className="h-4 w-4" aria-hidden="true" />
            </span>
          </li>
          <li>{t('install.iosStepAdd')}</li>
          <li>{t('install.iosStepConfirm')}</li>
        </ol>
        <Button className="mt-6 min-h-11 w-full" onClick={dismiss}>
          {t('install.iosDismiss')}
        </Button>
      </SheetContent>
    </Sheet>
  )
}
