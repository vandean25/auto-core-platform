import { Wrench, Construction } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type BoardViewMode = 'mechanic' | 'bay'

interface BoardViewToggleProps {
  value: BoardViewMode
  onChange: (mode: BoardViewMode) => void
}

export function BoardViewToggle({ value, onChange }: BoardViewToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(val) => {
        if (val === 'mechanic' || val === 'bay') onChange(val)
      }}
      className="rounded-md border border-slate-200 bg-white p-0.5"
    >
      <ToggleGroupItem
        value="mechanic"
        className="rounded-sm px-3 py-1.5 text-sm gap-1.5 data-[state=on]:bg-slate-900 data-[state=on]:text-white"
      >
        <Wrench className="h-3.5 w-3.5" />
        By Mechanic
      </ToggleGroupItem>
      <ToggleGroupItem
        value="bay"
        className="rounded-sm px-3 py-1.5 text-sm gap-1.5 data-[state=on]:bg-slate-900 data-[state=on]:text-white"
      >
        <Construction className="h-3.5 w-3.5" />
        By Bay
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
