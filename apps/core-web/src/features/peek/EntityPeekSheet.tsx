import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

type EntityPeekSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  openInFullHref: string
  isLoading: boolean
  isNotFound: boolean
  notFoundTitle: string
  notFoundDescription?: string
  actions?: ReactNode
  children: ReactNode
}

export function EntityPeekSheet({
  open,
  onOpenChange,
  title,
  description,
  openInFullHref,
  isLoading,
  isNotFound,
  notFoundTitle,
  notFoundDescription,
  actions,
  children,
}: EntityPeekSheetProps) {
  const { t } = useTranslation('common')

  let body: ReactNode = children
  if (isLoading) {
    body = (
      <div className="flex justify-center p-12">
        <Spinner className="h-8 w-8" />
      </div>
    )
  } else if (isNotFound) {
    body = (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ExternalLink className="h-6 w-6" />
          </EmptyMedia>
          <EmptyTitle>{notFoundTitle}</EmptyTitle>
          {notFoundDescription ? <EmptyDescription>{notFoundDescription}</EmptyDescription> : null}
        </EmptyHeader>
      </Empty>
    )
  }

  const sheetContentA11y = description ? {} : { 'aria-describedby': undefined }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-3xl"
        data-testid="entity-peek-sheet"
        {...sheetContentA11y}
      >
        <SheetHeader className="space-y-1 border-b px-4 py-4 text-left sm:px-6">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 p-4 sm:p-6">{body}</div>
        </ScrollArea>

        <div className="flex flex-col gap-3 border-t p-4 sm:p-6">
          {actions ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t('peek.actionsHeading')}</p>
              {actions}
            </div>
          ) : null}
          <Button asChild className="min-h-11 w-full">
            <Link to={openInFullHref}>{t('peek.openInFull')}</Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
