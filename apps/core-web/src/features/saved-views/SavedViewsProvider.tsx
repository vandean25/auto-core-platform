import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { normalizeApiError } from '@/api/api-error'
import {
  savedViewKeys,
  useCopySavedView,
  useCreateSavedView,
  useRemoveSavedView,
  useRenameSavedView,
  useSavedViewsQuery,
  useShareSavedView,
  type SavedViewDto,
  type SavedViewVisibility,
} from '@/api/saved-views'
import { i18n } from '@/lib/i18n'

const STORAGE_PREFIX = 'acp:saved-views:'
/** Table state that describes a position in the result, not a way of looking at it: a saved view starts on page 1. */
const TRANSIENT_PARAMS = ['page', 'peek', 'action'] as const

export type SavedView = SavedViewDto

type CreateSavedViewInput = {
  name: string
  href: string
  visibility?: SavedViewVisibility
}

export type SavedViewMutationFailureReason =
  | 'duplicate'
  | 'invalid'
  | 'limit'
  | 'conflict'
  | 'offline'
  | 'failed'

export type SavedViewResult = { ok: boolean; reason?: SavedViewMutationFailureReason }
export type CreateSavedViewResult = { created: boolean; reason?: SavedViewMutationFailureReason }

export type SavedViewsContextValue = {
  savedViews: SavedView[]
  isLoading: boolean
  isOfflineError: boolean
  addSavedView: (input: CreateSavedViewInput) => Promise<CreateSavedViewResult>
  renameSavedView: (id: string, name: string) => Promise<SavedViewResult>
  removeSavedView: (id: string) => Promise<SavedViewResult>
  shareSavedView: (id: string, visibility: SavedViewVisibility) => Promise<SavedViewResult>
  copySavedView: (id: string) => Promise<SavedViewResult>
  /** The view whose rename dialog is open: one dialog (`SavedViewRenameHost`) serves the toolbar menu and Cmd+K. */
  renamingView: SavedView | null
  requestRename: (view: SavedView) => void
  cancelRename: () => void
}

const SavedViewsContext = React.createContext<SavedViewsContextValue | null>(null)

function normalizeHref(href: string): string {
  const trimmed = href.trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed, 'http://localhost')
    const params = new URLSearchParams(url.search)
    for (const key of TRANSIENT_PARAMS) params.delete(key)
    params.sort()
    const normalizedQuery = params.toString()
    return `${url.pathname}${normalizedQuery ? `?${normalizedQuery}` : ''}`
  } catch {
    return trimmed
  }
}

/** Per user and tenant (AUT-880): kept as export for session reset tests and one-time import (AUT-942). */
export function savedViewsStorageKey(userKey: string, tenantId: string | null): string {
  return `${STORAGE_PREFIX}${userKey}:${tenantId ?? 'none'}`
}

/** The list a saved view belongs to, so a list's menu shows only its own views. */
export function savedViewPath(href: string): string {
  return href.split('?')[0]
}

function mapMutationErrorReason(error: unknown): SavedViewMutationFailureReason {
  const normalized = normalizeApiError(error)
  if (!normalized) return 'failed'
  if (normalized.code === 'SAVED_VIEW_DUPLICATE') return 'duplicate'
  if (normalized.code === 'SAVED_VIEW_LIMIT') return 'limit'
  if (normalized.code === 'SAVED_VIEW_CHANGED' || normalized.status === 409) return 'conflict'
  if (normalized.code === 'SAVED_VIEW_INVALID' || normalized.status === 400) return 'invalid'
  return 'failed'
}

type SavedViewsProviderProps = {
  userKey: string
  /** Null for a session without an active tenant (a platform admin outside any tenant). */
  tenantId?: string | null
  children: React.ReactNode
}

function SavedViewsStore({
  userKey,
  tenantId,
  children,
}: {
  userKey: string
  tenantId: string | null
  children: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const viewsQuery = useSavedViewsQuery({ tenantId, userKey })
  const createMutation = useCreateSavedView(tenantId, userKey)
  const renameMutation = useRenameSavedView(tenantId, userKey)
  const removeMutation = useRemoveSavedView(tenantId, userKey)
  const shareMutation = useShareSavedView(tenantId, userKey)
  const copyMutation = useCopySavedView(tenantId, userKey)

  const [renamingId, setRenamingId] = React.useState<string | null>(null)

  const savedViews = React.useMemo(() => viewsQuery.data?.data ?? [], [viewsQuery.data])
  const savedViewsRef = React.useRef<SavedView[]>(savedViews)
  const isOfflineError = viewsQuery.isError
  const isOfflineRef = React.useRef(isOfflineError)

  React.useEffect(() => {
    savedViewsRef.current = savedViews
    isOfflineRef.current = isOfflineError
  }, [savedViews, isOfflineError])

  const reloadViews = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: savedViewKeys.list(tenantId, userKey) })
  }, [queryClient, tenantId, userKey])

  const addSavedView = React.useCallback(
    async ({ name, href, visibility }: CreateSavedViewInput): Promise<CreateSavedViewResult> => {
      if (isOfflineRef.current) return { created: false, reason: 'offline' }

      const normalizedName = name.trim()
      const normalizedHref = normalizeHref(href)
      if (!normalizedName || !normalizedHref) {
        return { created: false, reason: 'invalid' }
      }

      const listPath = savedViewPath(normalizedHref)
      const targetVisibility = visibility ?? 'PERSONAL'
      const duplicate = savedViewsRef.current.some(
        (view) =>
          view.listPath === listPath &&
          view.visibility === targetVisibility &&
          view.name.toLowerCase() === normalizedName.toLowerCase(),
      )
      if (duplicate) {
        return { created: false, reason: 'duplicate' }
      }

      try {
        await createMutation.mutateAsync({
          listPath,
          name: normalizedName,
          href: normalizedHref,
          visibility: targetVisibility,
        })
        return { created: true }
      } catch (error) {
        return { created: false, reason: mapMutationErrorReason(error) }
      }
    },
    [createMutation],
  )

  const handleMutationError = React.useCallback(
    (
      error: unknown,
      fallbackKey?:
        | 'common:savedViews.failed'
        | 'common:savedViews.shareFailed'
        | 'common:savedViews.copyFailed',
    ): SavedViewResult['reason'] => {
      const reason = mapMutationErrorReason(error)
      if (reason === 'conflict') {
        toast.error(i18n.t('common:savedViews.conflictError'))
        reloadViews()
      } else if (fallbackKey) {
        if (reason === 'duplicate') {
          toast.message(i18n.t('common:savedViews.renameDuplicate'))
        } else if (reason === 'limit') {
          toast.error(i18n.t('common:savedViews.limitReached'))
        } else {
          toast.error(i18n.t(fallbackKey))
        }
      }
      return reason
    },
    [reloadViews],
  )

  const renameSavedView = React.useCallback(
    async (id: string, name: string): Promise<SavedViewResult> => {
      if (isOfflineRef.current) return { ok: false, reason: 'offline' }

      const normalizedName = name.trim()
      const target = savedViewsRef.current.find((view) => view.id === id)
      if (!normalizedName || !target) return { ok: false, reason: 'invalid' }

      const taken = savedViewsRef.current.some(
        (view) =>
          view.id !== id &&
          view.listPath === target.listPath &&
          view.visibility === target.visibility &&
          view.name.toLowerCase() === normalizedName.toLowerCase(),
      )
      if (taken) return { ok: false, reason: 'duplicate' }

      try {
        await renameMutation.mutateAsync({ id, name: normalizedName, version: target.version })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: handleMutationError(error) }
      }
    },
    [handleMutationError, renameMutation],
  )

  const removeSavedView = React.useCallback(
    async (id: string): Promise<SavedViewResult> => {
      if (isOfflineRef.current) return { ok: false, reason: 'offline' }

      const target = savedViewsRef.current.find((view) => view.id === id)
      if (!target) return { ok: false, reason: 'invalid' }

      try {
        await removeMutation.mutateAsync({ id, version: target.version })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: handleMutationError(error, 'common:savedViews.failed') }
      }
    },
    [handleMutationError, removeMutation],
  )

  const shareSavedView = React.useCallback(
    async (id: string, visibility: SavedViewVisibility): Promise<SavedViewResult> => {
      if (isOfflineRef.current) return { ok: false, reason: 'offline' }

      const target = savedViewsRef.current.find((view) => view.id === id)
      if (!target) return { ok: false, reason: 'invalid' }

      try {
        await shareMutation.mutateAsync({ id, visibility, version: target.version })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: handleMutationError(error, 'common:savedViews.shareFailed') }
      }
    },
    [handleMutationError, shareMutation],
  )

  const copySavedView = React.useCallback(
    async (id: string): Promise<SavedViewResult> => {
      if (isOfflineRef.current) return { ok: false, reason: 'offline' }

      try {
        await copyMutation.mutateAsync({ id })
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: handleMutationError(error, 'common:savedViews.copyFailed') }
      }
    },
    [copyMutation, handleMutationError],
  )

  const requestRename = React.useCallback((view: SavedView) => setRenamingId(view.id), [])
  const cancelRename = React.useCallback(() => setRenamingId(null), [])
  const renamingView = savedViews.find((view) => view.id === renamingId) ?? null

  const value = React.useMemo<SavedViewsContextValue>(
    () => ({
      savedViews,
      isLoading: viewsQuery.isLoading,
      isOfflineError,
      addSavedView,
      renameSavedView,
      removeSavedView,
      shareSavedView,
      copySavedView,
      renamingView,
      requestRename,
      cancelRename,
    }),
    [
      savedViews,
      viewsQuery.isLoading,
      isOfflineError,
      addSavedView,
      renameSavedView,
      removeSavedView,
      shareSavedView,
      copySavedView,
      renamingView,
      requestRename,
      cancelRename,
    ],
  )

  return <SavedViewsContext.Provider value={value}>{children}</SavedViewsContext.Provider>
}

export function SavedViewsProvider({ userKey, tenantId = null, children }: SavedViewsProviderProps) {
  const scopeKey = savedViewsStorageKey(userKey, tenantId)
  // Keyed by user+tenant: a tenant or user change mounts a fresh store, so no render shows the previous one's views.
  return (
    <SavedViewsStore key={scopeKey} userKey={userKey} tenantId={tenantId}>
      {children}
    </SavedViewsStore>
  )
}

export function useSavedViews() {
  const context = React.useContext(SavedViewsContext)
  if (!context) {
    throw new Error('useSavedViews must be used within a SavedViewsProvider.')
  }
  return context
}

/** For surfaces that can also render outside a provider (the mechanic shell has none): null instead of a throw. */
export function useOptionalSavedViewsContext(): SavedViewsContextValue | null {
  return React.useContext(SavedViewsContext)
}
