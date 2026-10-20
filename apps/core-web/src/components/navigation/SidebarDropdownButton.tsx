import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { SidebarMenuButton } from '@/components/ui/sidebar'

type SidebarDropdownButtonProps = ComponentPropsWithoutRef<typeof SidebarMenuButton> & {
  icon: ReactNode
  title: string
  subtitle?: ReactNode
  tooltip: string
}

/**
 * Trigger row of a sidebar dropdown: a badge, the title and an optional second line. The badge is
 * decorative, because the title already names the item.
 */
export const SidebarDropdownButton = forwardRef<HTMLButtonElement, SidebarDropdownButtonProps>(
  ({ icon, title, subtitle, tooltip, ...props }, ref) => (
    <SidebarMenuButton
      ref={ref}
      size="lg"
      tooltip={tooltip}
      className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
      {...props}
    >
      <span
        aria-hidden="true"
        className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
      >
        {icon}
      </span>
      <span className="grid min-w-0 flex-1 text-left leading-tight">
        <span className="truncate font-semibold">{title}</span>
        {subtitle}
      </span>
      <ChevronsUpDown aria-hidden="true" className="ml-auto" />
    </SidebarMenuButton>
  ),
)

SidebarDropdownButton.displayName = 'SidebarDropdownButton'
