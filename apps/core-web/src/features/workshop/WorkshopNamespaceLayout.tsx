import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { PageLoader } from '@/components/ui/PageLoader'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'

/** Loads the lazy `workshop` namespace before rendering workshop/mechanic routes. */
export function WorkshopNamespaceLayout() {
  const [ready, setReady] = useState(() => i18n.hasResourceBundle(i18n.language, 'workshop'))

  useEffect(() => {
    if (ready) return
    void ensureNamespaceLoaded('workshop').then(() => setReady(true))
  }, [ready])

  if (!ready) {
    return <PageLoader />
  }

  return <Outlet />
}
