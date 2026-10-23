import { useEffect, useState } from 'react'
import { useTranslation as useTranslationBase } from './react-i18next-public'
import { LAZY_NAMESPACES, type AppNamespace, type LazyNamespace } from './constants'
import { ensureNamespaceLoaded, i18n } from './init-i18n'

function isLazyNamespace(namespace: string): namespace is LazyNamespace {
  return (LAZY_NAMESPACES as readonly string[]).includes(namespace)
}

function namespacesFromArgs(
  ns?: Parameters<typeof useTranslationBase>[0],
  options?: Parameters<typeof useTranslationBase>[1],
): AppNamespace[] {
  const resolved =
    ns ??
    (options && 'ns' in options ? (options.ns as string | readonly string[] | undefined) : undefined)
  if (!resolved) {
    return []
  }
  return (Array.isArray(resolved) ? resolved : [resolved]) as AppNamespace[]
}

function unloadedLazyNamespaces(namespaces: AppNamespace[]): LazyNamespace[] {
  const language = i18n.language
  return namespaces.filter(
    (namespace): namespace is LazyNamespace =>
      isLazyNamespace(namespace) && !i18n.hasResourceBundle(language, namespace),
  )
}

function useLazyNamespacesReady(namespaces: AppNamespace[]): boolean {
  const language = i18n.language
  const namespaceKey = namespaces.slice().sort().join('\0')
  const [ready, setReady] = useState(() => unloadedLazyNamespaces(namespaces).length === 0)

  useEffect(() => {
    const missing = unloadedLazyNamespaces(namespaces)
    if (missing.length === 0) {
      setReady(true)
      return
    }
    setReady(false)
    void Promise.all(missing.map((namespace) => ensureNamespaceLoaded(namespace))).then(() => {
      setReady(true)
    })
  }, [language, namespaceKey, namespaces])

  return ready
}

/**
 * Loads lazy locale namespaces before `t()` can return raw keys. Preloaded namespaces behave like react-i18next.
 */
export const useTranslation = ((
  ns?: Parameters<typeof useTranslationBase>[0],
  options?: Parameters<typeof useTranslationBase>[1],
): ReturnType<typeof useTranslationBase> => {
  const namespaces = namespacesFromArgs(ns, options)
  const localeReady = useLazyNamespacesReady(namespaces)
  const response = useTranslationBase(ns, { ...options, useSuspense: false })

  if (!localeReady) {
    const emptyT = (() => '') as (typeof response)['t']
    return { ...response, t: emptyT }
  }

  return response
}) as typeof useTranslationBase
