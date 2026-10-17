import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { formatDocumentTitle, getRouteSectionTitle } from '@/lib/document-title'

/**
 * Titles a detail page with its entity, e.g. `WO-2026-0002 - Workshop Orders - Auto Core`.
 * Pass `undefined` while the entity loads; the route's section title still applies.
 * List pages need no call here: `RouteTitle` sets their default title.
 *
 * The pathname comes from the nearest `<Routes location>` provider. AnimatePresence keeps an
 * outgoing page mounted during its exit animation, and that page keeps its own route this way,
 * so it cannot overwrite the title of the route that replaced it.
 */
type UseDocumentTitleOptions = {
  /** When false, only `entity` and the app name are used (no route section suffix). */
  includeRouteSection?: boolean
}

export function useDocumentTitle(
  entity?: string | null,
  options?: UseDocumentTitleOptions,
) {
  const { pathname } = useLocation()
  const includeRouteSection = options?.includeRouteSection ?? true

  useEffect(() => {
    const parts = includeRouteSection
      ? [entity, getRouteSectionTitle(pathname)]
      : [entity]
    document.title = formatDocumentTitle(parts)
  }, [entity, includeRouteSection, pathname])
}
