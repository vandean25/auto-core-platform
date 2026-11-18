import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthSession } from '@/api/auth-session'
import {
  createSavedViewActions,
  type SavedViewActionContext,
} from '@/features/actions/saved-view-actions'
import { useOptionalSavedViewsContext } from '@/features/saved-views/SavedViewsProvider'

/**
 * The registry actions of a saved view with the context that runs them, shared by the toolbar menu, mobile sheet,
 * and Cmd+K so all surfaces navigate, rename, share, copy and remove the same way.
 */
export function useSavedViewActions(beforeRun?: () => void) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const store = useOptionalSavedViewsContext()
  const { data: session } = useAuthSession()
  const role = session?.activeRole
  const [open, rename, remove, share, unshare, copy] = useMemo(
    () => createSavedViewActions(t),
    [t],
  )

  const context: SavedViewActionContext = {
    role,
    isOfflineError: store?.isOfflineError ?? false,
    open: (view) => {
      beforeRun?.()
      navigate(view.href)
    },
    rename: (view) => {
      beforeRun?.()
      store?.requestRename(view)
    },
    remove: (view) => {
      if (!store) return
      void store.removeSavedView(view.id).then((result) => {
        if (result.ok) {
          toast.message(t('savedViews.removed'))
        }
      })
    },
    share: (view) => {
      if (!store) return
      void store.shareSavedView(view.id, 'TENANT').then((result) => {
        if (result.ok) {
          toast.success(t('savedViews.shared'))
        }
      })
    },
    unshare: (view) => {
      if (!store) return
      void store.shareSavedView(view.id, 'PERSONAL').then((result) => {
        if (result.ok) {
          toast.message(t('savedViews.unshared'))
        }
      })
    },
    copy: (view) => {
      if (!store) return
      void store.copySavedView(view.id).then((result) => {
        if (result.ok) {
          toast.success(t('savedViews.copied'))
        }
      })
    },
  }

  return {
    savedViews: store?.savedViews ?? [],
    isOfflineError: store?.isOfflineError ?? false,
    role,
    actions: { open, rename, remove, share, unshare, copy },
    context,
  }
}
