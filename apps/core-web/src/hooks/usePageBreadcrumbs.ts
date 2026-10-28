import { useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { usePageBreadcrumbsSetter } from '@/components/layout/PageBreadcrumbs'
import { getRouteSectionTitle } from '@/lib/document-title'

/**
 * Publishes the breadcrumb trail for a detail page: its list, titled from the route table as the
 * document title is, then the current entity. Pass a placeholder `currentLabel` while the entity
 * loads. The trail clears when the page unmounts.
 *
 * The trail is written in a layout effect, so it is in place before the browser paints the page.
 */
export function usePageBreadcrumbs({ listPath, currentLabel }: { listPath: string; currentLabel: string }) {
  const setBreadcrumbs = usePageBreadcrumbsSetter()
  const { i18n } = useTranslation('nav')

  useLayoutEffect(() => {
    setBreadcrumbs([{ label: getRouteSectionTitle(listPath), to: listPath }, { label: currentLabel }])
    return () => setBreadcrumbs(undefined)
  }, [setBreadcrumbs, listPath, currentLabel, i18n.language])
}
