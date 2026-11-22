import { useTranslation } from 'react-i18next'
import { Wrench, Construction } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type BoardViewMode = 'mechanic' | 'bay'

interface BoardViewToggleProps {
  value: BoardViewMode
  onChange: (mode: BoardViewMode) => void
}

export function BoardViewToggle({ value, onChange }: BoardViewToggleProps) {
  const { t } = useTranslation('workshop')
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(val) => {
        if (val === 'mechanic' || val === 'bay') onChange(val)
      }}
      className="flex shrink-0 flex-nowrap rounded-md border border-border bg-card p-0.5"
    >
      <ToggleGroupItem
        value="mechanic"
        className="gap-1.5 rounded-sm px-3 py-1.5 text-sm data-[state=on]:bg-foreground data-[state=on]:text-background max-sm:min-h-11 max-sm:px-2"
      >
        <Wrench className="h-3.5 w-3.5" />
        {t('board.viewMode.byMechanic')}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="bay"
        className="gap-1.5 rounded-sm px-3 py-1.5 text-sm data-[state=on]:bg-foreground data-[state=on]:text-background max-sm:min-h-11 max-sm:px-2"
      >
        <Construction className="h-3.5 w-3.5" />
        {t('board.viewMode.byBay')}
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
