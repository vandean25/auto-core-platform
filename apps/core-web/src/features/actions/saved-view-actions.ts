import type { TFunction } from 'i18next'
import { BookmarkCheck, Copy, Pencil, Share2, Trash2, UserMinus } from 'lucide-react'

import type { SavedView } from '@/features/saved-views/SavedViewsProvider'
import { canManageSharedSavedViews } from './action-role-predicates'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

export type SavedViewActionContext = {
  role: string | null | undefined
  isOfflineError: boolean
  open: (view: SavedView) => void
  rename: (view: SavedView) => void
  remove: (view: SavedView) => void
  share: (view: SavedView) => void
  unshare: (view: SavedView) => void
  copy: (view: SavedView) => void
}

export function canEditSavedView(view: SavedView, role: string | null | undefined): boolean {
  return view.visibility === 'PERSONAL' || canManageSharedSavedViews(role)
}

export function createSavedViewActions(
  t: TFunction<'common'>,
): EntityActionDefinition<SavedView, SavedViewActionContext>[] {
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
    {
      id: ENTITY_ACTION_IDS.savedViewShare,
      label: t('savedViews.shareAction'),
      kind: 'run',
      icon: Share2,
      isAllowedForRole: canManageSharedSavedViews,
      isEnabled: (view) => view.visibility === 'PERSONAL',
      run: (view, context) => context.share(view),
    },
    {
      id: ENTITY_ACTION_IDS.savedViewUnshare,
      label: t('savedViews.unshareAction'),
      kind: 'run',
      icon: UserMinus,
      isAllowedForRole: canManageSharedSavedViews,
      isEnabled: (view) => view.visibility === 'TENANT',
      run: (view, context) => context.unshare(view),
    },
    {
      id: ENTITY_ACTION_IDS.savedViewCopy,
      label: t('savedViews.copyAction'),
      kind: 'run',
      icon: Copy,
      isAllowedForRole: () => true,
      isEnabled: (view) => view.visibility === 'TENANT',
      run: (view, context) => context.copy(view),
    },
  ]
}
