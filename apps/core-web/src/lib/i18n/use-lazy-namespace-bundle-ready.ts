import { useCallback, useEffect, useState } from 'react'
import type { LazyNamespace } from './constants'
import { ensureNamespaceLoaded, i18n } from './init-i18n'

export type LazyNamespaceBundleStatus = 'loading' | 'ready' | 'failed'

function bundlesReady(namespaces: readonly LazyNamespace[]): boolean {
  const language = i18n.language
  return namespaces.every((namespace) => i18n.hasResourceBundle(language, namespace))
}

export type LazyNamespaceBundleReadyState = {
  status: LazyNamespaceBundleStatus
  retry: () => void
}

/** Loads lazy namespaces once per language; returns `failed` when a locale chunk cannot be loaded. */
export function useLazyNamespaceBundleReady(
  namespaces: readonly LazyNamespace[],
): LazyNamespaceBundleReadyState {
  const language = i18n.language
  const namespaceKey = namespaces.slice().sort().join('\0')
  const [retryToken, setRetryToken] = useState(0)
  const [status, setStatus] = useState<LazyNamespaceBundleStatus>(() =>
    bundlesReady(namespaces) ? 'ready' : 'loading',
  )

  const retry = useCallback(() => {
    setRetryToken((value) => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    if (bundlesReady(namespaces)) {
      setStatus('ready')
      return () => {
        cancelled = true
      }
    }

    setStatus('loading')
    void Promise.all(namespaces.map((namespace) => ensureNamespaceLoaded(namespace)))
      .then(() => {
        if (cancelled) return
        setStatus(bundlesReady(namespaces) ? 'ready' : 'loading')
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('failed')
        }
      })

    return () => {
      cancelled = true
    }
  }, [language, namespaceKey, retryToken])

  return { status, retry }
}
