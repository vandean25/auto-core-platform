import { useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { getRouteDocumentTitle, getRouteSectionTitle } from '@/lib/document-title'

/**
 * Sets each route's default document title and announces route changes to screen readers
 * (WCAG 4.1.3). Focus is not moved.
 *
 * The title is written in a layout effect. Layout effects run before any page-level
 * `useDocumentTitle` effect from the same commit, so a page's entity title is never
 * overwritten by the route default.
 */
export function RouteTitle() {
  const { pathname } = useLocation()
  const { t, i18n } = useTranslation('nav')

  useLayoutEffect(() => {
    document.title = getRouteDocumentTitle(pathname)
  }, [pathname, i18n.language])

  // A plain polite live region, not role="status": other status regions (e.g. the version banner)
  // must keep their own role query and count.
  return <p aria-live="polite" className="sr-only">{t('aria.navigatedTo', { title: getRouteSectionTitle(pathname) })}</p>
}
