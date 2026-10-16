import { CommandGroup, CommandItem, CommandSeparator } from '@/components/ui/command'
import type { QuickActionSection } from './global-search-quick-actions'

type SelectHandler = (href: string) => void

interface QuickActionGroupProps {
  section: QuickActionSection
  showSeparator: boolean
  onSelect: SelectHandler
}

export function QuickActionGroup({ section, showSeparator, onSelect }: QuickActionGroupProps) {
  return (
    <>
      <CommandGroup heading={section.heading}>
        {section.items.map((action) => {
          const Icon = action.icon

          return (
            <CommandItem
              key={action.href}
              value={`${action.label} ${action.description}`}
              onSelect={() => onSelect(action.href)}
            >
              <Icon aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{action.label}</span>
                <span className="truncate text-xs text-muted-foreground">{action.description}</span>
              </div>
            </CommandItem>
          )
        })}
      </CommandGroup>

      {showSeparator ? <CommandSeparator /> : null}
    </>
  )
}
