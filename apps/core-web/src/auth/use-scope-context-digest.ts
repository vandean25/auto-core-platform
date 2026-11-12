import { useSyncExternalStore } from 'react'

import {
  getScopeContextDigest,
  isScopeContextQuarantined,
  subscribeScopeContextClient,
  scopeContextReadyForCursorList,
} from '@/auth/scope-context-client'

export function useScopeContextDigest(): string | undefined {
  return useSyncExternalStore(subscribeScopeContextClient, getScopeContextDigest, getScopeContextDigest)
}

export function useScopeContextReady(): boolean {
  return useSyncExternalStore(
    subscribeScopeContextClient,
    scopeContextReadyForCursorList,
    scopeContextReadyForCursorList,
  )
}

export function useScopeContextQuarantined(): boolean {
  return useSyncExternalStore(subscribeScopeContextClient, isScopeContextQuarantined, isScopeContextQuarantined)
}
