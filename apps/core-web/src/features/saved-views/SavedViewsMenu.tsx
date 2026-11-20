import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookmarkCheck, Copy, MoreHorizontal, Pencil, Share2, Trash2, UserMinus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { executeEntityAction } from '@/features/actions/entity-action'
import { canManageSharedSavedViews } from '@/features/actions/action-role-predicates'
import { canEditSavedView } from '@/features/actions/saved-view-actions'
import { savedViewPath, type SavedView } from '@/features/saved-views/SavedViewsProvider'
import { useSavedViewActions } from '@/features/saved-views/use-saved-view-actions'
import { useIsMobile } from '@/hooks/use-mobile'

type ViewActionsBundle = ReturnType<typeof useSavedViewActions>

function SavedViewRow({
  view,
  bundle,
}: {
  view: SavedView
  bundle: ViewActionsBundle
}) {
  const { t } = useTranslation('common')
  const { actions, context, isOfflineError, role } = bundle
  const editable = canEditSavedView(view, role)
  const canShare = canManageSharedSavedViews(role)

  return (
    <li className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        data-action-id={actions.open.id}
        className="h-auto min-h-11 min-w-0 flex-1 justify-start gap-2 md:min-h-9"
        onClick={() => executeEntityAction(actions.open, view, context)}
      >
        <span className="min-w-0 flex-1 whitespace-normal break-words text-left">{view.name}</span>
        {view.visibility === 'TENANT' ? (
          <Badge variant="secondary" className="shrink-0">
            {t('savedViews.teamBadge')}
          </Badge>
        ) : null}
      </Button>
      {editable ? (
        <>
          <Button
            type="button"
            variant="ghost"
            disabled={isOfflineError}
            data-action-id={actions.rename.id}
            className="size-11 shrink-0 md:size-9"
            aria-label={t('savedViews.renameAria', { name: view.name })}
            onClick={() => executeEntityAction(actions.rename, view, context)}
          >
            <Pencil aria-hidden="true" />
          </Button>
          {canShare ? (
            view.visibility === 'PERSONAL' ? (
              <Button
                type="button"
                variant="ghost"
                disabled={isOfflineError}
                data-action-id={actions.share.id}
                className="size-11 shrink-0 md:size-9"
                aria-label={t('savedViews.shareAria', { name: view.name })}
                onClick={() => executeEntityAction(actions.share, view, context)}
              >
                <Share2 aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                disabled={isOfflineError}
                data-action-id={actions.unshare.id}
                className="size-11 shrink-0 md:size-9"
                aria-label={t('savedViews.unshareAria', { name: view.name })}
                onClick={() => executeEntityAction(actions.unshare, view, context)}
              >
                <UserMinus aria-hidden="true" />
              </Button>
            )
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={isOfflineError}
            data-action-id={actions.remove.id}
            className="size-11 shrink-0 md:size-9"
            aria-label={t('savedViews.removeAria', { name: view.name })}
            onClick={() => executeEntityAction(actions.remove, view, context)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          disabled={isOfflineError}
          data-action-id={actions.copy.id}
          className="size-11 shrink-0 md:size-9"
          aria-label={t('savedViews.copyAria', { name: view.name })}
          onClick={() => executeEntityAction(actions.copy, view, context)}
        >
          <Copy aria-hidden="true" />
        </Button>
      )}
    </li>
  )
}

function SavedViewSection({
  label,
  views,
  bundle,
}: {
  label: string
  views: SavedView[]
  bundle: ViewActionsBundle
}) {
  if (views.length === 0) return null

  return (
    <section aria-label={label} className="space-y-1">
      <h4 className="px-2 pt-1 text-xs font-medium text-muted-foreground">{label}</h4>
      <ul className="flex flex-col">
        {views.map((view) => (
          <SavedViewRow key={view.id} view={view} bundle={bundle} />
        ))}
      </ul>
    </section>
  )
}

function SavedViewsListContent({
  views,
  bundle,
}: {
  views: SavedView[]
  bundle: ViewActionsBundle
}) {
  const { t } = useTranslation('common')
  const personalViews = views.filter((view) => view.visibility !== 'TENANT')
  const teamViews = views.filter((view) => view.visibility === 'TENANT')

  return (
    <div className="space-y-2">
      {bundle.isOfflineError ? (
        <p role="status" className="px-2 py-1 text-xs text-destructive">
          {t('savedViews.offlineError')}
        </p>
      ) : null}
      <SavedViewSection label={t('savedViews.personalSection')} views={personalViews} bundle={bundle} />
      <SavedViewSection label={t('savedViews.teamSection')} views={teamViews} bundle={bundle} />
    </div>
  )
}

/** The saved views of the list that is open: open, rename, share, copy and remove them. Hidden while the list has none. */
export function SavedViewsMenu({ title }: { title: string }) {
  const { t } = useTranslation('common')
  const location = useLocation()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const bundle = useSavedViewActions(() => setOpen(false))

  const views = bundle.savedViews.filter((view) => savedViewPath(view.href) === location.pathname)
  if (views.length === 0) return null

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="min-h-11 min-w-11 shrink-0"
            aria-label={t('savedViews.menuAria', { title })}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] space-y-2 overflow-y-auto px-3 pt-4"
          aria-label={t('savedViews.menuTitle')}
        >
          <SheetHeader className="px-2 text-left">
            <SheetTitle className="text-base">{t('savedViews.menuTitle')}</SheetTitle>
            <SheetDescription className="sr-only">
              {t('savedViews.menuAria', { title })}
            </SheetDescription>
          </SheetHeader>
          <SavedViewsListContent views={views} bundle={bundle} />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label={t('savedViews.menuAria', { title })}
        >
          <BookmarkCheck className="h-4 w-4" />
          <span>{t('savedViews.menuButton')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t('savedViews.menuTitle')}
        className="w-[min(22rem,calc(100vw-2rem))] p-1"
      >
        <SavedViewsListContent views={views} bundle={bundle} />
      </PopoverContent>
    </Popover>
  )
}
