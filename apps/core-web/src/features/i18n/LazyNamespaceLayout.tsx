import { Outlet, useLocation } from 'react-router-dom'
import type { LazyNamespace } from '@/lib/i18n/constants'
import { LocaleBundleLoadFailed, useLazyNamespaceBundleReady } from '@/lib/i18n'
import { RoutePendingFallback } from '@/app/RoutePendingFallback'

type Props = {
  namespaces: readonly LazyNamespace[]
}

/** Blocks child routes until the listed lazy i18n bundles are ready for the active language. */
export function LazyNamespaceLayout({ namespaces }: Props) {
  const location = useLocation()
  const { status, retry } = useLazyNamespaceBundleReady(namespaces)

  if (status === 'loading') {
    return <RoutePendingFallback pathname={location.pathname} />
  }
  if (status === 'failed') {
    return <LocaleBundleLoadFailed onRetry={retry} />
  }

  return <Outlet />
}
