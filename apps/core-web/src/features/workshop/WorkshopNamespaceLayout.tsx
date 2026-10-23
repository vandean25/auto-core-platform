import { Outlet } from 'react-router-dom'
import { PageLoader } from '@/components/ui/PageLoader'
import { useLazyNamespaceBundleReady } from '@/lib/i18n'

/** Loads the lazy `workshop` namespace before rendering workshop/mechanic routes. */
export function WorkshopNamespaceLayout() {
  const bundleStatus = useLazyNamespaceBundleReady(['workshop'])

  if (bundleStatus !== 'ready') {
    return <PageLoader />
  }

  return <Outlet />
}
