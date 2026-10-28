import { useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'

import type { PaletteContextAction } from '@/components/global-search/global-search-context-actions'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

type EntityPeekFooterProps = {
  openInFullHref: string
  /** Registry actions without the `*.open` navigate action; destructive ones are listed last. */
  moreActions: PaletteContextAction[]
}

function splitDestructive(actions: PaletteContextAction[]) {
  return {
    regular: actions.filter((action) => !action.destructive),
    destructive: actions.filter((action) => action.destructive),
  }
}

function MenuItems({ actions }: { actions: PaletteContextAction[] }) {
  return actions.map((action) => {
    const Icon = action.icon
    const content = (
      <>
        {Icon ? <Icon className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
        {action.label}
      </>
    )

    if (action.children && action.children.length > 0) {
      return (
        <DropdownMenuSub key={action.id}>
          <DropdownMenuSubTrigger data-action-id={action.id}>{content}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <MenuItems actions={action.children} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }

    return (
      <DropdownMenuItem
        key={action.id}
        data-action-id={action.id}
        className={cn(action.destructive && 'text-destructive focus:text-destructive')}
        onSelect={action.onSelect}
      >
        {content}
      </DropdownMenuItem>
    )
  })
}

function SheetItems({
  actions,
  onSelect,
}: {
  actions: PaletteContextAction[]
  onSelect: (action: PaletteContextAction) => void
}) {
  return actions.map((action) => {
    if (action.children && action.children.length > 0) {
      return (
        <div key={action.id} role="group" aria-label={action.label} className="space-y-1">
          <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">{action.label}</p>
          <div className="space-y-1 pl-3">
            <SheetItems actions={action.children} onSelect={onSelect} />
          </div>
        </div>
      )
    }

    const Icon = action.icon
    return (
      <Button
        key={action.id}
        type="button"
        variant="ghost"
        data-action-id={action.id}
        className={cn('min-h-11 w-full justify-start', action.destructive && 'text-destructive hover:text-destructive')}
        onClick={() => onSelect(action)}
      >
        {Icon ? <Icon className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
        {action.label}
      </Button>
    )
  })
}

/** Radix `asChild` triggers hand their handlers and ref to this component, so it passes them on to the button. */
function MoreActionsTrigger(props: Omit<ComponentProps<typeof Button>, 'children'>) {
  const { t } = useTranslation('common')

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={t('peek.moreActions')}
      {...props}
      className={cn('min-h-11 min-w-11 shrink-0', props.className)}
    >
      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
    </Button>
  )
}

/** Below `md`: a bottom sheet with the actions as touch-sized rows. */
function MoreActionsSheet({ actions }: { actions: PaletteContextAction[] }) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const { regular, destructive } = splitDestructive(actions)

  const handleSelect = (action: PaletteContextAction) => {
    setOpen(false)
    action.onSelect()
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <MoreActionsTrigger />
      </SheetTrigger>
      <SheetContent side="bottom" className="space-y-1 px-2 pt-4" data-testid="entity-peek-more-actions">
        <SheetHeader className="px-3 text-left">
          <SheetTitle className="text-base">{t('peek.moreActions')}</SheetTitle>
          <SheetDescription className="sr-only">{t('peek.moreActions')}</SheetDescription>
        </SheetHeader>
        <SheetItems actions={regular} onSelect={handleSelect} />
        {destructive.length > 0 ? (
          <>
            {regular.length > 0 ? <Separator className="my-2" /> : null}
            <SheetItems actions={destructive} onSelect={handleSelect} />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

/** From `md`: a dropdown menu. */
function MoreActionsMenu({ actions }: { actions: PaletteContextAction[] }) {
  const { regular, destructive } = splitDestructive(actions)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MoreActionsTrigger />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56" data-testid="entity-peek-more-actions">
        <MenuItems actions={regular} />
        {destructive.length > 0 ? (
          <>
            {regular.length > 0 ? <DropdownMenuSeparator /> : null}
            <MenuItems actions={destructive} />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** One row: the primary "Öffnen" link and, when the registry offers more, a "⋯" menu. */
export function EntityPeekFooter({ openInFullHref, moreActions }: EntityPeekFooterProps) {
  const { t } = useTranslation('common')
  const isMobile = useIsMobile()

  return (
    <div className="flex items-center gap-2 border-t px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:px-6">
      <Button asChild className="min-h-11 flex-1">
        <Link to={openInFullHref}>{t('peek.openInFull')}</Link>
      </Button>
      {moreActions.length > 0 ? (
        isMobile ? (
          <MoreActionsSheet actions={moreActions} />
        ) : (
          <MoreActionsMenu actions={moreActions} />
        )
      ) : null}
    </div>
  )
}
