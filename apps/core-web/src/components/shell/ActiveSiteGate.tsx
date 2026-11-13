import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { subscribeActiveSiteRequired } from '@/api/active-site-required'
import type { MeSite } from '@/api/sites'
import { Button } from '@/components/ui/button'
import { ClientSessionLoadingScreen } from './ClientSessionLoadingScreen'

/** True after a 422 `ACTIVE_SITE_REQUIRED`, until the session site changes. */
function useActiveSiteRequired(activeSiteId: string | null): boolean {
  const [flagged, setFlagged] = React.useState<{ siteId: string | null } | null>(null)
  React.useEffect(
    () => subscribeActiveSiteRequired(() => setFlagged({ siteId: activeSiteId })),
    [activeSiteId],
  )
  return flagged !== null && flagged.siteId === activeSiteId
}

type ActiveSiteGateProps = {
  activeSiteId: string | null
  sites: MeSite[]
  sitesLoading: boolean
  onPickSite: (siteId: string) => void
  children: React.ReactNode
}

/**
 * AUT-979: the pages render only with a session site. Without one (or after the API answered 422
 * `ACTIVE_SITE_REQUIRED`) the user picks one of their sites first, so no page waits on a list that cannot load.
 * Users without any site keep the pages that need none.
 */
export function ActiveSiteGate({ activeSiteId, sites, sitesLoading, onPickSite, children }: ActiveSiteGateProps) {
  const siteRequired = useActiveSiteRequired(activeSiteId)

  if (activeSiteId && !siteRequired) return children
  if (sitesLoading) return <ClientSessionLoadingScreen />
  if (!siteRequired && sites.length === 0) return children
  return <ActiveSitePicker sites={sites} onPickSite={onPickSite} />
}

function ActiveSitePicker({ sites, onPickSite }: { sites: MeSite[]; onPickSite: (siteId: string) => void }) {
  const { t } = useTranslation('nav')

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-6">
      <section aria-labelledby="active-site-picker-title" className="w-full max-w-sm space-y-3">
        <h1 id="active-site-picker-title" className="text-lg font-semibold tracking-tight">
          {t('siteSwitcher.chooseSite')}
        </h1>
        {sites.length === 0 ? (
          <p role="alert" className="text-sm text-slate-500">
            {t('siteSwitcher.noSiteAvailable')}
          </p>
        ) : (
          <ul className="max-h-[70vh] space-y-2 overflow-y-auto">
            {sites.map((site) => (
              <li key={site.id}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-between gap-3"
                  aria-label={t('siteSwitcher.activateSite', { name: site.name })}
                  onClick={() => onPickSite(site.id)}
                >
                  <span className="truncate">{site.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">{site.code}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
