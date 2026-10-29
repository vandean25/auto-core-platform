/**
 * The tenant and site an order link from a push belongs to (ADR-0033 §5). The two query parameters are routing hints,
 * never authorization: the app compares them with the active context and switches through the normal flows, which the
 * server validates against the user's memberships. The names match `PUSH_LINK_*_PARAM` on the server.
 */
const TENANT_PARAM = 'pushTenant'
const SITE_PARAM = 'pushSite'

export type PushLinkContext = { tenantId: string | null; siteId: string | null }

export function readPushLinkContext(search: string): PushLinkContext | null {
  const params = new URLSearchParams(search)
  const tenantId = params.get(TENANT_PARAM)
  const siteId = params.get(SITE_PARAM)
  return tenantId || siteId ? { tenantId, siteId } : null
}

/** The same address without the two hint parameters. */
export function stripPushLinkContext(location: { pathname: string; search: string; hash: string }): string {
  const params = new URLSearchParams(location.search)
  params.delete(TENANT_PARAM)
  params.delete(SITE_PARAM)
  const rest = params.toString()
  return `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`
}

export type PushLinkStep = 'switch-tenant' | 'wait-sites' | 'switch-site' | 'refuse-site' | 'done'

/** What to do next to bring the app into the context of the link. `siteIds` is null while the user's sites load. */
export function planPushLinkStep(input: {
  context: PushLinkContext
  activeTenantId: string
  activeSiteId: string | null
  siteIds: readonly string[] | null
}): PushLinkStep {
  const { context, activeTenantId, activeSiteId, siteIds } = input
  if (context.tenantId && context.tenantId !== activeTenantId) return 'switch-tenant'
  if (!context.siteId || context.siteId === activeSiteId) return 'done'
  if (siteIds === null) return 'wait-sites'
  return siteIds.includes(context.siteId) ? 'switch-site' : 'refuse-site'
}
