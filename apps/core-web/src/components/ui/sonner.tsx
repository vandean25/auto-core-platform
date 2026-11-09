import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"
import {
    TOAST_STACK_OFFSET_DESKTOP,
    TOAST_STACK_OFFSET_MOBILE,
} from "./toast-stack-offset"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
    const { theme = "system" } = useTheme()

    return (
        <Sonner
            theme={theme as ToasterProps["theme"]}
            className="toaster group"
            // Sonner switches to its mobile offset at 600px, the bar shows up to 767px, so both reserve its height.
            offset={{ bottom: TOAST_STACK_OFFSET_DESKTOP }}
            mobileOffset={{ bottom: TOAST_STACK_OFFSET_MOBILE }}
            toastOptions={{
                classNames: {
                    toast:
                        "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
                    description: "group-[.toast]:text-muted-foreground",
                    actionButton:
                        "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground max-sm:min-h-11 max-sm:min-w-11 max-sm:px-3",
                    cancelButton:
                        "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
                },
            }}
            {...props}
        />
    )
}

export { Toaster }
