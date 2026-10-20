import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

// Each tooltip carries its own provider, so list toolbars render without an app-level provider.
const Tooltip = ({
    delayDuration = 300,
    ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) => (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
        <TooltipPrimitive.Root {...props} />
    </TooltipPrimitive.Provider>
)

const TooltipTrigger = TooltipPrimitive.Trigger

// Exposed for the sidebar, which wraps its whole tree in one provider.
const TooltipProvider = TooltipPrimitive.Provider

const TooltipContent = React.forwardRef<
    React.ElementRef<typeof TooltipPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
    <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
            ref={ref}
            sideOffset={sideOffset}
            className={cn(
                "z-50 max-w-xs rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
                className
            )}
            {...props}
        />
    </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

// One trigger with a one-line hint shown on hover and keyboard focus; Escape dismisses it.
const TooltipHint = ({ hint, children }: { hint: string; children: React.ReactElement }) => (
    <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
)

export { Tooltip, TooltipHint, TooltipProvider, TooltipTrigger, TooltipContent }
