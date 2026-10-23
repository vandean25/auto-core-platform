import { CommandGroup, CommandItem } from '@/components/ui/command'
import type { PaletteContextActionSection } from './global-search-context-actions'

interface GlobalSearchContextActionGroupProps {
  section: PaletteContextActionSection
  onSelect: (action: PaletteContextActionSection['items'][number]) => void
}

export function GlobalSearchContextActionGroup({
  section,
  onSelect,
}: GlobalSearchContextActionGroupProps) {
  return (
    <CommandGroup heading={section.heading}>
      {section.items.map((action) => {
        const Icon = action.icon

        return (
          <CommandItem
            key={action.id}
            value={`${action.id} ${action.label}`}
            data-action-id={action.id}
            onSelect={() => onSelect(action)}
          >
            {Icon ? <Icon aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" /> : null}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{action.label}</span>
              <span className="truncate text-xs text-muted-foreground">{action.description}</span>
            </div>
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}
