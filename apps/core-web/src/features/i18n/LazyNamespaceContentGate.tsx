import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { LazyNamespace } from '@/lib/i18n/constants'
import { useLazyNamespaceBundleReady } from '@/lib/i18n'

type Props = {
  namespaces: readonly LazyNamespace[]
  children: ReactNode
}

/** Renders children only after lazy bundles are ready; otherwise shows preloaded shell loading copy. */
export function LazyNamespaceContentGate({ namespaces, children }: Props) {
  const { t } = useTranslation('common')
  const { status } = useLazyNamespaceBundleReady(namespaces)

  if (status === 'loading') {
    return <p className="text-sm text-muted-foreground">{t('shell.loading')}</p>
  }

  return children
}
