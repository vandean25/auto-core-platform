import type { ReactNode } from 'react'
import { LocaleBundleLoadFailed, useLazyNamespaceBundleReady } from '@/lib/i18n'

export function FinanceLocaleGate({ children }: { children: ReactNode }) {
  const { status, retry } = useLazyNamespaceBundleReady(['finance'])

  if (status === 'loading') {
    return null
  }
  if (status === 'failed') {
    return <LocaleBundleLoadFailed onRetry={retry} />
  }

  return children
}
