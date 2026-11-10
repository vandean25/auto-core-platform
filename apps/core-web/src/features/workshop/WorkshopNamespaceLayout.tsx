import { LazyNamespaceLayout } from '@/features/i18n/LazyNamespaceLayout'

/** Loads the lazy `workshop` namespace before rendering workshop/mechanic routes. */
export function WorkshopNamespaceLayout() {
  return <LazyNamespaceLayout namespaces={['workshop']} />
}
