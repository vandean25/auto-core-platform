import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'

/**
 * Brand row at the top of the sidebar. It hides in icon mode, where the tenant icon below takes its place.
 * In the mobile sheet it carries the close button, because the sheet's own close control is hidden.
 */
export function AppSidebarHeader() {
  const { t } = useTranslation('nav')
  const { t: tCommon } = useTranslation('common')
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <div className="flex items-center justify-between gap-2 px-2 pt-1 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold tracking-tight">{t('brand.acp')}</span>
        <span className="rounded-md border border-sidebar-border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground">
          {t('brand.workshopBadge')}
        </span>
      </div>
      {isMobile ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={tCommon('actions.close')}
          onClick={() => setOpenMobile(false)}
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}
