import type { TFunction } from 'i18next'
import { BookmarkCheck, Pencil, Trash2 } from 'lucide-react'

import type { SavedView } from '@/features/saved-views/SavedViewsProvider'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

export type SavedViewActionContext = {
  open: (view: SavedView) => void
  rename: (view: SavedView) => void
  remove: (view: SavedView) => void
}

/**
 * The record actions of a saved view. A view belongs to the signed-in user (localStorage, per user and tenant), so no
 * role gate applies; the palette lists a view only for the lists the role can reach (see `getSavedViewsSection`).
 */
export function createSavedViewActions(t: TFunction<'common'>): EntityActionDefinition<SavedView, SavedViewActionContext>[] {
  return [
    {
      id: ENTITY_ACTION_IDS.savedViewOpen,
      label: t('savedViews.openAction'),
      kind: 'navigate',
      icon: BookmarkCheck,
      isAllowedForRole: () => true,
      isEnabled: () => true,
      run: (view, context) => context.open(view),
    },
    {
      id: ENTITY_ACTION_IDS.savedViewRename,
      label: t('savedViews.renameAction'),
      kind: 'dialog',
      icon: Pencil,
      isAllowedForRole: () => true,
      isEnabled: () => true,
      run: (view, context) => context.rename(view),
    },
    {
      id: ENTITY_ACTION_IDS.savedViewDelete,
      label: t('savedViews.removeAction'),
      icon: Trash2,
      destructive: true,
      confirm: (view) => ({
        title: t('savedViews.removeConfirmTitle'),
        description: t('savedViews.removeConfirmDescription', { name: view.name }),
        confirmLabel: t('savedViews.removeAction'),
      }),
      isAllowedForRole: () => true,
      isEnabled: () => true,
      run: (view, context) => context.remove(view),
    },
  ]
}
