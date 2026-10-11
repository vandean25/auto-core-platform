import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { formatDocumentTitle, getRouteSectionTitle } from '@/lib/document-title'

/**
 * Titles a detail page with its entity, e.g. `WO-2026-0002 - Workshop Orders - Auto Core`.
 * Pass `undefined` while the entity loads; the route's section title still applies.
 * List pages need no call here: `RouteTitle` sets their default title.
 */
export function useDocumentTitle(entity?: string | null) {
  const { pathname } = useLocation()

  useEffect(() => {
    document.title = formatDocumentTitle([entity, getRouteSectionTitle(pathname)])
  }, [entity, pathname])
}
