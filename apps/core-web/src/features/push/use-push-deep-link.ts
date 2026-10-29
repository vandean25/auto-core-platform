import * as React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { planPushLinkStep, readPushLinkContext, stripPushLinkContext } from './push-deep-link'

export type PushTenantSwitchResult = 'switched' | 'prompted' | 'failed'

type Options = {
  /** False until the session is loaded: the active tenant and site are not known before. */
  enabled: boolean
  activeTenantId: string
  activeSiteId: string | null
  /** The ids of the sites the user may work in, or null while they load. */
  siteIds: readonly string[] | null
  /** The shell's authorized tenant switch (it may ask about unsynced offline data first). */
  requestTenantSwitch: (tenantId: string) => Promise<PushTenantSwitchResult>
  switchSite: (siteId: string) => Promise<unknown>
  onRefused: () => void
}

/**
 * Opens an order link from a push in the right tenant and site. While the app still has to switch, `resolving` is true
 * and the caller shows a loader instead of the page, so the order is never requested in the wrong context. Once the
 * context matches, the hint parameters are removed from the address. A refused or failed switch ends on the start page.
 */
export function usePushDeepLink(options: Options) {
  const location = useLocation()
  const navigate = useNavigate()
  const context = readPushLinkContext(location.search)
  const attempted = React.useRef<string | null>(null)
  const latest = React.useRef(options)
  React.useEffect(() => {
    latest.current = options
  })

  const step = context && options.enabled
    ? planPushLinkStep({
        context,
        activeTenantId: options.activeTenantId,
        activeSiteId: options.activeSiteId,
        siteIds: options.siteIds,
      })
    : null

  const hasContext = context !== null
  const abandon = React.useCallback(() => {
    // Only a link from a push is abandoned; an ordinary cancelled switch leaves the page alone.
    if (!hasContext) return
    attempted.current = null
    navigate('/', { replace: true })
  }, [navigate, hasContext])

  React.useEffect(() => {
    if (!context || !step || step === 'wait-sites') return
    const attemptKey = `${step}:${context.tenantId}:${context.siteId}`
    if (step === 'done') {
      attempted.current = null
      navigate(stripPushLinkContext(location), { replace: true })
      return
    }
    if (step === 'refuse-site') {
      latest.current.onRefused()
      abandon()
      return
    }
    if (attempted.current === attemptKey) return
    attempted.current = attemptKey
    const run =
      step === 'switch-tenant'
        ? latest.current.requestTenantSwitch(context.tenantId as string).then((result) => result !== 'failed')
        : latest.current
            .switchSite(context.siteId as string)
            .then(() => true)
            .catch(() => false)
    void run.then((ok) => {
      if (!ok) abandon()
    })
  }, [context, step, location, navigate, abandon])

  return { resolving: hasContext, abandon }
}
