import { useEffect, useState } from 'react'
import type { LazyNamespace } from './constants'
import { ensureNamespaceLoaded, i18n } from './init-i18n'

export type LazyNamespaceBundleStatus = 'loading' | 'ready' | 'failed'

function bundlesReady(namespaces: readonly LazyNamespace[]): boolean {
  const language = i18n.language
  return namespaces.every((namespace) => i18n.hasResourceBundle(language, namespace))
}

/** Loads lazy namespaces once per language; returns `failed` when a locale chunk cannot be loaded. */
export function useLazyNamespaceBundleReady(
  namespaces: readonly LazyNamespace[],
): LazyNamespaceBundleStatus {
  const language = i18n.language
  const namespaceKey = namespaces.slice().sort().join('\0')
  const [status, setStatus] = useState<LazyNamespaceBundleStatus>(() =>
    bundlesReady(namespaces) ? 'ready' : 'loading',
  )

  useEffect(() => {
    if (bundlesReady(namespaces)) {
      setStatus('ready')
      return
    }
    setStatus('loading')
    void Promise.all(namespaces.map((namespace) => ensureNamespaceLoaded(namespace)))
      .then(() => {
        setStatus('ready')
      })
      .catch(() => {
        setStatus('failed')
      })
  }, [language, namespaceKey])

  return status
}
