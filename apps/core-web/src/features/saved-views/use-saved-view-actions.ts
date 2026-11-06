import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createSavedViewActions, type SavedViewActionContext } from '@/features/actions/saved-view-actions'
import { useOptionalSavedViewsContext } from '@/features/saved-views/SavedViewsProvider'

/**
 * The registry actions of a saved view with the context that runs them, shared by the toolbar menu and Cmd+K so both
 * navigate, rename and (after the registry confirmation) remove the same way. `beforeRun` lets a surface close itself.
 * Outside a provider (mechanic shell) there are no views, so rename and remove have nothing to act on.
 */
export function useSavedViewActions(beforeRun?: () => void) {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const store = useOptionalSavedViewsContext()
  const [open, rename, remove] = useMemo(() => createSavedViewActions(t), [t])

  const context: SavedViewActionContext = {
    open: (view) => {
      beforeRun?.()
      navigate(view.href)
    },
    rename: (view) => {
      beforeRun?.()
      store?.requestRename(view)
    },
    remove: (view) => {
      store?.removeSavedView(view.id)
      toast.message(t('savedViews.removed'))
    },
  }
  return { savedViews: store?.savedViews ?? [], actions: { open, rename, remove }, context }
}
