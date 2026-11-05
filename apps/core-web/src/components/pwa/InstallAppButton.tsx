import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useInstallPrompt } from '@/pwa/install-prompt'

/** "Install app" in the header of the mechanic shell, which has no user menu. */
export function InstallAppButton() {
  const { t } = useTranslation('nav')
  const { canInstall, promptInstall } = useInstallPrompt()

  if (!canInstall) return null

  return (
    <button
      type="button"
      onClick={() => void promptInstall()}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 active:bg-muted"
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {t('install.installApp')}
    </button>
  )
}
