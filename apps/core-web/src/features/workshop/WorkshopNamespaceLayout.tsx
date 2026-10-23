import { Outlet } from 'react-router-dom'
import { PageLoader } from '@/components/ui/PageLoader'
import { LocaleBundleLoadFailed, useLazyNamespaceBundleReady } from '@/lib/i18n'

/** Loads the lazy `workshop` namespace before rendering workshop/mechanic routes. */
export function WorkshopNamespaceLayout() {
  const { status, retry } = useLazyNamespaceBundleReady(['workshop'])

  if (status === 'loading') {
    return <PageLoader />
  }
  if (status === 'failed') {
    return <LocaleBundleLoadFailed onRetry={retry} />
  }

  return <Outlet />
}
