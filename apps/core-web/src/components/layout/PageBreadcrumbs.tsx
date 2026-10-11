import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { PageContainer } from '@/components/layout/PageContainer'
import type { BreadcrumbItem } from '@/components/navigation/Breadcrumbs'

type PageBreadcrumbsContextValue = {
  breadcrumbs: BreadcrumbItem[] | undefined
  setBreadcrumbs: (breadcrumbs: BreadcrumbItem[] | undefined) => void
}

// Outside a provider (a page rendered on its own, e.g. in a unit test) publishing does nothing.
const PageBreadcrumbsContext = createContext<PageBreadcrumbsContextValue>({
  breadcrumbs: undefined,
  setBreadcrumbs: () => undefined,
})

/** Holds the trail a routed page publishes with `usePageBreadcrumbs`, for `PageContainerWithBreadcrumbs`. */
export function PageBreadcrumbsProvider({ children }: { children: ReactNode }) {
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[] | undefined>(undefined)
  const value = useMemo(() => ({ breadcrumbs, setBreadcrumbs }), [breadcrumbs])
  return <PageBreadcrumbsContext.Provider value={value}>{children}</PageBreadcrumbsContext.Provider>
}

/** The setter a page uses to publish its trail. Its identity is stable across renders. */
export function usePageBreadcrumbsSetter() {
  return useContext(PageBreadcrumbsContext).setBreadcrumbs
}

/** Page container that renders whichever trail the current page has published. */
export function PageContainerWithBreadcrumbs({ children }: { children: ReactNode }) {
  const { breadcrumbs } = useContext(PageBreadcrumbsContext)
  return <PageContainer breadcrumbs={breadcrumbs}>{children}</PageContainer>
}
