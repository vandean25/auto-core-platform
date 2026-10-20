import { useTranslation } from 'react-i18next'

/** Brand row at the top of the sidebar. It hides in icon mode, where the tenant icon below takes its place. */
export function AppSidebarHeader() {
  const { t } = useTranslation('nav')

  return (
    <div className="flex items-center justify-between gap-2 px-2 pt-1 group-data-[collapsible=icon]:hidden">
      <span className="text-base font-semibold tracking-tight">{t('brand.acp')}</span>
      <span className="rounded-md border border-sidebar-border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground">
        {t('brand.workshopBadge')}
      </span>
    </div>
  )
}
