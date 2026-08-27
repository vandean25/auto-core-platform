import { Calendar, CalendarDays } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type PlannerViewMode = 'day' | 'week'

interface PlannerViewToggleProps {
  value: PlannerViewMode
  onChange: (mode: PlannerViewMode) => void
}

export function PlannerViewToggle({ value, onChange }: PlannerViewToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(val) => {
        if (val === 'day' || val === 'week') onChange(val)
      }}
      className="rounded-md border border-slate-200 bg-white p-0.5"
    >
      <ToggleGroupItem
        value="day"
        className="rounded-sm px-3 py-1.5 text-sm gap-1.5 data-[state=on]:bg-slate-900 data-[state=on]:text-white"
      >
        <Calendar className="h-3.5 w-3.5" />
        Day
      </ToggleGroupItem>
      <ToggleGroupItem
        value="week"
        className="rounded-sm px-3 py-1.5 text-sm gap-1.5 data-[state=on]:bg-slate-900 data-[state=on]:text-white"
      >
        <CalendarDays className="h-3.5 w-3.5" />
        Week
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
