import { Loader2, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MeSite } from '@/api/sites'
import { Button } from '@/components/ui/button'
import { ReadOnlyCurrentSite, SitePicker } from './site-switcher-picker'

type SiteSwitcherProps = {
  activeSiteId: string | null
  sites: MeSite[]
  isLoadingSites: boolean
  isSwitching: boolean
  onSwitch: (siteId: string) => void
  collapsed?: boolean
}

/** Current-site switcher (UX Compliance / Site switcher). */
export function SiteSwitcher({
  activeSiteId,
  sites,
  isLoadingSites,
  isSwitching,
  onSwitch,
  collapsed = false,
}: SiteSwitcherProps) {
  const { t } = useTranslation('nav')
  const activeSite = sites.find((site) => site.id === activeSiteId) ?? null

  if (sites.length === 0) {
    return null
  }

  if (sites.length === 1 && activeSite) {
    return <ReadOnlyCurrentSite siteName={activeSite.name} collapsed={collapsed} />
  }

  const recoverySite = sites.length === 1 ? sites[0] : null

  const recoveryPrompt = !activeSite
    ? recoverySite
      ? {
          title: t('siteSwitcher.noActiveSite'),
          actionLabel: t('siteSwitcher.activateSite', { name: recoverySite.name }),
          onAction: () => onSwitch(recoverySite.id),
        }
      : { title: t('siteSwitcher.noActiveSite'), actionLabel: null, onAction: null }
    : null

  if (collapsed) {
    if (!activeSite && sites.length > 1) {
      return (
        <div className="px-2 pt-3">
          <SitePicker
            activeSiteId={activeSiteId}
            sites={sites}
            isLoadingSites={isLoadingSites}
            isSwitching={isSwitching}
            onSwitch={onSwitch}
            compact
          />
        </div>
      )
    }
    if (recoveryPrompt?.actionLabel) {
      return (
        <div className="px-2 pt-3">
          <button
            type="button"
            onClick={recoveryPrompt.onAction ?? undefined}
            disabled={isSwitching}
            className="flex h-10 w-full items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300"
            title={recoveryPrompt.actionLabel}
            aria-label={recoveryPrompt.actionLabel}
          >
            {isSwitching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MapPin className="h-4 w-4" />
            )}
          </button>
        </div>
      )
    }
    return (
      <div className="px-2 pt-3">
        <div
          role="img"
          className="flex h-10 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-300"
          title={activeSite?.name ?? t('siteSwitcher.selectSite')}
          aria-label={activeSite?.name ?? t('siteSwitcher.selectSite')}
        >
          <MapPin className="h-4 w-4" />
        </div>
      </div>
    )
  }

  return (
    <section className="px-3 pt-3">
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
        {recoveryPrompt ? (
          recoverySite ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-400">
                  {recoveryPrompt.title}
                </p>
                {recoveryPrompt.actionLabel ? (
                  <p className="truncate text-xs text-slate-400">{t('siteSwitcher.operationalNeedsSite')}</p>
                ) : null}
              </div>
              {recoveryPrompt.actionLabel ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={recoveryPrompt.onAction ?? undefined}
                  disabled={isSwitching}
                  className="shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 hover:text-amber-100"
                >
                  {isSwitching ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {recoveryPrompt.actionLabel}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-400">
                {recoveryPrompt.title}
              </p>
              <p className="truncate text-xs text-slate-400">{t('siteSwitcher.operationalNeedsSite')}</p>
              <SitePicker
                activeSiteId={activeSiteId}
                sites={sites}
                isLoadingSites={isLoadingSites}
                isSwitching={isSwitching}
                onSwitch={onSwitch}
              />
            </div>
          )
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {t('siteSwitcher.currentSite')}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
              <SitePicker
                activeSiteId={activeSiteId}
                sites={sites}
                isLoadingSites={isLoadingSites}
                isSwitching={isSwitching}
                onSwitch={onSwitch}
              />
            </div>
          </>
        )}
      </div>
    </section>
  )
}
