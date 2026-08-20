import * as React from "react"
import { Check, ChevronsUpDown, X, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { useBrands } from "@/api/brands"

interface BrandMultiSelectProps {
  value: number[]
  onChange: (brandIds: number[]) => void
  isUpdating?: boolean
  ariaLabel?: string
}

export function BrandMultiSelect({ 
  value, 
  onChange, 
  isUpdating,
  ariaLabel = "Select brands"
}: BrandMultiSelectProps) {
  const [open, setOpen] = React.useState(false)
  const { data: brands, isLoading } = useBrands()

  const selectedBrands = React.useMemo(() => 
    brands?.filter(b => value.includes(b.id)) || [],
    [brands, value]
  )

  const handleRemove = (e: React.MouseEvent, brandId: number) => {
    e.stopPropagation()
    onChange(value.filter(id => id !== brandId))
  }

  const toggleBrand = (brandId: number) => {
    if (value.includes(brandId)) {
      onChange(value.filter(id => id !== brandId))
    } else {
      onChange([...value, brandId])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isUpdating) return
    
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      setOpen(true)
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div
            role="combobox"
            aria-expanded={open}
            aria-controls="brand-options"
            aria-label={ariaLabel}
            tabIndex={0}
            className={cn(
              "flex min-h-10 w-full flex-wrap items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer",
              isUpdating && "opacity-70 pointer-events-none"
            )}
            onClick={() => !isUpdating && setOpen(true)}
            onKeyDown={handleKeyDown}
          >
            <div className="flex flex-wrap gap-1.5 flex-1">
              {isLoading ? (
                <div className="flex items-center gap-2 text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading brands...</span>
                </div>
              ) : selectedBrands.length > 0 ? (
                selectedBrands.map(brand => (
                  <Badge 
                    key={brand.id} 
                    variant="secondary" 
                    className="bg-slate-100 text-slate-700 hover:bg-slate-200 border-none px-2 py-0.5 flex items-center gap-1 font-medium transition-colors"
                  >
                    {brand.name}
                    <button
                      type="button"
                      disabled={isUpdating}
                      className="ml-1 rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:bg-slate-300 p-0.5 disabled:cursor-not-allowed"
                      onClick={(e) => handleRemove(e, brand.id)}
                    >
                      <X className="h-3 w-3" />
                      <span className="sr-only">Remove {brand.name}</span>
                    </button>
                  </Badge>
                ))
              ) : (
                <span className="text-slate-500">Select supported brands...</span>
              )}
            </div>
            <div className="flex items-center shrink-0 gap-2 ml-2">
              {isUpdating && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              <ChevronsUpDown className="h-4 w-4 opacity-50 text-slate-500" />
            </div>
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search brands..." className="h-9" />
            <CommandList id="brand-options">
              <CommandEmpty>No brand found.</CommandEmpty>
              <CommandGroup>
                {brands
                  ?.filter((brand) => !value.includes(brand.id))
                  .map((brand) => (
                    <CommandItem
                      key={brand.id}
                      value={brand.name}
                      onSelect={() => !isUpdating && toggleBrand(brand.id)}
                      className={cn(
                        "cursor-pointer",
                        isUpdating && "opacity-50 pointer-events-none"
                      )}
                    >
                      <div className="mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary opacity-50 [&_svg]:invisible">
                        <Check className={cn("h-4 w-4")} />
                      </div>
                      {brand.name}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
