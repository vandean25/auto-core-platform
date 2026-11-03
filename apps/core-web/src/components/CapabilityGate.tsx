import type { ReactNode } from 'react'
import {
  selectEffectiveCapabilities,
  useAuthSession,
  type EffectiveCapabilities,
} from '@/api/auth-session'

/**
 * Renders children only when the active legal entity has the capability.
 * A missing or loading session counts as unavailable (strict `=== true`).
 */
export function CapabilityGate({
  capability,
  fallback = null,
  children,
}: {
  capability: keyof EffectiveCapabilities
  fallback?: ReactNode
  children: ReactNode
}) {
  const capabilities = selectEffectiveCapabilities(useAuthSession().data)
  return capabilities?.[capability] === true ? <>{children}</> : <>{fallback}</>
}
