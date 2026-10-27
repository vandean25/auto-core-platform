import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useInstallPrompt } from '@/pwa/install-prompt'

/** "Install app" in the user menu, once the browser offers the install prompt (Android/Chrome). Never a modal on load. */
export function InstallAppMenuItem() {
  const { t } = useTranslation('nav')
  const { canInstall, promptInstall } = useInstallPrompt()

  if (!canInstall) return null

  return (
    <DropdownMenuItem className="min-h-11" onSelect={() => void promptInstall()}>
      <Download aria-hidden="true" />
      <span className="flex-1">{t('install.installApp')}</span>
    </DropdownMenuItem>
  )
}
