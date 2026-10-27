import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

function isDialogHeaderElement(child: React.ReactNode): boolean {
  return (
    React.isValidElement(child) &&
    (child.type as { displayName?: string }).displayName === 'DialogHeader'
  )
}

function isDialogFooterElement(child: React.ReactNode): boolean {
  return (
    React.isValidElement(child) &&
    (child.type as { displayName?: string }).displayName === 'DialogFooter'
  )
}

const dialogBodyClassName =
  'dialog-body min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pr-1'

type DialogLayoutParts = {
  header: React.ReactNode | null
  body: React.ReactNode
  footer: React.ReactNode | null
  formShell: React.ReactElement<React.FormHTMLAttributes<HTMLFormElement>> | null
}

function partitionDialogNodes(nodes: React.ReactNode): Omit<DialogLayoutParts, 'formShell'> {
  const items = React.Children.toArray(nodes)
  const header = items.find(isDialogHeaderElement) ?? null
  const footerNode = items.find(isDialogFooterElement) ?? null
  const bodyItems = items.filter((item) => item !== header && item !== footerNode)
  const body = bodyItems.length <= 1 ? (bodyItems[0] ?? null) : bodyItems

  return {
    header,
    body,
    footer: footerNode,
  }
}

function resolveDialogLayout(children: React.ReactNode): DialogLayoutParts {
  const topLevel = React.Children.toArray(children)
  if (
    topLevel.length === 1 &&
    React.isValidElement(topLevel[0]) &&
    topLevel[0].type === 'form'
  ) {
    const formShell = topLevel[0] as React.ReactElement<
      React.FormHTMLAttributes<HTMLFormElement>
    >
    const parts = partitionDialogNodes(formShell.props.children)
    return { ...parts, formShell }
  }

  const parts = partitionDialogNodes(children)
  return { ...parts, formShell: null }
}

function renderManagedDialogLayout(layout: DialogLayoutParts) {
  const { header, body, footer, formShell } = layout
  const hasPinnedRegions = header !== null || footer !== null

  const inner = hasPinnedRegions ? (
    <>
      {header ? <div className="shrink-0">{header}</div> : null}
      <div className={dialogBodyClassName}>{body}</div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </>
  ) : (
    <div className={dialogBodyClassName}>{body}</div>
  )

  if (formShell) {
    return React.cloneElement(
      formShell,
      {
        className: cn(
          'flex min-h-0 min-w-0 flex-1 flex-col gap-4',
          formShell.props.className,
        ),
      },
      inner,
    )
  }

  return inner
}

/** Below sm the dialog fills the screen (safe-area aware, 44px controls); from sm it is the usual centred dialog. */
const fullScreenOnPhoneClassName = cn(
  'max-sm:left-0 max-sm:top-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0',
  'max-sm:pb-[calc(1rem+env(safe-area-inset-bottom,0px))] max-sm:pt-[calc(1rem+env(safe-area-inset-top,0px))]',
  'max-sm:[&_button:not([role=checkbox])]:min-h-11 max-sm:[&_input:not([type=checkbox])]:min-h-11',
  // The close button sits in the corner, above the title row and clear of the notch and the body scrollbar.
  'max-sm:[&>button:first-of-type]:right-2 max-sm:[&>button:first-of-type]:top-[calc(0.5rem+env(safe-area-inset-top,0px))]',
)

function callerManagesDialogLayout(className: string) {
  return /\bflex-col\b/.test(className) && /\boverflow-hidden\b/.test(className)
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { fullScreenOnPhone?: boolean }
>(({ className, children, fullScreenOnPhone, ...props }, ref) => {
  const { t } = useTranslation('common')
  const contentClassName = cn(
    "fixed left-[50%] top-[50%] z-50 flex w-[calc(100%-1rem)] max-w-lg max-h-[90dvh] translate-x-[-50%] translate-y-[-50%] flex-col gap-4 overflow-hidden border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:w-full sm:rounded-lg",
    fullScreenOnPhone && fullScreenOnPhoneClassName,
    className,
  )
  const managedLayout = callerManagesDialogLayout(className ?? '')
  const layout = managedLayout ? null : resolveDialogLayout(children)

  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={contentClassName}
      {...props}
    >
      <DialogPrimitive.Close className="absolute right-4 top-4 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">{t('actions.close')}</span>
      </DialogPrimitive.Close>
      {managedLayout || !layout ? children : renderManagedDialogLayout(layout)}
    </DialogPrimitive.Content>
  </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(dialogBodyClassName, className)}
    {...props}
  />
)
DialogBody.displayName = "DialogBody"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight max-sm:pr-12",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogBody,
  DialogTitle,
  DialogDescription,
}
