import type { ReactNode } from 'react'
import { useForceLightTheme } from '@/hooks/useForceLightTheme'

/** Route wrapper for print views and documents: they stay light while the app is dark. */
export function LightDocumentRoute({ children }: { children: ReactNode }) {
  useForceLightTheme()
  return children
}
