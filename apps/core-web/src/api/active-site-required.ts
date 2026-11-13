import { getClientSessionGeneration } from '@/auth/client-session-reset'

/**
 * AUT-979: a 422 `ACTIVE_SITE_REQUIRED` means the session has no usable site. Every request goes through
 * `fetchWithAuth`, which reports such answers here, so the shell can ask for a site instead of leaving the page
 * in its loading state.
 */
const ACTIVE_SITE_REQUIRED = 'ACTIVE_SITE_REQUIRED'

type Listener = () => void

const listeners = new Set<Listener>()

/** Scope-context answers carry the code in `code`, SiteContextService in `error`. */
function namesActiveSiteRequired(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const { code, error } = body as { code?: unknown; error?: unknown }
  return code === ACTIVE_SITE_REQUIRED || error === ACTIVE_SITE_REQUIRED
}

/**
 * Reads a copy of the body, so the caller can still read the response itself. `startedInGeneration` is the client
 * session generation when the request was sent: an answer to a request of an earlier tenant or site (every switch
 * moves the generation on) says nothing about the current site and is ignored.
 */
export async function reportIfActiveSiteRequired(response: Response, startedInGeneration: number): Promise<void> {
  if (response.status !== 422) return
  try {
    const body: unknown = await response.clone().json()
    if (startedInGeneration !== getClientSessionGeneration()) return
    if (namesActiveSiteRequired(body)) listeners.forEach((listener) => listener())
  } catch {
    // Not JSON: not this error.
  }
}

export function subscribeActiveSiteRequired(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
