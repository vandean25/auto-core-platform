/**
 * The tab that switches the site already refetches the session and the site-owned queries itself. The server also
 * emits `site:context_updated` to that tab; it is the only event the realtime sync may skip. Every other tab (or a
 * second window of the same user) must refetch, whatever its cached session says: the session query can refetch on
 * focus before the event arrives and then already show the new site while the site-owned data is still the old one's.
 */
const LOCAL_SWITCH_TTL_MS = 15_000

let pending: { siteId: string | null; at: number } | null = null

/** Call before the switch request is sent: the event can arrive before the response. */
export function markLocalSiteSwitch(siteId: string | null, now = Date.now()) {
  pending = { siteId, at: now }
}

export function clearLocalSiteSwitch() {
  pending = null
}

/** True once for the event that answers this tab's own switch. */
export function consumeLocalSiteSwitch(siteId: string | null, now = Date.now()): boolean {
  const isOwn = pending !== null && pending.siteId === siteId && now - pending.at <= LOCAL_SWITCH_TTL_MS
  if (isOwn) pending = null
  return isOwn
}
