import { i18n } from '@/lib/i18n'
import { LAZY_NAMESPACES } from '@/lib/i18n/constants'

/** Removes lazy bundles so specs mirror production (preload-only) i18n init. */
export function stripLazyNamespacesForTest(): void {
  for (const namespace of LAZY_NAMESPACES) {
    for (const language of ['de', 'en'] as const) {
      if (i18n.hasResourceBundle(language, namespace)) {
        i18n.removeResourceBundle(language, namespace)
      }
    }
  }
}
