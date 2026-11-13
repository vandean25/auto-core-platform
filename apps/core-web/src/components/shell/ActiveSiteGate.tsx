import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { subscribeActiveSiteRequired } from '@/api/active-site-required'
import type { MeSite } from '@/api/sites'
import { Button } from '@/components/ui/button'
import { PageLoader } from '@/components/ui/PageLoader'

type ActiveSiteGateState = {
  activeSiteId: string | null
  sites: MeSite[]
  sitesLoading: boolean
  sitesFailed: boolean
  onPickSite: (siteId: string) => void
  onRetrySites: () => void
}

const ActiveSiteGateContext = React.createContext<ActiveSiteGateState | null>(null)

/** Session site and the user's sites for {@link ActiveSiteOutlet}. Placed above the shell, so the chrome stays put. */
export function ActiveSiteGateProvider({ children, ...state }: ActiveSiteGateState & { children: React.ReactNode }) {
  return <ActiveSiteGateContext.Provider value={state}>{children}</ActiveSiteGateContext.Provider>
}

/** True after a 422 `ACTIVE_SITE_REQUIRED`, until the session site changes. */
function useActiveSiteRequired(activeSiteId: string | null): boolean {
  const [flagged, setFlagged] = React.useState<{ siteId: string | null } | null>(null)
  React.useEffect(
    () => subscribeActiveSiteRequired(() => setFlagged({ siteId: activeSiteId })),
    [activeSiteId],
  )
  return flagged !== null && flagged.siteId === activeSiteId
}

type GateView = 'page' | 'loading' | 'failed' | 'picker'

function resolveGateView(gate: ActiveSiteGateState, siteRequired: boolean): GateView {
  if (gate.activeSiteId && !siteRequired) return 'page'
  if (gate.sitesLoading) return 'loading'
  if (gate.sitesFailed) return 'failed'
  // Users without any site keep the pages that need none, until the API asks for a site.
  if (!siteRequired && gate.sites.length === 0) return 'page'
  return 'picker'
}

/**
 * AUT-979: wraps the routed page. Without a session site (or after the API answered 422 `ACTIVE_SITE_REQUIRED`)
 * the page is replaced by the site picker, so no page waits on a list that cannot load. Sidebar, sign-out, tenant
 * switch and toasts stay around it. Without a provider (tests of a bare shell) it renders the page.
 */
export function ActiveSiteOutlet({ children }: { children: React.ReactNode }) {
  const gate = React.useContext(ActiveSiteGateContext)
  const siteRequired = useActiveSiteRequired(gate?.activeSiteId ?? null)
  if (!gate) return children

  const view = resolveGateView(gate, siteRequired)
  if (view === 'page') return children
  if (view === 'loading') return <PageLoader />
  return <ActiveSitePicker sites={gate.sites} failed={view === 'failed'} gate={gate} />
}

function ActiveSitePicker({
  sites,
  failed,
  gate,
}: {
  sites: MeSite[]
  failed: boolean
  gate: ActiveSiteGateState
}) {
  const { t } = useTranslation(['nav', 'common'])

  return (
    <section aria-labelledby="active-site-picker-title" className="mx-auto w-full max-w-sm space-y-3 py-6">
      <h1 id="active-site-picker-title" className="text-lg font-semibold tracking-tight">
        {t('nav:siteSwitcher.chooseSite')}
      </h1>
      {failed ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('nav:siteSwitcher.sitesLoadFailed')}</p>
          <Button type="button" variant="outline" className="min-h-11" onClick={gate.onRetrySites}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : null}
      {!failed && sites.length === 0 ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {t('nav:siteSwitcher.noSiteAvailable')}
        </p>
      ) : null}
      {!failed && sites.length > 0 ? (
        <ul className="max-h-[70vh] space-y-2 overflow-y-auto">
          {sites.map((site) => (
            <li key={site.id}>
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-11 w-full justify-between gap-3"
                aria-label={t('nav:siteSwitcher.activateSite', { name: site.name })}
                onClick={() => gate.onPickSite(site.id)}
              >
                <span className="truncate">{site.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{site.code}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
