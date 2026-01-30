import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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
import { Loader2 } from "lucide-react"

interface BrandMultiSelectProps {
    value: number[]
    onChange: (brandIds: number[]) => void
}

export function BrandMultiSelect({ value, onChange }: BrandMultiSelectProps) {
  const [open, setOpen] = React.useState(false)
  const { data: brands, isLoading } = useBrands()

  const selectedBrands = brands?.filter(b => value.includes(b.id)) || []

  const toggleBrand = (brandId: number) => {
    if (value.includes(brandId)) {
        onChange(value.filter(id => id !== brandId))
    } else {
        onChange([...value, brandId])
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between h-auto min-h-10"
            disabled={isLoading}
          >
            {isLoading ? (
                <div className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Loading brands...</span>
                </div>
            ) : (
                <div className="flex flex-wrap gap-1">
                    {selectedBrands.length > 0 ? (
                        selectedBrands.map(brand => (
                            <Badge key={brand.id} variant="secondary" className="mr-1">
                                {brand.name}
                            </Badge>
                        ))
                    ) : (
                        <span className="text-muted-foreground">Select supported brands...</span>
                    )}
                </div>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0">
          <Command>
            <CommandInput placeholder="Search brands..." />
            <CommandList>
              <CommandEmpty>No brand found.</CommandEmpty>
              <CommandGroup>
                {brands?.map((brand) => (
                  <CommandItem
                    key={brand.id}
                    value={brand.name}
                    onSelect={() => toggleBrand(brand.id)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value.includes(brand.id) ? "opacity-100" : "opacity-0"
                      )}
                    />
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
